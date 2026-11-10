import type { Copy } from "../i18n";
import BranchIcon from "./BranchIcon";
import { statusBranches, targetBranches, type MergeStatus, type PreviewMode, type Target } from "./status-demo";

export default function BranchGraph({ copy: c, mode, target }: { copy: Copy; mode: PreviewMode; target: Target }) {
  const statusLabel = (status: MergeStatus) => status === "merged" ? c.merged : status === "opened" ? c.waiting : c.pending;
  return (
    <div className="branch-chart" data-mode={mode}>
      <div className="chart-heading">
        <span>{c[mode]}</span>
        <BranchIcon />
      </div>
      {mode === "overview" ? (
        <div className="overview-graph">
          <div className="overview-graph-head">
            <span>{c.branchcol}</span>
            <span>{c.test}</span>
            <span>{c.ship}</span>
          </div>
          {statusBranches.map(branch => (
            <div className="overview-graph-row" key={branch.name}>
              <code>{branch.name}</code>
              {(["test", "release"] as const).map(stage => (
                <div className={`overview-stage state-${branch[stage]}`} key={stage}>
                  <span className="flow-segment" aria-hidden="true" />
                  <span className="flow-node" aria-label={statusLabel(branch[stage])}>
                    {branch[stage] === "merged" ? "✓" : branch[stage] === "opened" ? "○" : "·"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className={`chart-tracks ${mode === "preflight" ? "preflight-tracks" : "target-tracks"}`}>
          <div className="track-labels">
            {mode === "targets" ? statusBranches.map(branch => (
              <code key={branch.name}>{branch.name}</code>
            )) : (
              <>
                <code>feature/auth</code>
                <code>{targetBranches[target]}</code>
              </>
            )}
          </div>
          <div className="track-plot" aria-hidden="true">
            <svg className="track-lines" viewBox="0 0 360 224" preserveAspectRatio="none">
              {mode === "targets" ? statusBranches.map((branch, index) => (
                <path
                  className={`merge-path state-${branch[target]}`}
                  d={`M24 ${38 + index * 74}H76C168 ${38 + index * 74} 170 112 260 112H320`}
                  key={branch.name}
                />
              )) : (
                <>
                  <path className="merge-path preflight-source" d="M24 56H76C168 56 170 112 246 112H320" />
                  <path className="merge-path preflight-target" d="M24 168H76C168 168 170 112 246 112" />
                </>
              )}
            </svg>
            {mode === "targets" ? statusBranches.map((branch, index) => (
              <span className={`commit-node state-${branch[target]}`} style={{ left: "6.67%", top: 38 + index * 74 }} key={branch.name} />
            )) : (
              <>
                <span className="commit-node feature-node" style={{ left: "6.67%", top: 56 }} />
                <span className="commit-node develop-node" style={{ left: "6.67%", top: 168 }} />
              </>
            )}
            <span className="graph-destination-node" style={{ left: "88.89%", top: 112 }}>
              {mode === "preflight" ? "✓" : <BranchIcon />}
            </span>
          </div>
        </div>
      )}
      <div className="chart-footer">
        <span className="chart-source">{mode === "preflight" ? c.graph.sandbox : c.targets}</span>
        <span className="chart-destination">{mode === "overview" ? "develop / main" : mode === "preflight" ? c.graph.clean : targetBranches[target]}</span>
      </div>
    </div>
  );
}
