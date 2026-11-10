import BranchIcon from "./BranchIcon";

export type WorkflowIconKind = "branch" | "target" | "preflight" | "push" | "sync";

export default function WorkflowIcon({ kind }: { kind: WorkflowIconKind }) {
  if (kind === "branch") return <BranchIcon />;
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "target" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {kind === "preflight" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </>
      )}
      {kind === "push" && <path d="M12 20V4m-5 5 5-5 5 5" />}
      {kind === "sync" && (
        <>
          <path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5" />
          <path d="M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5" />
        </>
      )}
    </svg>
  );
}
