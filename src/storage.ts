import { blankStore, parseStore, type Store } from "./model";

export interface RepositoryBranch {
  /** 短名，不含远程前缀，例如 feature/login */
  name: string;
  local: boolean;
  /** 远程仓库名，例如 origin；没有远程分支时为 null */
  remote: string | null;
  /** 远程引用短名，例如 origin/feature/login */
  remoteRef: string | null;
  /** 同名分支在所有远程上的引用，例如 ["origin/main", "github/main"]；origin 排最前 */
  remoteRefs?: string[];
  localCommit: string | null;
  remoteCommit: string | null;
  commit: string;
  subject: string;
  updatedAt: string;
  current: boolean;
  upstream: string;
  ahead: number;
  behind: number;
}
export interface Repository {
  path: string;
  current: string;
  defaultBranch: string;
  remotes: string[];
  /** 远程名 → 仓库地址（如 origin → git@github.com:me/repo.git） */
  remoteUrls?: Record<string, string>;
  /** 仓库配置的提交身份；未配置时为空字符串 */
  user?: { name: string; email: string };
  branches: RepositoryBranch[];
}
export interface FetchResult {
  repository: Repository;
  updated: { name: string; from: string; to: string }[];
  added: string[];
  removed: string[];
  errors: string[];
}
export interface MergePlan {
  id: string;
  path: string;
  target: string;
  targetMode: "local" | "remote" | "create";
  targetLocal: string;
  targetRef: string;
  targetRemoteRef: string;
  create: boolean;
  base: string;
  baseRef: string;
  resolveBranch: string;
  stage: string;
  currentBranch: string;
  targetHead: string;
  localHead: string | null;
  sources: { name: string; ref: string; head: string; subject?: string }[];
}
export interface PreflightResult {
  status: "clean" | "conflict";
  branch: string;
  files: string[];
  merged: string[];
  pending: string[];
  resolveBranch: string;
}
export interface MergeResult {
  sourceRef?: string;
  sourceHead?: string;
  status: "success" | "failed" | "conflict";
  workingBranch: string;
  target: string;
  targetMode: "local" | "remote" | "create";
  targetLocal: string;
  remoteRef: string;
  fastForwarded: boolean;
  merged: string[];
  pending: string[];
  conflicts: string[];
  message: string;
  logs: string[];
}
export interface ContinueResult {
  status: "success" | "failed" | "conflict";
  workingBranch: string;
  merged: string[];
  pending: string[];
  conflicts: string[];
  message: string;
  logs: string[];
}
export interface MergeSession {
  mrTarget?: string;
  sources?: string[];
  id: string;
  stage: string;
  target: string;
  targetMode: "local" | "remote" | "create";
  targetLocal: string;
  remoteRef: string;
  branch: string;
  merged: string[];
  pending: string[];
  startedAt: string;
}
export interface MergeState {
  path: string;
  branch: string;
  merging: boolean;
  unmerged: string[];
  staged: string[];
  session: MergeSession | null;
}
export interface ConflictFile {
  file: string;
  binary: boolean;
  working: string | null;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  exists: { working: boolean; ours: boolean; theirs: boolean };
}
export interface ConflictState {
  unmerged: string[];
  staged: string[];
}
export interface ConflictResolution extends ConflictState {
  file: string;
}
export interface CommitResult {
  commit: string;
  output: string;
  branch: string;
}
export interface AbortResult {
  branch: string;
  removed: string[];
}
export interface FinalizeResult {
  branch: string;
  commit: string;
  removed: string[];
}
export interface PushResult {
  remote: string;
  branch: string;
  remoteBranch: string;
  output: string;
}
/** 按域名保存的代码托管令牌；只有掩码，令牌原文不出主进程 */
export interface HostCredential {
  host: string;
  provider: "gitlab" | "github";
  scheme: string;
  hint: string;
  /** false 表示系统钥匙串不可用，令牌以明文（base64）落盘 */
  encrypted: boolean;
  updatedAt: string;
}
export interface HostSaveResult {
  hosts: HostCredential[];
  entry: HostCredential;
}
export interface HostTestResult {
  ok: boolean;
  account: string;
  message: string;
}
export interface MRStatusResult {
  url: string;
  state?: "opened" | "closed" | "merged";
  mergedAt?: string | null;
  error?: string;
}
export interface MergeRequestResult {
  status: "created" | "exists" | "no-token" | "unsupported" | "failed";
  provider?: "gitlab" | "github" | "other";
  url?: string;
  number?: string;
  message: string;
}

