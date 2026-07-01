export type GitProvider = "gitlab" | "github";

export type Branch = {
  name: string;
  shorthand: string;
  target: string | null;
  isHead: boolean;
  isRemote: boolean;
};

export type CommitNode = {
  id: string;
  shortId: string;
  summary: string;
  message: string;
  author: string;
  email: string;
  time: number;
  parents: string[];
  branches: string[];
  x: number;
  y: number;
  lane: number;
};

export type CommitChangedFile = {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
};

export type CommitDetails = {
  commitId: string;
  files: CommitChangedFile[];
  patch: string;
};

export type ConflictFile = {
  path: string;
  ancestor: string;
  ours: string;
  theirs: string;
  result: string;
};

export type WorkingTreeFile = {
  path: string;
  status: string;
};

export type RepositoryState = {
  path: string;
  head: string | null;
  branches: Branch[];
  commits: CommitNode[];
  conflicts: ConflictFile[];
  workingTreeChanges: WorkingTreeFile[];
};

export type OperationResult = {
  status: "clean" | "conflicts";
  message: string;
  state: RepositoryState;
};

export type RemoteProject = {
  id: number;
  provider: GitProvider;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  httpUrlToRepo: string;
  sshUrlToRepo: string;
  defaultBranch: string | null;
};
