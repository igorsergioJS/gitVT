import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { CommitDetails, GitProvider, OperationResult, RemoteProject, RepositoryState } from "./types";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;

const demoState: RepositoryState = {
  path: "demo",
  head: "main",
  branches: [
    { name: "refs/heads/main", shorthand: "main", target: "a6e4f21", isHead: true, isRemote: false },
    { name: "refs/heads/feature/graph", shorthand: "feature/graph", target: "d81b0ac", isHead: false, isRemote: false },
    { name: "refs/heads/release", shorthand: "release", target: "8c351a2", isHead: false, isRemote: false },
  ],
  commits: [
    node("a6e4f21", "Polish repository overview", ["b413f62"], 0, 0, ["main"]),
    node("b413f62", "Merge branch feature/graph", ["89d21fb", "d81b0ac"], 0, 1, []),
    node("d81b0ac", "Add visual cherry-pick action", ["c1ab093"], 1, 2, ["feature/graph"]),
    node("c1ab093", "Render commit graph lanes", ["89d21fb"], 1, 3, []),
    node("89d21fb", "Add diff panel", ["8c351a2"], 0, 4, []),
    node("8c351a2", "Initial repository commands", [], 0, 5, ["release"]),
  ],
  conflicts: [],
  workingTreeChanges: [
    { path: "src/App.tsx", status: "modified" },
  ],
};

function node(id: string, summary: string, parents: string[], lane: number, row: number, branches: string[]) {
  return {
    id,
    shortId: id,
    summary,
    message: `${summary}\n\nDemo commit`,
    author: "GitCrack",
    email: "local@example.com",
    time: Date.now() / 1000 - row * 3600,
    parents,
    branches,
    x: 80 + lane * 92,
    y: 52 + row * 74,
    lane,
  };
}

export async function openRepository(path: string): Promise<RepositoryState> {
  ensureDesktop();
  return invoke("open_repository", { path });
}

export async function pickDirectory(): Promise<string | null> {
  ensureDesktop();
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function getRepositoryState(): Promise<RepositoryState> {
  ensureDesktop();
  return invoke("get_repository_state");
}

export async function checkoutRef(refName: string): Promise<RepositoryState> {
  ensureDesktop();
  return invoke("checkout_ref", { refName });
}

export async function mergeBranch(source: string, target: string): Promise<OperationResult> {
  ensureDesktop();
  return invoke("merge_branch", { source, target });
}

export async function rebaseBranch(source: string, target: string): Promise<OperationResult> {
  ensureDesktop();
  return invoke("rebase_branch", { source, target });
}

export async function cherryPick(commitSha: string, targetBranch: string): Promise<OperationResult> {
  ensureDesktop();
  return invoke("cherry_pick", { commitSha, targetBranch });
}

export async function getDiff(base: string, head: string): Promise<string> {
  if (!isDesktopApp) return `diff --git a/demo b/demo\n+ Demo comparison: ${base}..${head}\n`;
  return invoke("get_diff", { base, head });
}

export async function getCommitDetails(commitSha: string): Promise<CommitDetails> {
  if (!isDesktopApp) {
    return {
      commitId: commitSha,
      files: [
        { path: "demo.txt", oldPath: null, status: "modified", additions: 1, deletions: 0 },
      ],
      patch: `diff --git a/demo.txt b/demo.txt\n+ Demo changes for ${commitSha}\n`,
    };
  }
  return invoke("get_commit_details", { commitSha });
}

export async function getWorkingTreeDiff(filePath?: string): Promise<string> {
  ensureDesktop();
  return invoke("get_working_tree_diff", { filePath });
}

export async function saveConflictResolution(filePath: string, content: string): Promise<RepositoryState> {
  ensureDesktop();
  return invoke("save_conflict_resolution", { filePath, content });
}

export async function continueOperation(): Promise<OperationResult> {
  ensureDesktop();
  return invoke("continue_operation");
}

export async function abortOperation(): Promise<RepositoryState> {
  ensureDesktop();
  return invoke("abort_operation");
}

export async function listRemoteProjects(
  provider: GitProvider,
  baseUrl: string,
  token: string,
  search: string,
): Promise<RemoteProject[]> {
  ensureDesktop();
  return invoke("list_remote_projects", { provider, baseUrl, token, search });
}

export async function cloneRepository(
  provider: GitProvider,
  remoteUrl: string,
  destination: string,
  token: string,
): Promise<RepositoryState> {
  ensureDesktop();
  return invoke("clone_repository", { provider, remoteUrl, destination, token });
}

export function loadDemoRepository(): RepositoryState {
  return demoState;
}

function ensureDesktop() {
  if (!isDesktopApp) {
    throw new Error("Esta função só funciona no app desktop Tauri. Rode `npm run tauri:dev`; no navegador o sistema não pode acessar seus diretórios, Git local ou clonar repositórios.");
  }
}
