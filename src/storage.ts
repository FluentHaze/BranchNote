import { blankStore, parseStore, type Store } from "./model";

export interface Repository {
  path: string;
  branches: {
    name: string;
    commit: string;
    subject: string;
    updatedAt: string;
    current: boolean;
  }[];
}
export interface MergePlan {
  id: string;
  path: string;
  target: string;
  create: boolean;
  base: string;
  resolveBranch: string;
  currentBranch: string;
  targetHead: string;
  sources: { name: string; head: string }[];
}
export interface MergeResult {
  status: "success" | "failed" | "conflict";
  workingBranch: string;
  merged: string[];
  pending: string[];
  conflicts: string[];
  message: string;
  logs: string[];
}

declare global {
  interface Window {
    branchNote?: {
      pickRepository(): Promise<Repository | null>;
      readRepository(path: string): Promise<Repository>;
      prepareMerge(
        path: string,
        target: string,
        sources: string[],
        resolveBranch: string,
        options?: { create?: boolean; base?: string },
      ): Promise<MergePlan>;
      executeMerge(planId: string): Promise<MergeResult>;
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
