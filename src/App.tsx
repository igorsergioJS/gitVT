import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import {
  abortOperation,
  checkoutRef,
  cherryPick,
  cloneRepository,
  continueOperation,
  getCommitDetails,
  getDiff,
  getWorkingTreeDiff,
  getRepositoryState,
  isDesktopApp,
  listRemoteProjects,
  loadDemoRepository,
  mergeBranch,
  openRepository,
  pickDirectory,
  rebaseBranch,
  saveConflictResolution,
} from "./api";
import type { Branch, CommitChangedFile, CommitDetails, CommitNode, ConflictFile, GitProvider, RemoteProject, RepositoryState, WorkingTreeFile } from "./types";

type DragPayload =
  | { type: "branch"; branch: Branch }
  | { type: "commit"; commit: CommitNode };

const defaultPath = "/home/sala10-mesa1/Documentos/Projetos/GitCrack";

export function App() {
  const [repoPath, setRepoPath] = useState(defaultPath);
  const [state, setState] = useState<RepositoryState | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<CommitNode | null>(null);
  const [compareBase, setCompareBase] = useState<CommitNode | null>(null);
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null);
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [selectedWorkingTreePath, setSelectedWorkingTreePath] = useState<string | null>(null);
  const [mode, setMode] = useState<"merge" | "rebase" | "cherry-pick">("merge");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(
    isDesktopApp
      ? "Select a local Git repository or connect GitHub or GitLab."
      : "Browser mode: native Git, directory selection and GitHub/GitLab clone require the Tauri desktop app.",
  );
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);
  const [provider, setProvider] = useState<GitProvider>("gitlab");
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState(defaultBaseUrl("gitlab"));
  const [gitlabToken, setGitlabToken] = useState("");
  const [gitlabSearch, setGitlabSearch] = useState("");
  const [gitlabProjects, setGitlabProjects] = useState<RemoteProject[]>([]);

  const selectedConflict = state?.conflicts[0] ?? null;

  async function run<T>(task: () => Promise<T>, after: (value: T) => void) {
    setBusy(true);
    try {
      const value = await task();
      after(value);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function clearSelection() {
    setSelectedCommit(null);
    setCompareBase(null);
    setCommitDetails(null);
    setSelectedCommitFile(null);
    setSelectedWorkingTreePath(null);
    setDiff("");
  }

  function selectCommit(commit: CommitNode) {
    setSelectedCommit(commit);
    setSelectedCommitFile(null);
    setSelectedWorkingTreePath(null);
    if (compareBase) {
      setCommitDetails(null);
      void run(
        () => getDiff(compareBase.id, commit.id),
        (patch) => {
          setDiff(patch);
          setNotice(`Comparing ${compareBase.shortId}..${commit.shortId}`);
        },
      );
    } else {
      void run(
        () => getCommitDetails(commit.id),
        (details) => {
          setCommitDetails(details);
          setDiff(details.patch);
          setNotice(`Showing changes for ${commit.shortId}`);
        },
      );
    }
  }

  function showWorkingTreeDiff(filePath?: string) {
    void run(
      () => getWorkingTreeDiff(filePath),
      (patch) => {
        setDiff(patch);
        setCommitDetails(null);
        setSelectedCommitFile(null);
        setSelectedWorkingTreePath(filePath ?? null);
        setNotice(filePath ? `Showing local changes for ${filePath}` : "Showing all local changes");
      },
    );
  }

  function handleProjectSearch() {
    const normalized = normalizeBaseUrl(gitlabBaseUrl, provider);
    if (!normalized) {
      setNotice("Informe uma URL base valida do " + providerLabel(provider) + ", por exemplo " + defaultBaseUrl(provider) + ".");
      return;
    }

    setGitlabProjects([]);
    void run(
      () => listRemoteProjects(provider, normalized, gitlabToken, gitlabSearch),
      (projects) => {
        setGitlabBaseUrl(normalized);
        setGitlabProjects(projects);
        setNotice("Loaded " + projects.length + " " + providerLabel(provider) + " project(s)");
      },
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const active = event.active.data.current as DragPayload | undefined;
    const over = event.over?.data.current as { branch: Branch } | undefined;
    setActiveDrag(null);
    if (!active || !over || !state) return;

    if (active.type === "branch" && active.branch.shorthand !== over.branch.shorthand) {
      const action = mode === "rebase" ? rebaseBranch : mergeBranch;
      void run(
        () => action(active.branch.shorthand, over.branch.shorthand),
        (result) => {
          setState(result.state);
          setNotice(result.message);
        },
      );
      return;
    }

    if (active.type === "commit") {
      void run(
        () => cherryPick(active.commit.id, over.branch.shorthand),
        (result) => {
          setState(result.state);
          setNotice(result.message);
        },
      );
    }
  }

  return (
    <DndContext
      onDragStart={(event) => setActiveDrag(event.active.data.current as DragPayload)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <main className="app-shell">
        {!isDesktopApp && (
          <div className="runtime-banner">
            You are running the Vite browser frontend. Real repositories, native directory browsing and GitLab integration require <code>npm run tauri:dev</code>.
          </div>
        )}
        <header className="topbar">
          <div>
            <strong>GitCrack</strong>
            <span>{state?.head ? `HEAD: ${state.head}` : "No repository loaded"}</span>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => openRepository(repoPath), (next) => {
                setState(next);
                clearSelection();
              });
            }}
          >
            <input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} />
            <button
              type="button"
              disabled={busy || !isDesktopApp}
              onClick={() =>
                void run(pickDirectory, (path) => {
                  if (path) {
                    setRepoPath(path);
                    void run(() => openRepository(path), (next) => {
                      setState(next);
                      clearSelection();
                    });
                  }
                })
              }
            >
              Browse
            </button>
            <button disabled={busy || !isDesktopApp}>Open</button>
            <button
              type="button"
              disabled={busy || !isDesktopApp}
              onClick={() =>
                void run(getRepositoryState, (next) => {
                  setState(next);
                  clearSelection();
                })
              }
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setState(loadDemoRepository());
                clearSelection();
                setNotice("Loaded demo graph. Real repositories require the desktop app.");
              }}
            >
              Demo
            </button>
          </form>
        </header>

        <section className="workspace">
          <aside className="sidebar">
            <div className="segmented">
              {(["merge", "rebase", "cherry-pick"] as const).map((item) => (
                <button
                  key={item}
                  className={mode === item ? "active" : ""}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <h2>Branches</h2>
            <div className="branch-list">
              {state?.branches.map((branch) => (
                <BranchItem
                  key={branch.name}
                  branch={branch}
                  onCheckout={() =>
                    void run(() => checkoutRef(branch.shorthand), (next) => {
                      setState(next);
                      clearSelection();
                      setNotice(`Checked out ${branch.shorthand}`);
                    })
                  }
                />
              ))}
            </div>
            <GitLabPanel
              provider={provider}
              baseUrl={gitlabBaseUrl}
              token={gitlabToken}
              search={gitlabSearch}
              projects={gitlabProjects}
              busy={busy || !isDesktopApp}
              nativeAvailable={isDesktopApp}
              onProviderChange={(nextProvider) => {
                setProvider(nextProvider);
                setGitlabBaseUrl(defaultBaseUrl(nextProvider));
                setGitlabProjects([]);
              }}
              onBaseUrlChange={setGitlabBaseUrl}
              onTokenChange={setGitlabToken}
              onSearchChange={setGitlabSearch}
              onSearch={handleProjectSearch}
              onClone={(project) =>
                void run(pickDirectory, (directory) => {
                  if (!directory) return;
                  const repoName = project.pathWithNamespace.split("/").at(-1) ?? project.name;
                  const destination = `${directory.replace(/\/$/, "")}/${repoName}`;
                  void run(
                    () => cloneRepository(project.provider, project.httpUrlToRepo, destination, gitlabToken),
                    (next) => {
                      setRepoPath(next.path);
                      setState(next);
                      clearSelection();
                      setNotice(`Cloned ${project.pathWithNamespace}`);
                    },
                  );
                })
              }
            />
          </aside>

          <section className="graph-pane">
            {state ? (
              <CommitGraph
                commits={state.commits}
                branches={state.branches}
                selected={selectedCommit?.id ?? null}
                compareBase={compareBase?.id ?? null}
                onSelect={selectCommit}
                onCompare={setCompareBase}
              />
            ) : (
              <div className="empty">Open a Git repository path to inspect it.</div>
            )}
          </section>

          <aside className="details">
            <p className="notice">{busy ? "Working..." : notice}</p>
            <CommitInspector
              commit={selectedCommit}
              details={commitDetails}
              compareBase={compareBase}
              selectedFile={selectedCommitFile}
              onSelectFile={(file) => setSelectedCommitFile(file.path)}
            />
            <LocalChangesPanel
              files={state?.workingTreeChanges ?? []}
              selectedPath={selectedWorkingTreePath}
              onShowAll={() => showWorkingTreeDiff()}
              onSelect={(file) => showWorkingTreeDiff(file.path)}
            />
            <ConflictPanel
              conflict={selectedConflict}
              onSave={(content) =>
                selectedConflict &&
                void run(
                  () => saveConflictResolution(selectedConflict.path, content),
                  (next) => {
                    setState(next);
                    setNotice(`Saved resolution for ${selectedConflict.path}`);
                  },
                )
              }
              onContinue={() =>
                void run(continueOperation, (result) => {
                  setState(result.state);
                  setNotice(result.message);
                })
              }
              onAbort={() =>
                void run(abortOperation, (next) => {
                  setState(next);
                  setNotice("Operation aborted");
                })
              }
            />
            <div className="diff-panel">
              <h2>Diff</h2>
              <Editor height="38vh" language="diff" theme="vs-dark" value={diff} options={{ readOnly: true }} />
            </div>
          </aside>
        </section>
      </main>
      <DragOverlay>{activeDrag ? <div className="drag-card">{dragLabel(activeDrag)}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function defaultBaseUrl(provider: GitProvider) {
  return provider === "github" ? "https://github.com" : "https://gitlab.com";
}

function providerLabel(provider: GitProvider) {
  return provider === "github" ? "GitHub" : "GitLab";
}

function normalizeBaseUrl(value: string, provider: GitProvider) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (provider === "github" && pathname === "/api/v3") {
      return url.origin + "/api/v3";
    }
    return url.origin;
  } catch {
    return null;
  }
}

function BranchItem({ branch, onCheckout }: { branch: Branch; onCheckout: () => void }) {
  const drag = useDraggable({
    id: `branch:${branch.shorthand}`,
    data: { type: "branch", branch } satisfies DragPayload,
  });
  const drop = useDroppable({
    id: `drop:${branch.shorthand}`,
    data: { branch },
  });

  return (
    <div ref={drop.setNodeRef} className={`branch-drop ${drop.isOver ? "over" : ""}`}>
      <button
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        className={`branch-item ${branch.isHead ? "current" : ""}`}
      >
        <span>{branch.shorthand}</span>
        {branch.isRemote && <small>remote</small>}
      </button>
      <button className="checkout" onClick={onCheckout}>Checkout</button>
    </div>
  );
}

function GitLabPanel({
  provider,
  baseUrl,
  token,
  search,
  projects,
  busy,
  nativeAvailable,
  onProviderChange,
  onBaseUrlChange,
  onTokenChange,
  onSearchChange,
  onSearch,
  onClone,
}: {
  provider: GitProvider;
  baseUrl: string;
  token: string;
  search: string;
  projects: RemoteProject[];
  busy: boolean;
  nativeAvailable: boolean;
  onProviderChange: (value: GitProvider) => void;
  onBaseUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onClone: (project: RemoteProject) => void;
}) {
  return (
    <section className="gitlab-panel">
      <h2>Remote</h2>
      {!nativeAvailable && <p className="inline-warning">Available in the desktop app only.</p>}
      <p className="inline-hint">
        {provider === "github"
          ? "Use https://github.com or your GitHub Enterprise base URL. API URLs ending with /api/v3 are also accepted."
          : "Use https://gitlab.com or your self-hosted GitLab base URL."}
      </p>
      <label>
        <span>Provider</span>
        <select value={provider} onChange={(event) => onProviderChange(event.target.value as GitProvider)}>
          <option value="gitlab">GitLab</option>
          <option value="github">GitHub</option>
        </select>
      </label>
      <label>
        <span>URL</span>
        <input value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} />
      </label>
      <label>
        <span>Token</span>
        <input
          type="password"
          value={token}
          onChange={(event) => onTokenChange(event.target.value)}
          placeholder={provider === "github" ? "GitHub Personal Access Token" : "GitLab Personal Access Token"}
        />
      </label>
      <label>
        <span>Search</span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} />
      </label>
      <button disabled={busy || !nativeAvailable || !baseUrl || !token} onClick={onSearch}>
        Load projects
      </button>
      <div className="gitlab-projects">
        {projects.map((project) => (
          <article key={project.provider + ":" + project.id} className="gitlab-project">
            <strong>{project.name}</strong>
            <span>{project.pathWithNamespace}</span>
            <div className="row">
              <a href={project.webUrl} target="_blank" rel="noreferrer">Open</a>
              <button disabled={busy || !nativeAvailable} onClick={() => onClone(project)}>Clone</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CommitGraph({
  commits,
  branches,
  selected,
  compareBase,
  onSelect,
  onCompare,
}: {
  commits: CommitNode[];
  branches: Branch[];
  selected: string | null;
  compareBase: string | null;
  onSelect: (commit: CommitNode) => void;
  onCompare: (commit: CommitNode) => void;
}) {
  const byId = useMemo(() => new Map(commits.map((commit) => [commit.id, commit])), [commits]);
  const branchByTarget = useMemo(() => {
    const map = new Map<string, Branch[]>();
    for (const branch of branches) {
      if (!branch.target) continue;
      const list = map.get(branch.target) ?? [];
      list.push(branch);
      map.set(branch.target, list);
    }
    return map;
  }, [branches]);
  const maxLane = commits.length ? Math.max(...commits.map((commit) => commit.lane)) : 0;
  const graphWidth = Math.max(240, 76 + maxLane * 48 + 72);
  const branchWidth = 230;
  const messageWidth = 820;
  const height = Math.max(520, commits.length * 76 + 90);
  const headerHeight = 28;
  const width = branchWidth + graphWidth + messageWidth;

  function graphX(commit: CommitNode) {
    return 42 + commit.lane * 48;
  }

  function branchLabelX(commit: CommitNode) {
    return branchWidth - 14;
  }

  return (
    <div className="commit-table" style={{ width, height: height + headerHeight }}>
      <div className="commit-table-header" style={{ gridTemplateColumns: `${branchWidth}px ${graphWidth}px ${messageWidth}px` }}>
        <span>BRANCH / TAG</span>
        <span>GRAPH</span>
        <span>COMMIT MESSAGE</span>
      </div>
      <svg className="commit-graph" width={branchWidth + graphWidth} height={height} viewBox={`0 0 ${branchWidth + graphWidth} ${height}`}>
        <defs>
          <filter id="commitGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="branch-column-bg" x="0" y="0" width={branchWidth} height={height} />
        <rect className="graph-column-bg" x={branchWidth} y="0" width={graphWidth} height={height} />
        <line className="column-divider" x1={branchWidth} y1="0" x2={branchWidth} y2={height} />
        {commits.flatMap((commit) =>
          commit.parents.map((parentId) => {
            const parent = byId.get(parentId);
            if (!parent) return null;
            const x1 = branchWidth + graphX(commit);
            const x2 = branchWidth + graphX(parent);
            const y1 = commit.y + 13;
            const y2 = parent.y - 13;
            const midY = y1 + Math.max(18, Math.floor((y2 - y1) / 2));
            return (
              <path
                key={`${commit.id}-${parentId}`}
                className="edge"
                style={{ stroke: laneColor(commit.lane) }}
                d={`M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`}
              />
            );
          }),
        )}
        {commits.map((commit) => (
          <BranchColumnLabels
            key={`branches:${commit.id}`}
            commit={commit}
            branches={branchByTarget.get(commit.id) ?? []}
            x={branchLabelX(commit)}
          />
        ))}
        {commits.map((commit) => (
          <CommitGlyph
            key={commit.id}
            commit={commit}
            x={branchWidth + graphX(commit)}
            selected={selected === commit.id}
            compareBase={compareBase === commit.id}
            onSelect={() => onSelect(commit)}
          />
        ))}
      </svg>
      <div className="commit-message-column" style={{ left: branchWidth + graphWidth, width: messageWidth, height }}>
        {commits.map((commit) => (
          <CommitMessageRow
            key={`message:${commit.id}`}
            commit={commit}
            selected={selected === commit.id}
            compareBase={compareBase === commit.id}
            onSelect={() => onSelect(commit)}
            onCompare={() => onCompare(commit)}
          />
        ))}
      </div>
    </div>
  );
}

function BranchColumnLabels({
  commit,
  branches,
  x,
}: {
  commit: CommitNode;
  branches: Branch[];
  x: number;
}) {
  const labelBranches = branches.length > 0
    ? branches
    : commit.branches.map((branch) => ({
        name: branch,
        shorthand: branch,
        target: commit.id,
        isHead: false,
        isRemote: branch.includes("/"),
      }));

  if (labelBranches.length === 0) return null;

  return (
    <foreignObject x="10" y={commit.y - 13} width={x - 10} height="28">
      <div className="branch-column-tags">
        {labelBranches.slice(0, 2).map((branch) => (
          <span
            key={branch.name || branch.shorthand}
            className={`branch-chip ${branch.isHead ? "head" : ""} ${branch.isRemote ? "remote" : "local"}`}
            style={{ borderColor: laneColor(commit.lane) }}
          >
            {branch.isHead ? "HEAD · " : ""}{branch.shorthand}
          </span>
        ))}
        {labelBranches.length > 2 && <span className="branch-chip muted">+{labelBranches.length - 2}</span>}
      </div>
    </foreignObject>
  );
}

function CommitGlyph({
  commit,
  x,
  selected,
  compareBase,
  onSelect,
}: {
  commit: CommitNode;
  x: number;
  selected: boolean;
  compareBase: boolean;
  onSelect: () => void;
}) {
  const drag = useDraggable({
    id: `commit:${commit.id}`,
    data: { type: "commit", commit } satisfies DragPayload,
  });
  const color = laneColor(commit.lane);

  return (
    <g
      ref={(node) => drag.setNodeRef(node as unknown as HTMLElement | null)}
      {...drag.listeners}
      {...drag.attributes}
      className={`commit-glyph ${selected ? "is-selected" : ""}`}
    >
      <circle
        cx={x}
        cy={commit.y}
        r="12"
        className={selected ? "selected" : compareBase ? "base" : ""}
        style={{ stroke: color }}
        filter={selected ? "url(#commitGlow)" : undefined}
        onClick={onSelect}
      />
      <circle cx={x} cy={commit.y} r="5" className="commit-dot" style={{ fill: color }} onClick={onSelect} />
    </g>
  );
}

function CommitMessageRow({
  commit,
  selected,
  compareBase,
  onSelect,
  onCompare,
}: {
  commit: CommitNode;
  selected: boolean;
  compareBase: boolean;
  onSelect: () => void;
  onCompare: () => void;
}) {
  return (
    <button
      className={`commit-message-row ${selected ? "selected" : ""} ${compareBase ? "base" : ""}`}
      style={{ top: commit.y - 22 }}
      onClick={onSelect}
      type="button"
    >
      <span className="commit-summary">{commit.summary}</span>
      <span className="commit-meta-inline">{commit.shortId} · {commit.author}</span>
      <span className="compare-inline" onClick={(event) => { event.stopPropagation(); onCompare(); }}>Compare</span>
    </button>
  );
}

function CommitInspector({
  commit,
  details,
  compareBase,
  selectedFile,
  onSelectFile,
}: {
  commit: CommitNode | null;
  details: CommitDetails | null;
  compareBase: CommitNode | null;
  selectedFile: string | null;
  onSelectFile: (file: CommitChangedFile) => void;
}) {
  if (!commit) {
    return <section className="panel"><h2>Commit</h2><p>Select a commit in the graph.</p></section>;
  }

  return (
    <section className="panel commit-inspector">
      <h2>Commit</h2>
      <strong>{commit.summary}</strong>
      <div className="commit-meta-grid">
        <span>Hash</span><code title={commit.id}>{commit.shortId}</code>
        <span>Author</span><p>{commit.author} &lt;{commit.email}&gt;</p>
        <span>Date</span><p>{new Date(commit.time * 1000).toLocaleString()}</p>
        <span>Parents</span><p>{commit.parents.length ? commit.parents.map((parent) => parent.slice(0, 7)).join(", ") : "initial commit"}</p>
      </div>
      {commit.branches.length > 0 && (
        <div className="branch-tags inspector-tags">
          {commit.branches.map((branch) => <span key={branch} className="branch-chip local">{branch}</span>)}
        </div>
      )}
      {compareBase ? (
        <p className="inline-hint">Comparing from {compareBase.shortId}. File list is shown for normal commit selection.</p>
      ) : (
        <CommitFileList files={details?.files ?? []} selectedFile={selectedFile} onSelectFile={onSelectFile} />
      )}
    </section>
  );
}

function CommitFileList({
  files,
  selectedFile,
  onSelectFile,
}: {
  files: CommitChangedFile[];
  selectedFile: string | null;
  onSelectFile: (file: CommitChangedFile) => void;
}) {
  if (files.length === 0) return <p>No files loaded for this commit yet.</p>;

  return (
    <div className="commit-file-list">
      <div className="row panel-header">
        <h2>Modified Files</h2>
        <small>{files.length} file{files.length === 1 ? "" : "s"}</small>
      </div>
      {files.map((file) => (
        <button
          key={`${file.status}:${file.path}:${file.oldPath ?? ""}`}
          className={`commit-file ${selectedFile === file.path ? "active" : ""}`}
          onClick={() => onSelectFile(file)}
        >
          <span className={`status-dot ${file.status}`}>{statusInitial(file.status)}</span>
          <span>{file.oldPath && file.oldPath !== file.path ? `${file.oldPath} -> ${file.path}` : file.path}</span>
          <small>+{file.additions} -{file.deletions}</small>
        </button>
      ))}
    </div>
  );
}

function laneColor(lane: number) {
  const colors = ["#00d0ff", "#b15cff", "#ff3ea5", "#ffb02e", "#5ee06f", "#ff5f4a", "#45a3ff", "#d6e04f"];
  return colors[lane % colors.length];
}

function statusInitial(status: string) {
  return status.slice(0, 1).toUpperCase();
}

function LocalChangesPanel({
  files,
  selectedPath,
  onSelect,
  onShowAll,
}: {
  files: WorkingTreeFile[];
  selectedPath: string | null;
  onSelect: (file: WorkingTreeFile) => void;
  onShowAll: () => void;
}) {
  return (
    <section className="panel local-changes-panel">
      <div className="row panel-header">
        <h2>Local Changes</h2>
        <button disabled={files.length === 0} onClick={onShowAll}>Show all</button>
      </div>
      {files.length === 0 ? (
        <p>No local changes detected.</p>
      ) : (
        <div className="change-list">
          {files.map((file) => (
            <button
              key={file.path}
              className={`change-item ${selectedPath === file.path ? "active" : ""}`}
              onClick={() => onSelect(file)}
            >
              <span>{file.path}</span>
              <small>{file.status}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ConflictPanel({
  conflict,
  onSave,
  onContinue,
  onAbort,
}: {
  conflict: ConflictFile | null;
  onSave: (content: string) => void;
  onContinue: () => void;
  onAbort: () => void;
}) {
  const [content, setContent] = useState("");
  if (!conflict) return null;

  return (
    <section className="panel conflict-panel">
      <h2>Conflict: {conflict.path}</h2>
      <Editor
        height="32vh"
        language="plaintext"
        theme="vs-dark"
        value={content || conflict.result}
        onChange={(value) => setContent(value ?? "")}
      />
      <div className="row">
        <button onClick={() => onSave(content || conflict.result)}>Save resolution</button>
        <button onClick={onContinue}>Continue</button>
        <button onClick={onAbort}>Abort</button>
      </div>
    </section>
  );
}

function dragLabel(payload: DragPayload) {
  return payload.type === "branch" ? payload.branch.shorthand : payload.commit.shortId;
}
