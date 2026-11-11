import { useEffect, useState } from "react";
import { withBase, type Copy, type Locale } from "../i18n";
import BranchIcon from "./BranchIcon";
import Select from "./Select";
import WorkflowIcon from "./WorkflowIcon";
import { workflowCopy, workflowInteractionCopy, workflowPlanCopy } from "./workflow-copy";

type BranchId = "auth" | "webhooks" | "token";
const branches: { id: BranchId; name: string }[] = [
  { id: "auth", name: "feature/oauth-login" },
  { id: "webhooks", name: "feature/webhooks" },
  { id: "token", name: "fix/token-refresh" },
];

type DemoStep = -1 | 0 | 1 | 2 | 3 | "confirm" | "resolve" | "merged";
const ours = 'export function redirect(user) {\n  return user ? "/dashboard" : "/login";\n}';
const theirs = 'export function redirect(user) {\n  return user?.active ? "/home" : "/sign-in";\n}';
const combined = 'export function redirect(user) {\n  if (!user) return "/login";\n  return user.active ? "/dashboard" : "/sign-in";\n}';

export default function MrDemo({ copy: c, locale }: { copy: Copy; locale: Locale }) {
  const w = workflowCopy[locale];
  const x = workflowInteractionCopy[locale];
  const planCopy = workflowPlanCopy[locale];
  const [scenario, setScenario] = useState(1);
  const [resolution, setResolution] = useState<number | null>(null);
  const [result, setResult] = useState("");
  const [selected, setSelected] = useState<BranchId[]>(["auth", "webhooks"]);
  const [target, setTarget] = useState("develop");
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [step, setStep] = useState<DemoStep>(-1);
  const running = step === 0 || step === 1 || step === 2;
  const locked = step !== -1;
  const done = step === 3 || step === "merged";
  const validSelection = scenario === 0 ? selected.length === 1 : scenario === 1 ? selected.length >= 2 : selected.length > 0;
  const validResult = result.trim().length > 0 && !/^(<<<<<<<|=======|>>>>>>>)/m.test(result);
  const selectedBranches = selected.map(id => branches.find(branch => branch.id === id)!);
  const source = scenario === 2 ? "resolve/demo" : selected.length === 1 ? selectedBranches[0].name : `mr/${target}-demo`;
  const lastBranch = selectedBranches.at(-1);
  const title = editedTitle ?? (lastBranch ? c[lastBranch.id] : "");

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setStep(step === 0 ? scenario === 2 ? "confirm" : 1 : step === 1 ? 2 : 3), 700);
    return () => window.clearTimeout(timer);
  }, [step, running, scenario]);

  function reset(nextScenario = scenario) {
    setScenario(nextScenario);
    setSelected(nextScenario === 0 ? ["auth"] : ["auth", "webhooks"]);
    setTarget("develop");
    setEditedTitle(null);
    setStep(-1);
    setResolution(null);
    setResult("");
  }

  function toggleBranch(id: BranchId) {
    setSelected(current => scenario === 0 ? [id] : current.includes(id)
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
      <div className="mr-window" data-demo-step={step}>
        <div className="mr-titlebar">
          <div className="window-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>BranchNote</span>
          <span className="mono">developer-portal</span>
        </div>
        <div className="demo-scenarios" role="group" aria-label={w.title}>
          {w.scenarios.map((label, index) => (
            <button key={label} type="button" aria-pressed={scenario === index} onClick={() => reset(index)}>{label}</button>
          ))}
          <button className="demo-reset" type="button" onClick={() => reset()}>{c.again}</button>
        </div>
        <div className="mr-layout">
          <aside className="mr-sidebar" aria-label={c.project}>
            <img src={withBase("logo.svg")} alt="BranchNote" width="32" height="32" />
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
                  type={scenario === 0 ? "radio" : "checkbox"}
                  name="demo-branch"
                  value={branch.id}
                  checked={selected.includes(branch.id)}
                  disabled={locked}
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
            if (!locked && validSelection && title.trim()) setStep(0);
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
              disabled={locked}
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
              disabled={locked}
              required
              aria-describedby="title-help"
              onChange={event => { setEditedTitle(event.target.value); setStep(-1); }}
            />
            <small className="title-help" id="title-help">{c.autotitle}</small>
            <div className="compose-bottom">
              <p className="bundle-hint">{!selected.length ? c.empty : scenario === 1 && selected.length < 2 ? x.multiple : selected.length > 1 ? c.bundled : c.single}</p>
              <button className="submit-demo" type="submit" disabled={!validSelection || !title.trim() || locked}>
                <BranchIcon />
                <span>{c.submit}</span>
              </button>
            </div>
          </form>
        </div>
        {selected.length > 0 && (
          <div className="demo-merge-plan">
            <h4>{planCopy.preflight}</h4>
            <ol>
              {selectedBranches.map(branch => (
                <li key={branch.id}><code>{branch.name}</code></li>
              ))}
              <li><code>origin/{target}</code></li>
            </ol>
            <h4>{planCopy.execute}</h4>
            <p>{scenario === 2 ? planCopy.resolve : selected.length === 1 ? planCopy.direct : planCopy.integrate}</p>
          </div>
        )}
        {locked && (
          <div className="demo-flow-panel">
            <div className="demo-flow-branches">
              <div>
                <span>{w.branch}</span>
                <code>{scenario === 0 || step === "confirm" || step === 0 ? branches[0].name : source}</code>
              </div>
              <div>
                <span>{w.source}</span>
                <code>{step === "confirm" || step === 0 ? w.waiting : source}</code>
              </div>
              <div>
                <span>{w.target}</span>
                <code>origin/{target}</code>
              </div>
            </div>
            {step === "confirm" && (
              <div className="demo-preflight">
                <h4>{x.conflict}</h4>
                <p>{planCopy.fixture}</p>
                <p>{planCopy.resolve}</p>
                <p>{w.notes[1]}</p>
                <button type="button" className="submit-demo" onClick={() => setStep("resolve")}>{w.confirm}</button>
                <button type="button" className="demo-secondary" onClick={() => reset()}>{c.again}</button>
              </div>
            )}
            {step === "resolve" && (
              <div className="demo-conflict-editor">
                <h4>{w.choose}</h4>
                <div className="demo-code-grid">
                  <div>
                    <h5>{planCopy.ours}</h5>
                    <pre><code>{ours}</code></pre>
                  </div>
                  <div>
                    <h5>{planCopy.theirs} · origin/{target}</h5>
                    <pre><code>{theirs}</code></pre>
                  </div>
                </div>
                <div className="demo-resolutions" role="group" aria-label={w.choose}>
                  {w.choices.map((label, index) => (
                    <button key={label} type="button" aria-pressed={resolution === index} onClick={() => { setResolution(index); setResult([ours, theirs, combined][index]); }}>{label}</button>
                  ))}
                </div>
                <label className="demo-result-editor">
                  <span>{x.result}</span>
                  <textarea rows={6} spellCheck={false} value={result} onChange={event => { setResult(event.target.value); setResolution(null); }} />
                </label>
                <p>{validResult ? w.review : x.invalid}</p>
                <button type="button" className="submit-demo" disabled={!validResult} onClick={() => setStep(1)}>{x.save}</button>
              </div>
            )}
            {done && (
              <div className="demo-mr-status">
                <h4>{step === "merged" ? x.merged : x.open}</h4>
                <p>{title}</p>
                <p>{step === "merged" ? x.mergedNote : x.reviewNote}</p>
                {step === 3 && <button type="button" className="submit-demo" onClick={() => setStep("merged")}>{x.merge}</button>}
              </div>
            )}
          </div>
        )}
        <div className="mr-pipeline" aria-label={c.flowlabel}>
          {c.stage.map((label, index) => (
            <div
              className={`pipeline-step${index < (typeof step === "number" ? step : step === "merged" ? 4 : 0) || done ? " complete" : ""}${running && index === step ? " running" : ""}`}
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
          <span className="result-message">{step === -1 ? c.selecthint : step === "confirm" ? x.conflict : step === "resolve" ? planCopy.fixture : step === "merged" ? x.mergedNote : c.progress[step]}</span>
          <code className="result-target">origin/{target}</code>
        </div>
      </div>
      <p className="illustration-caption">{c.demoonly}</p>
    </div>
  );
}
