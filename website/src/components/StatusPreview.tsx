import { useRef, useState, type KeyboardEvent } from "react";
import type { Copy } from "../i18n";
import BranchGraph from "./BranchGraph";
import Select from "./Select";
import { previewModes, statusBranches, targetBranches, type MergeStatus, type Target } from "./status-demo";

export default function StatusPreview({ copy: c }: { copy: Copy }) {
  const [activeTab, setActiveTab] = useState(0);
  const [target, setTarget] = useState<Target>("test");
  const mode = previewModes[activeTab];
  const tabs = [c.overview, c.targets, c.preflight];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const statusLabel = (status: MergeStatus) => status === "merged" ? c.merged : status === "opened" ? c.waiting : c.pending;

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setActiveTab(next);
    buttons.current[next]?.focus();
  }

  return (
    <section id="showcase" className="spotlight">
      <div>
        <h2>{c.all}</h2>
        <div className="tabs" role="tablist" aria-label={c.overview}>
          {tabs.map((label, index) => (
            <button
              className="tab"
              id={`tab-${index}`}
              type="button"
              role="tab"
              aria-controls="preview-panel"
              aria-selected={activeTab === index}
              tabIndex={activeTab === index ? 0 : -1}
              ref={node => { buttons.current[index] = node; }}
              onClick={() => setActiveTab(index)}
              onKeyDown={event => navigateTabs(event, index)}
              key={label}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="tabcopy">{c.tabtext[activeTab]}</p>
        {mode !== "overview" && (
          <div className="preview-controls">
            <Select<Target>
              label={c.targetlabel}
              value={target}
              options={[
                { value: "test", label: `${c.test} · origin/develop` },
                { value: "release", label: `${c.ship} · origin/main` },
              ]}
              onChange={setTarget}
            />
          </div>
        )}
        <div className="graphbox">
          <BranchGraph copy={c} mode={mode} target={target} />
        </div>
      </div>
      <div className="previewvisual" id="preview-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} tabIndex={0}>
        <div className="statuslist">
          {mode === "preflight" ? (
            <>
              <h3 className="preflight-heading">{c.preflight}</h3>
              <div className="preflight-detail">
                <span>{c.branchcol}</span>
                <code>feature/auth</code>
              </div>
              <div className="preflight-detail">
                <span>{c.targetlabel}</span>
                <code>{targetBranches[target]}</code>
              </div>
              <div className="preflight-detail">
                <span>{c.graph.sandbox}</span>
                <span className="status-pill good">✓ {c.graph.clean}</span>
              </div>
              <p>{c.tabtext[2]}</p>
            </>
          ) : (
            <>
              <div className={`statusrow statushead${mode === "targets" ? " target-statusrow" : ""}`} aria-hidden="true">
                <span>{c.overview}</span>
                {mode === "overview" ? (
                  <>
                    <span>{c.test}</span>
                    <span>{c.ship}</span>
                  </>
                ) : <span>{targetBranches[target]}</span>}
              </div>
              {statusBranches.map(branch => (
                <div className={`statusrow${mode === "targets" ? " target-statusrow" : ""}`} key={branch.name}>
                  <code>{branch.name}</code>
                  {(mode === "overview" ? (["test", "release"] as const) : [target]).map(stage => (
                    <span className={`status-pill${branch[stage] === "merged" ? " good" : branch[stage] === "opened" ? " waiting" : ""}`} key={stage}>
                      <span className="status-dot" aria-hidden="true" />
                      {statusLabel(branch[stage])}
                    </span>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
