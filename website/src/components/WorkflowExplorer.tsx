import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, GitBranch, GitMerge, RotateCcw, ShieldCheck } from "lucide-react";
import type { Locale } from "../i18n";
import { workflowCopy } from "./workflow-copy";
import "../styles/workflow-explorer.css";

const routes = [[0, 1, 4, 5], [0, 1, 4, 5], [0, 1, 2, 3, 4, 5]];

export default function WorkflowExplorer({ locale }: { locale: Locale }) {
  const c = workflowCopy[locale];
  const [scenario, setScenario] = useState(2);
  const [position, setPosition] = useState(0);
  const [resolution, setResolution] = useState<number | null>(null);
  const steps = routes[scenario];
  const step = steps[position];
  const source = scenario === 0 ? "feature/login" : scenario === 1 ? "mr/test-demo" : "resolve/demo";
  const branch = step < 3 ? "feature/login" : source;
  const completed = position === steps.length - 1;
  const canContinue = step !== 3 || resolution !== null;

  function reset(nextScenario = scenario) {
    setScenario(nextScenario);
    setPosition(0);
    setResolution(null);
  }

  return (
    <div className="workflow-explorer">
      <div className="explorer-heading"><GitMerge size={20} strokeWidth={1.5} /><div><h3>{c.title}</h3><p>{c.intro}</p></div></div>
      <div className="explorer-scenarios" role="group" aria-label={c.title}>
        {c.scenarios.map((label, index) => <button type="button" key={label} aria-pressed={scenario === index} onClick={() => reset(index)}>{label}</button>)}
      </div>
      <div className="explorer-stage">
        <div className="explorer-state" aria-live="polite" aria-atomic="true">
          <span className="explorer-counter">{c.progress} {position + 1} / {steps.length}</span>
          <h4>{c.steps[step]}</h4><p>{c.notes[step]}</p>
        </div>
        <div className="explorer-branches">
          <div><span>{c.branch}</span><code><GitBranch size={15} />{branch}</code></div>
          <div><span>{c.source}</span><code>{step >= 3 ? source : c.waiting}</code></div>
          <div><span>{c.target}</span><code>origin/test</code></div>
        </div>
        {step === 3 && <div className="explorer-resolution">
          <span>{c.choose}</span>
          <div role="group" aria-label={c.choose}>{c.choices.map((label, index) => <button key={label} type="button" aria-pressed={resolution === index} onClick={() => setResolution(index)}><Check size={14} aria-hidden="true" />{label}</button>)}</div>
          <p>{resolution === null ? c.review : c.chosen}</p>
        </div>}
        {completed && <p className="explorer-complete"><ShieldCheck size={16} />{c.completed}</p>}
      </div>
      <div className="explorer-actions">
        <button type="button" disabled={position === 0} onClick={() => setPosition(position - 1)}><ArrowLeft size={15} />{c.previous}</button>
        {!completed && <button type="button" className="explorer-reset" onClick={() => reset()}><RotateCcw size={14} />{c.reset}</button>}
        <button type="button" className="explorer-next" disabled={!completed && !canContinue} onClick={() => completed ? reset() : setPosition(position + 1)}>{completed ? c.reset : step === 2 ? c.confirm : c.next}{completed ? <RotateCcw size={15} /> : <ArrowRight size={15} />}</button>
      </div>
      <p className="explorer-disclaimer">{c.demo}</p>
    </div>
  );
}