declare global {
  interface Window {
    branchNote?: {
      pickRepository(): Promise<Repository | null>;
      readRepository(path: string): Promise<Repository>;
      fetchRepository(path: string): Promise<FetchResult>;
      prepareMerge(
        path: string,
        target: string,
        sources: string[],
        resolveBranch: string,
        options?: { create?: boolean; base?: string; stage?: string; mrTarget?: string },
      ): Promise<MergePlan>;
      checkMerge(planId: string): Promise<PreflightResult>;
      executeMerge(planId: string, confirmed?: boolean): Promise<MergeResult>;
      pushBranch(
        path: string,
        branch: string,
        remote?: string,
        checkedSource?: {ref: string; head: string},
      ): Promise<PushResult>;
      mergeState(path: string): Promise<MergeState>;
      readConflict(path: string, file: string): Promise<ConflictFile>;
      openConflictInEditor(
        path: string,
        file: string,
      ): Promise<{ file: string; path: string }>;
      readWorkingFile(
        path: string,
        file: string,
      ): Promise<{ file: string; content: string | null }>;
      resolveConflict(
        path: string,
        file: string,
        content: string,
      ): Promise<ConflictResolution>;
      takeConflictSide(
        path: string,
        file: string,
        side: "ours" | "theirs",
      ): Promise<ConflictResolution>;
      unionConflict(
        path: string,
        file: string,
      ): Promise<{ file: string; content: string }>;
      commitConflict(path: string, message: string): Promise<CommitResult>;
      abortConflict(path: string, returnTo: string): Promise<AbortResult>;
      mergeRequestUrl(
        path: string,
        source: string,
        target: string,
        remote?: string,
      ): Promise<string>;
      openUrl(url: string): Promise<void>;
      createMergeRequest(
        directory: string,
        source: string,
        target: string,
        title?: string,
        description?: string,
        remote?: string,
      ): Promise<MergeRequestResult>;
      syncMergeRequests(urls: string[]): Promise<MRStatusResult[]>;
      listHosts(): Promise<HostCredential[]>;
      saveHost(payload: {
        host: string;
        provider: "gitlab" | "github";
        token: string;
      }): Promise<HostSaveResult>;
      removeHost(host: string): Promise<HostCredential[]>;
      testHost(payload: {
        host: string;
        provider: "gitlab" | "github";
      }): Promise<HostTestResult>;
      continueMerge(
        path: string,
        branch: string,
        sources: string[],
      ): Promise<ContinueResult>;
      finalizeMerge(
        path: string,
        targetLocal: string,
        from: string,
      ): Promise<FinalizeResult>;
      read(): Promise<string | null>;
      write(content: string): Promise<void>;
      backup(content: string): Promise<void>;
      export(content: string, name: string): Promise<boolean>;
    };
  }
}
const key = "branchnote-v1";
export async function load(): Promise<Store> {
  const raw = window.branchNote
    ? await window.branchNote.read()
    : localStorage.getItem(key);
  return raw ? parseStore(raw) : blankStore();
}
export async function save(store: Store): Promise<void> {
  const content = JSON.stringify(store, null, 2);
  if (window.branchNote) await window.branchNote.write(content);
  else localStorage.setItem(key, content);
}
export async function backup(store: Store): Promise<void> {
  const content = JSON.stringify(store, null, 2);
  if (window.branchNote) await window.branchNote.backup(content);
  else localStorage.setItem(`branchnote-before-restore-${Date.now()}`, content);
}
export async function exportBackup(store: Store): Promise<boolean> {
  const content = JSON.stringify(store, null, 2);
  const name = `BranchNote-${new Date().toISOString().slice(0, 10)}.json`;
  if (window.branchNote) return window.branchNote.export(content, name);
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
