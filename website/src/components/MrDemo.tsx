import { useEffect, useState } from "react";
import type { Copy } from "../i18n";
import BranchIcon from "./BranchIcon";
import Select from "./Select";
import WorkflowIcon from "./WorkflowIcon";

type BranchId = "auth" | "webhooks" | "token";
const branches: { id: BranchId; name: string }[] = [
  { id: "auth", name: "feature/oauth-login" },
  { id: "webhooks", name: "feature/webhooks" },
  { id: "token", name: "fix/token-refresh" },
];

export default function MrDemo({ copy: c }: { copy: Copy }) {
  const [selected, setSelected] = useState<BranchId[]>(["auth", "webhooks"]);
  const [target, setTarget] = useState("develop");
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [step, setStep] = useState(-1);
  const running = step >= 0 && step < 3;
  const done = step === 3;
  const lastBranch = branches.filter(branch => selected.includes(branch.id)).at(-1);
  const title = editedTitle ?? (lastBranch ? c[lastBranch.id] : "");

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setStep(current => current + 1), 700);
    return () => window.clearTimeout(timer);
  }, [step, running]);

  function toggleBranch(id: BranchId) {
    setSelected(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id]);
    setStep(-1);
  }

  return (
    <div className="mr-illustration" id="try-mr">
      <div className="illustration-overline">
        <span>{c.visual}</span>
        <span className="illustration-mark" aria-hidden="true">Interactive preview</span>
      </div>
      <div className="mr-window">
        <div className="mr-titlebar">
          <div className="window-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>BranchNote</span>
          <span className="mono">developer-portal</span>
        </div>
        <div className="mr-layout">
          <aside className="mr-sidebar" aria-label={c.project}>
            <img src="/logo.svg" alt="BranchNote" width="32" height="32" />
            <div className="sidebar-label">{c.project}</div>
            <div className="sidebar-project active">Developer Portal</div>
            <div className="sidebar-project">SDK</div>
            <div className="sidebar-project">Documentation</div>
            <div className="sidebar-bottom mono">~/code/developer-portal</div>
          </aside>
          <div className="mr-branches">
            <div className="branch-heading">
              <h3>{c.workspace}</h3>
              <span className="mono">GitLab / GitHub</span>
            </div>
            <p className="branch-guidance">{c.selecthint}</p>
            <div className="branch-table-head" aria-hidden="true">
              <span>{c.branchcol}</span>
              <span>{c.ready}</span>
            </div>
            {branches.map(branch => (
              <label className={`demo-branch${selected.includes(branch.id) ? " chosen" : ""}`} key={branch.id}>
                <input
                  type="checkbox"
                  name="demo-branch"
                  value={branch.id}
                  checked={selected.includes(branch.id)}
                  disabled={running}
                  onChange={() => toggleBranch(branch.id)}
                />
                <BranchIcon />
                <span className="branch-detail">
                  <code>{branch.name}</code>
                  <span>{c[branch.id]}</span>
                </span>
                <span className="branch-ready">{c.ready}</span>
              </label>
            ))}
            <div className="branch-selection">
              <span className="selection-count">{c.count.replace("{n}", String(selected.length))}</span>
              <BranchIcon />
            </div>
          </div>
          <form className="mr-compose" onSubmit={event => {
            event.preventDefault();
            if (!running && selected.length && title.trim()) setStep(done ? -1 : 0);
          }}>
            <div className="compose-heading">
              <BranchIcon />
              <h3>{c.newmr}</h3>
            </div>
            <label htmlFor="mr-demo-target">{c.targetlabel}</label>
            <Select
              id="mr-demo-target"
              label={c.targetlabel}
              value={target}
              disabled={running}
              options={[
                { value: "develop", label: "origin/develop" },
                { value: "main", label: "origin/main" },
              ]}
              onChange={value => { setTarget(value); setStep(-1); }}
            />
            <label htmlFor="mr-demo-title">{c.titlelabel}</label>
            <input
              id="mr-demo-title"
              type="text"
              maxLength={160}
              autoComplete="off"
              value={title}
              disabled={running}
              required
              aria-describedby="title-help"
              onChange={event => { setEditedTitle(event.target.value); setStep(-1); }}
            />
            <small className="title-help" id="title-help">{c.autotitle}</small>
            <div className="compose-bottom">
              <p className="bundle-hint">{selected.length > 1 ? c.bundled : selected.length ? c.single : c.empty}</p>
              <button className="submit-demo" type="submit" disabled={!selected.length || !title.trim() || running}>
                <BranchIcon />
                <span>{done ? c.again : c.submit}</span>
              </button>
            </div>
          </form>
        </div>
        <div className="mr-pipeline" aria-label={c.flowlabel}>
          {c.stage.map((label, index) => (
            <div
              className={`pipeline-step${index < step || done ? " complete" : ""}${running && index === step ? " running" : ""}`}
              data-step={index}
              key={label}
            >
              <span className="pipeline-dot" aria-hidden="true">
                <WorkflowIcon kind={(["preflight", "push", "branch", "sync"] as const)[index]} />
              </span>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className={`demo-result${done ? " complete" : ""}`} role="status" aria-live="polite" aria-atomic="true">
          <span className="result-dot" aria-hidden="true" />
          <span className="result-message">{step < 0 ? c.selecthint : c.progress[step]}</span>
          <code className="result-target">origin/{target}</code>
        </div>
      </div>
      <p className="illustration-caption">{c.demoonly}</p>
    </div>
  );
}
