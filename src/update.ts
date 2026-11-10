export interface UpdateState {
  currentVersion: string;
  installMode: "dmg" | "restart";
  status: "idle" | "manual" | "checking" | "latest" | "downloading" | "downloaded" | "installing" | "error";
  version?: string;
  percent?: number;
  error?: string;
}

export type UpdateAction = "check" | "install" | "manual";
