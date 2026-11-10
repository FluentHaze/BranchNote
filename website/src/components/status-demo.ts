export type MergeStatus = "merged" | "opened" | "pending";
export type Target = "test" | "release";
export const previewModes = ["overview", "targets", "preflight"] as const;
export type PreviewMode = (typeof previewModes)[number];

export interface DemoBranch {
  name: string;
  test: MergeStatus;
  release: MergeStatus;
}

// One dataset drives both the graph and the adjacent status panel.
export const statusBranches: DemoBranch[] = [
  { name: "feature/auth", test: "merged", release: "opened" },
  { name: "fix/token-refresh", test: "merged", release: "merged" },
  { name: "feature/webhooks", test: "pending", release: "pending" },
];

export const targetBranches: Record<Target, string> = {
  test: "origin/develop",
  release: "origin/main",
};
