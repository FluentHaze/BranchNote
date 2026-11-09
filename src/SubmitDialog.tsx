import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  GitBranch,
  GitMerge,
  RefreshCw,
  Settings2,
  UploadCloud,
  X,
} from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import ConflictResolver from "./ConflictResolver";
import {
  markMerged,
  rememberedTarget,
  weekNumber,
  withTarget,
  type Branch,
  type Project,
  type Stage,
  type Store,
} from "./model";
import type {
  ContinueResult,
  MergeResult,
  MergeState,
  PushResult,
  Repository,
} from "./storage";

const NEW_TARGET = "__new__";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

// 默认优先本周的远程发布分支，其次默认分支，最后退回当前分支
function pickReleaseTarget(repository: Repository) {
  const week = `release/week-${String(weekNumber()).padStart(2, "0")}`;
  const remotes = repository.branches.filter((branch) => branch.remoteRef);
  return (
    remotes.find((branch) => branch.name === week)?.remoteRef ||
    remotes.find((branch) => branch.name === repository.defaultBranch)
      ?.remoteRef ||
    remotes[0]?.remoteRef ||
    repository.branches.find((branch) => branch.current)?.name ||
    repository.branches[0]?.name ||
    ""
  );
}

// 测试分支没有统一命名，按常见前缀找一个，找不到就交给用户选
const TEST_BRANCH = /^(test|testing|qa|uat|stage|staging|dev|develop)([/-]|$)/i;
function pickTestTarget(repository: Repository) {
  const matches = repository.branches.filter((branch) =>
    TEST_BRANCH.test(branch.name),
  );
  return (
    matches.find((branch) => branch.remoteRef)?.remoteRef ||
    matches.find((branch) => branch.local)?.name ||
    ""
  );
}

interface ConflictContext {
  stage: Stage;
  branch: string;
  conflicts: string[];
  pending: string[];
  merged: string[];
  target: string;
  targetLocal: string;
  remoteRef: string;
  // 受保护目标：真正的目标分支只能通过 MR 合入，本次合并发生在集成分支上
  mrTarget: string;
  logs: string[];
}

export default function SubmitDialog({
  project,
  branchIds,
  initialStage,
  store,
  commit,
  close,
  openSettings,
}: {
  project: Project;
  branchIds: string[];
  // 列表里点「提交测试 / 提交发布」时已经选好阶段，打开就直接开跑
  initialStage?: Stage;
  store: Store;
  commit(store: Store, message?: string): Promise<boolean>;
  close(): void;
  // 没配令牌时跳去设置页补令牌
  openSettings?(): void;
}) {
  // 用本地副本记录本次提交过程中写回的台账，避免连续 commit 时互相覆盖
  const [ledger, setLedger] = useState(store);
  const ledgerRef = useRef(store);
  const [round, setRound] = useState(0);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 阶段在列表里已经点选（提交测试 / 提交发布），进来直接按这个阶段开跑
  const [stage, setStage] = useState<Stage>(initialStage ?? "release");
  // 两个阶段各自记住上次选过的分支，切换时不会互相覆盖
  const [stageTargets, setStageTargets] = useState<Record<Stage, string>>({
    test: rememberedTarget(project, "test"),
    release: rememberedTarget(project, "release"),
  });
  const [target, setTarget] = useState("");
  const [custom, setCustom] = useState(false);
  const [newTarget, setNewTarget] = useState("");
  const [base, setBase] = useState("");
  const [push, setPush] = useState(true);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  // 推送期间单独标记，避免完成页误显示“远程还是推送前的提交”
  const [pushing, setPushing] = useState(false);
  const [resume, setResume] = useState<MergeState | null>(null);
  const [resolving, setResolving] = useState(false);
  // 受保护目标模式的结果信息：集成分支、目标分支、接口创建的 MR
  const [mrInfo, setMrInfo] = useState<{
    branch: string;
    target: string;
    // 预填好的创建页，令牌缺失或接口失败时兜底
    pageUrl: string;
    // 接口创建成功（或已存在）后的 MR / PR 地址
    mrUrl: string;
    number: string;
    state:
      | "pending"
      | "created"
      | "exists"
      | "no-token"
      | "unsupported"
      | "failed";
    message: string;
  } | null>(null);
  const path = project.repositoryPath || "";
  const key = branchIds.join("|");
  // 阶段在列表里点选，按钮点的是哪个就合哪个
  const stageRef = useRef<Stage>(initialStage ?? "release");
  // 本次是否走「受保护目标 → 集成分支 + MR」：冲突轮次结束后收尾时仍要用
  const mrTargetRef = useRef("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  function chooseStage(next: Stage) {
    stageRef.current = next;
    setStage(next);
  }

  useEffect(() => {
    let active = true;
    setRepository(null);
    setError("");
    if (!path || !window.branchNote) return;
    setBusy(true);
    Promise.all([
      window.branchNote.readRepository(path),
      window.branchNote.mergeState(path).catch(() => null),
    ])
      .then(([repo, state]) => {
        if (!active) return;
        setRepository(repo);
        if (state?.session && (state.merging || state.session.pending.length)) {
          setResume(state);
          setStage(state.session.stage);
          setTarget(state.session.target);
        }
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, key]);

  // 本地副本里只取本次参与提交的分支
  const selection = useMemo(
    () => ledger.branches.filter((branch) => branchIds.includes(branch.id)),
    [ledger.branches, key],
  );
  const branches = repository?.branches || [];
  // 本地落后远程时优先用远程最新提交；本地有提交（领先或分叉）则用本地
  const specFor = (info?: Repository["branches"][number]) => {
    if (!info) return null;
    if (!info.local) return info.remoteRef;
    if (info.remoteRef && info.behind > 0 && !info.ahead) return info.remoteRef;
    return info.name;
  };
  const sources = selection.map((branch) => {
    const info = branches.find((item) => item.name === branch.name);
    return { branch, info, spec: specFor(info) };
  });
  const usable: { branch: Branch; spec: string }[] = [];
  for (const source of sources)
    if (source.spec) usable.push({ branch: source.branch, spec: source.spec });
  const missing = sources.filter((source) => !source.spec);
  const remoteName = repository?.remotes.find((name) =>
    target.startsWith(`${name}/`),
  );
  const targetLocal = remoteName ? target.slice(remoteName.length + 1) : target;
  const stageLabel = stage === "test" ? "测试分支" : "发布分支";

  const targetOptions = [
    { value: NEW_TARGET, label: "新建一个分支…" },
    ...branches
      .filter((branch) => branch.remoteRef)
      .map((branch) => ({
        value: branch.remoteRef!,
        label: `${branch.remoteRef}（远程）`,
      })),
    ...branches
      .filter((branch) => branch.local && !branch.remoteRef)
      .map((branch) => ({
        value: branch.name,
        label: `${branch.name}（本地）`,
      })),
  ];
  const baseOptions = [
    ...branches
      .filter((branch) => branch.local)
      .map((branch) => ({ value: branch.name, label: `${branch.name}（本地）` })),
    ...branches
      .filter((branch) => branch.remoteRef)
      .map((branch) => ({
        value: branch.remoteRef!,
        label: `${branch.remoteRef}（远程）`,
      })),
  ];

  // 目标分支优先沿用上次的选择，其次按阶段惯例自动挑一个
  useEffect(() => {
    if (!repository || target || custom || resume) return;
    const remembered = stageTargets[stage];
    const valid = targetOptions.some(
      (option) => option.value === remembered && option.value !== NEW_TARGET,
    );
    if (valid) {
      setTarget(remembered);
      return;
    }
    // 主界面设置的目标在仓库里还不存在（新版本要用的名字）：按「新建分支」处理
    if (remembered && remembered !== NEW_TARGET) {
      setCustom(true);
      setNewTarget(plainName(remembered));
      return;
    }
    const preferred =
      stage === "test"
        ? pickTestTarget(repository)
        : pickReleaseTarget(repository);
    if (preferred) setTarget(preferred);
    // 没有测试分支时默认新建 test（起点为默认分支），用户仍可改
    else if (stage === "test") {
      setCustom(true);
      setNewTarget("test");
    } else setCustom(true);
  }, [repository, target, custom, stage, resume]);

  useEffect(() => {
    if (!repository || base) return;
    const localDefault = repository.branches.find(
      (branch) => branch.local && branch.name === repository.defaultBranch,
    );
    const remoteDefault = repository.branches.find(
      (branch) => branch.remoteRef && branch.name === repository.defaultBranch,
    );
    setBase(
      localDefault?.name ||
        remoteDefault?.remoteRef ||
        repository.current ||
        "",
    );
  }, [repository, base]);

  async function save(next: Store, text?: string) {
    const ok = await commit(next, text);
    if (ok) {
      // 立刻更新 ref，后续步骤基于最新的台账继续写，避免覆盖上一步
      ledgerRef.current = next;
      setLedger(next);
    }
    return ok;
  }
  // 记住仓库关联与本次阶段的目标分支，下次打开直接沿用
  async function saveProject(destination: string, stage: Stage) {
    if (!repository) return true;
    const current = ledgerRef.current;
    return save(
      {
        ...current,
        projects: current.projects.map((item) =>
          item.id === project.id
            ? withTarget(
                { ...item, repositoryPath: repository.path },
                stage,
                destination,
              )
            : item,
        ),
      },
      "已记住目标分支",
    );
  }
  // 合并结果里的分支名可能带远程前缀，写回台账前统一成台账里的短名
  function normalizeNames(names: string[]) {
    const strip = (name: string) => {
      const direct = branches.find((branch) => branch.name === name);
      if (direct) return direct.name;
      for (const remote of repository?.remotes || [])
        if (name.startsWith(`${remote}/`)) return name.slice(remote.length + 1);
      return name;
    };
    return [...new Set(names.map(strip))];
  }
  // 按阶段写回：记下目标分支与本次合入时间；受保护模式按真正的目标分支记录并注明 MR
  async function record(names: string[], destination: string, mrBranch = "") {
    const mapped = normalizeNames(names);
    if (!mapped.length) return;
    const current = ledgerRef.current;
    await save(
      markMerged(current, project.id, mapped, stageRef.current, destination),
      mrBranch
        ? `已提交 MR：${mapped.length} 个分支 → ${destination}（集成分支 ${mrBranch}）`
        : `已合入 ${mapped.length} 个分支 → ${destination}`,
    );
  }
  async function pushNow(branchName: string, remoteRef: string) {
    if (!window.branchNote || !repository) return;
    setBusy(true);
    setPushing(true);
    setError("");
    try {
      setPushResult(
        await window.branchNote.pushBranch(
          repository.path,
          branchName,
          remoteRef.split("/")[0],
        ),
      );
    } catch (reason) {
      setError(`推送失败：${message(reason)}`);
    } finally {
      setBusy(false);
      setPushing(false);
    }
  }
  // 冲突在临时分支解决完后，把结果并回目标分支、写回台账、按需推送
  async function finish(context: ConflictContext, merged: string[]) {
    setStep("");
    let working = context.branch;
    const logs = [...context.logs];
    if (working !== context.targetLocal) {
      try {
        const finalized = await window.branchNote!.finalizeMerge(
          path,
          context.targetLocal,
          working,
        );
        logs.push(`已把 ${working} 并回 ${finalized.branch} 并删除临时分支`);
        working = finalized.branch;
      } catch (reason) {
        setResume(null);
        setResult({
          status: "failed",
          workingBranch: working,
          target: context.target,
          targetMode: context.remoteRef ? "remote" : "local",
          targetLocal: context.targetLocal,
          remoteRef: context.remoteRef,
          fastForwarded: false,
          merged,
          pending: [],
          conflicts: [],
          message: `解决结果已提交到 ${working}，但并回 ${context.targetLocal} 失败：${message(reason)}`,
          logs,
        });
        return;
      }
    }
    await record(
      merged,
      context.mrTarget || context.targetLocal,
      context.mrTarget ? context.targetLocal : "",
    );
    setResult({
      status: "success",
      workingBranch: working,
      target: context.target,
      targetMode: context.remoteRef ? "remote" : "local",
      targetLocal: context.targetLocal,
      remoteRef: context.remoteRef,
      fastForwarded: false,
      merged,
      pending: [],
      conflicts: [],
      message: "",
      logs,
    });
    setResume(null);
    if (context.mrTarget) {
      // 受保护目标：不碰目标分支，推集成分支后直接调接口建 MR / PR
      setMrInfo({
        branch: context.targetLocal,
        target: context.mrTarget,
        pageUrl: "",
        mrUrl: "",
        number: "",
        state: "pending",
        message: "",
      });
      const remote = repository?.remotes[0];
      if (push && remote)
        await pushNow(context.targetLocal, `${remote}/${context.targetLocal}`);
      await createMr(context.targetLocal, context.mrTarget, merged);
    } else if (push && context.remoteRef)
      await pushNow(context.targetLocal, context.remoteRef);
  }

  // 真正调接口建 MR / PR：有令牌就直接建，没有就只准备预填创建页当兜底
  async function createMr(source: string, target: string, merged: string[]) {
    if (!window.branchNote) return;
    let pageUrl = "";
    try {
      pageUrl =
        (await window.branchNote.mergeRequestUrl?.(path, source, target)) || "";
    } catch {
      pageUrl = "";
    }
    setMrInfo((prev) => (prev ? { ...prev, pageUrl } : prev));
    if (!window.branchNote.createMergeRequest) {
      setMrInfo((prev) =>
        prev
          ? {
              ...prev,
              state: "unsupported",
              message: "当前环境不支持调用接口创建合并请求",
            }
          : prev,
      );
      return;
    }
    const names = normalizeNames(merged);
    const label = stageRef.current === "test" ? "测试" : "发布";
    const title = `${label}：${names.join("、") || source}`.slice(0, 180);
    const description = [
      `由 BranchNote 提交${label}：${names.join("、") || source}`,
      `目标分支：${target}`,
      `集成分支：${source}`,
    ].join("\n");
    try {
      const result = await window.branchNote.createMergeRequest(
        path,
        source,
        target,
        title,
        description,
      );
      setMrInfo((prev) =>
        prev
          ? {
              ...prev,
              state: result.status,
              mrUrl: result.url || "",
              number: result.number || "",
              message: result.message || "",
            }
          : prev,
      );
      // 建好就直接把 MR 页面打开，省掉再找一遍
      if ((result.status === "created" || result.status === "exists") && result.url)
        await window.branchNote.openUrl(result.url).catch(() => undefined);
    } catch (reason) {
      setMrInfo((prev) =>
        prev ? { ...prev, state: "failed", message: message(reason) } : prev,
      );
    }
  }
  // 目标以本次实际使用的 destination 为准：点一下就跑时 state 还没更新，
  // 用渲染期的 target/targetLocal 会拿到上一次的目标（例如合到 test 却并回 release）
  function contextOf(
    outcome: MergeResult | ContinueResult,
    destination: string,
    destinationLocal: string,
    mrTarget = "",
  ): ConflictContext {
    const remote = repository?.remotes.find((name) =>
      destination.startsWith(`${name}/`),
    );
    return {
      stage: stageRef.current,
      branch: outcome.workingBranch,
      conflicts: outcome.conflicts,
      pending: outcome.pending,
      merged: outcome.merged,
      target: destination,
      targetLocal: destinationLocal,
      remoteRef: remote ? destination : "",
      mrTarget,
      logs: outcome.logs,
    };
  }

  // 名字里带远程前缀时去掉（origin/test → test），用于新建分支的名称
  function plainName(name: string) {
    for (const remote of repository?.remotes || [])
      if (name.startsWith(`${remote}/`)) return name.slice(remote.length + 1);
    return name;
  }

  // 某个阶段这次要合到哪：优先用记住的目标，其次按惯例挑一个；
  // 记住的目标在仓库里还不存在（主界面设置的新名字）时按「新建分支」处理
  function destinationFor(next: Stage): { value: string; create: boolean } {
    const remembered = stageTargets[next];
    const valid = targetOptions.some(
      (option) => option.value === remembered && option.value !== NEW_TARGET,
    );
    if (valid) return { value: remembered, create: false };
    if (remembered && remembered !== NEW_TARGET)
      return { value: plainName(remembered), create: true };
    if (!repository) return { value: "", create: false };
    return {
      value:
        next === "test"
          ? pickTestTarget(repository)
          : pickReleaseTarget(repository),
      create: false,
    };
  }

  // 点「合并到测试/发布分支」= 选阶段 + 立刻开跑，不需要再点一次
  function start(next: Stage) {
    const plan = destinationFor(next);
    if (!plan.value) {
      setAdvancedOpen(true);
      setNotice(
        `还没有可用的${next === "test" ? "测试" : "发布"}分支，展开下面的「高级选项」选一个或新建。`,
      );
      return;
    }
    chooseStage(next);
    setCustom(plan.create);
    setTarget(plan.create ? "" : plan.value);
    if (plan.create) setNewTarget(plan.value);
    void run(next, plan.value, plan.create);
  }

  // 从列表里点「提交测试 / 提交发布」进来的：仓库和分支就绪后自动开跑一次。
  // 用 ref 兜住，失败返回调整、切换阶段都不会反复重跑。
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !initialStage) return;
    if (!repository || resume || result || !base) return;
    if (!usable.length) return;
    autoStarted.current = true;
    start(initialStage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, resume, result, base, usable.length, initialStage]);

  // 主流程：准备 → 合并 → 成功则收尾/推送，冲突则进入应用内解决
  // 目标分支受保护时不直接合并/推送目标分支：从目标分支拉出 mr/* 集成分支，
  // 功能分支合入集成分支（冲突也在它的临时分支上解决），最后推送集成分支走 MR。
  async function run(
    nextStage?: Stage,
    fixedDestination?: string,
    fixedCreate?: boolean,
  ) {
    if (!repository || !window.branchNote) return;
    if (nextStage) chooseStage(nextStage);
    const usedStage = nextStage ?? stageRef.current;
    // create 与目标一律用显式参数：setState 是异步的，点一下就跑时读 state 会拿到旧值
    const create = fixedCreate ?? custom;
    let destination =
      fixedDestination ?? (custom ? newTarget.trim() : target);
    let usedCreate = create;
    let usedBase = base;
    let mrTarget = "";
    const protectedTarget =
      usedStage === "test" ? !!project.testProtected : !!project.releaseProtected;
    if (protectedTarget && !custom) {
      mrTarget = destination;
      // 集成分支起点：目标分支在仓库里存在就用它；还是新名字时退回起点分支（默认分支）
      const exists = targetOptions.some(
        (option) => option.value === mrTarget && option.value !== NEW_TARGET,
      );
      usedBase = exists ? mrTarget : base;
      const now = new Date();
      const stamp = [
        String(now.getFullYear()).slice(2),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("");
      const prefix = `mr/${plainName(mrTarget) || usedStage}-${stamp}`;
      let mrName = prefix;
      let index = 2;
      while (branches.some((branch) => branch.name === mrName))
        mrName = `${prefix}-${index++}`;
      destination = mrName;
      usedCreate = true;
    }
    mrTargetRef.current = mrTarget;
    if (!usable.length) {
      setError("没有可提交的分支，请先在仓库中找到这些分支");
      return;
    }
    if (!mrTarget && !destination) {
      setError(
        custom
          ? "请填写新分支名称"
          : `请选择${usedStage === "test" ? "测试分支" : "发布分支"}`,
      );
      return;
    }
    if (mrTarget && !usedBase) {
      setError(
        `受保护目标 ${mrTarget} 在仓库里还不存在，也没有可用的起点分支，请先在主界面设置好目标`,
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setPushResult(null);
    setMrInfo(null);
    setStep("正在核对分支…");
    try {
      if (!(await saveProject(mrTarget || destination, usedStage))) {
        setError("无法保存目标分支，请检查本地存储后重试");
        return;
      }
      const plan = await window.branchNote.prepareMerge(
        repository.path,
        destination,
        usable.map((source) => source.spec),
        "",
        { create: usedCreate, base: usedBase, stage: usedStage },
      );
      setStep("正在合并…");
      const outcome = await window.branchNote.executeMerge(plan.id);
      const remote = repository.remotes.find((name) =>
        destination.startsWith(`${name}/`),
      );
      const destinationLocal = remote
        ? destination.slice(remote.length + 1)
        : destination;
      if (outcome.status === "success")
        await finish(
          contextOf(outcome, destination, destinationLocal, mrTarget),
          outcome.merged,
        );
      else {
        setResult(outcome);
        setRound((value) => value + 1);
        // 已经完成的那几个分支确实落到了目标分支上，先如实记账
        if (outcome.merged.length)
          await record(
            outcome.merged,
            mrTarget || outcome.targetLocal,
            mrTarget ? outcome.targetLocal : "",
          );
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setStep("");
      setBusy(false);
    }
  }

  // 冲突解决完：提交后继续合并剩余分支，全部完成再收尾
  async function afterResolve() {
    const context = conflict
      ? { ...conflict, mrTarget: mrTargetRef.current }
      : null;
    if (!context || !window.branchNote) return;
    setError("");
    setNotice("");
    if (!context.pending.length) {
      await finish(context, context.merged);
      return;
    }
    setBusy(true);
    try {
      const outcome = await window.branchNote.continueMerge(
        path,
        context.branch,
        context.pending,
      );
      if (outcome.status === "conflict") {
        setResume(null);
        setRound((value) => value + 1);
        setResult({
          status: "conflict",
          workingBranch: outcome.workingBranch,
          target: context.target,
          targetMode: "remote",
          targetLocal: context.targetLocal,
          remoteRef: context.remoteRef,
          fastForwarded: false,
          merged: [...context.merged, ...outcome.merged],
          pending: outcome.pending,
          conflicts: outcome.conflicts,
          message: outcome.message,
          logs: [...context.logs, ...outcome.logs],
        });
        return;
      }
      if (outcome.status === "failed") {
        setResume(null);
        setResult({
          status: "failed",
          workingBranch: outcome.workingBranch,
          target: context.target,
          targetMode: "remote",
          targetLocal: context.targetLocal,
          remoteRef: context.remoteRef,
          fastForwarded: false,
          merged: [...context.merged, ...outcome.merged],
          pending: outcome.pending,
          conflicts: outcome.conflicts,
          message: outcome.message,
          logs: [...context.logs, ...outcome.logs],
        });
        return;
      }
      await finish(context, [...context.merged, ...outcome.merged]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const conflict: ConflictContext | null = useMemo(() => {
    if (result?.status === "conflict")
      return {
        stage,
        branch: result.workingBranch,
        conflicts: result.conflicts,
        pending: result.pending,
        merged: result.merged,
        target: result.target,
        targetLocal: result.targetLocal,
        remoteRef: result.remoteRef,
        mrTarget: "",
        logs: result.logs,
      };
    if (resume?.session)
      return {
        stage: resume.session.stage,
        branch: resume.session.branch,
        conflicts: resume.unmerged,
        pending: resume.session.pending,
        merged: resume.session.merged,
        target: resume.session.target,
        targetLocal: resume.session.targetLocal,
        remoteRef: resume.session.remoteRef,
        mrTarget: "",
        logs: [],
      };
    return null;
  }, [result, resume, stage]);

  const submitted = result?.status === "success";
  const conflictsLeft = conflict ? conflict.pending.length : 0;

  async function choose() {
    if (!window.branchNote) return;
    setBusy(true);
    setError("");
    try {
      const repo = await window.branchNote.pickRepository();
      if (!repo) return;
      setRepository(repo);
      setTarget("");
      setCustom(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function refreshRemote() {
    if (!window.branchNote || !repository) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const outcome = await window.branchNote.fetchRepository(repository.path);
      setRepository(outcome.repository);
      const changes = [
        outcome.updated.length ? `${outcome.updated.length} 个分支有新提交` : "",
        outcome.added.length ? `新增 ${outcome.added.length} 个` : "",
      ].filter(Boolean);
      setNotice(
        changes.length
          ? `更新完成：${changes.join("，")}`
          : "更新完成，远程分支没有变化",
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        conflict
          ? "合并遇到冲突"
          : submitted
            ? "合并完成"
            : custom
              ? "新建分支并合并"
              : initialStage
                ? `合并到${stage === "test" ? "测试" : "发布"}分支`
                : "选择合并到哪条分支"
      }
      close={() => {
        if (!busy) close();
      }}
      wide={!!conflict || submitted || result?.status === "failed"}
    >
      <div className="repository-body" aria-busy={busy}>
        {!window.branchNote && (
          <div className="warning-panel">
            浏览器预览无法访问本地 Git。请在 BranchNote 桌面应用中使用此功能。
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="picker-note" role="status">
            {notice}
          </p>
        )}
        {busy && step && (
          <p role="status" className="repository-loading">
            {step}
          </p>
        )}

        {conflict ? (
          <>
            <p className="resolve-summary">
              {conflict.merged.length > 0
                ? `已合入 ${conflict.merged.length} 个分支${
                    conflictsLeft > 0 ? `，还有 ${conflictsLeft} 个等待合并` : ""
                  }。`
                : conflictsLeft > 0
                  ? `还有 ${conflictsLeft} 个分支等待合并。`
                  : ""}
              每个文件点一下「采用我方 / 采用对方 / 两边都要」即可解决，全部解决后自动继续。
              冲突在临时分支上解决（当前为 <code>{conflict.branch}</code>），功能分支始终保持干净。
            </p>
            <ConflictResolver
              key={`${conflict.branch}-${round}`}
              path={path}
              branch={conflict.branch}
              conflicts={conflict.conflicts}
              busy={busy}
              setBusy={setBusy}
              onResolved={afterResolve}
              onAborted={(current) => {
                setResume(null);
                setResult(null);
                setNotice(
                  `已放弃本次合并，当前分支为 ${current || "原分支"}；此前已合入的提交会留在目标分支上。`,
                );
              }}
            />
          </>
        ) : submitted ? (
          <div className="merge-result">
            <h3>
              {mrInfo
                ? mrInfo.state === "created"
                  ? "已创建合并请求（MR）"
                  : mrInfo.state === "exists"
                    ? "该分支已有合并请求（MR）"
                    : mrInfo.state === "pending"
                      ? "正在创建合并请求（MR）"
                      : "已推送集成分支，等待创建 MR"
                : stage === "test"
                  ? "已合入测试分支"
                  : "已合入发布分支"}
            </h3>
            {mrInfo && (
              <>
                <p>
                  目标分支（受保护，未直接推送）：<code>{mrInfo.target}</code>
                </p>
                <p>
                  集成分支已合并并推送：<code>{mrInfo.branch}</code>
                </p>
              </>
            )}
            {!mrInfo && (
              <p>
                目标分支：<code>{result.targetLocal}</code>
              </p>
            )}
            <p>
              本次合入 {result.merged.length} 个分支
              {result.merged.length > 0 && `：${result.merged.join("、")}`}
            </p>
            {mrInfo ? (
              <p className="picker-note">
                {mrInfo.state === "pending"
                  ? "正在调用代码托管平台的接口创建合并请求…"
                  : mrInfo.state === "created"
                    ? `已通过接口创建合并请求${
                        mrInfo.number ? ` #${mrInfo.number}` : ""
                      }，并已为你打开页面。`
                    : mrInfo.state === "exists"
                      ? `该源分支已有打开的合并请求${
                          mrInfo.number ? ` #${mrInfo.number}` : ""
                        }，已为你打开。`
                      : mrInfo.state === "no-token"
                        ? `${mrInfo.message}。现在仍可打开预填好的创建页，手动点一次即可。`
                        : mrInfo.state === "unsupported"
                          ? `无法自动创建 MR：${mrInfo.message}`
                          : `自动创建 MR 失败：${mrInfo.message}`}
              </p>
            ) : stage === "test" ? (
              <p className="picker-note">
                已合入测试分支。要发布时，回到列表点这一行的「提交发布」即可。
              </p>
            ) : (
              <p className="picker-note">
                已合入发布分支并记录台账。分支后续有新修改时，点击列表里的状态即可重新标记待合并。
              </p>
            )}
            {pushResult ? (
              <p className="picker-note">
                已推送 <code>{pushResult.branch}</code> 到{" "}
                <code>{pushResult.remote}</code>。
              </p>
            ) : pushing ? (
              <p className="field-hint">
                正在推送 <code>{result.targetLocal}</code> 到远程…
              </p>
            ) : result.remoteRef ? (
              <p className="field-hint">
                远程 <code>{result.remoteRef}</code> 还没有这次合并的提交，可点下方按钮推送。
              </p>
            ) : null}
            <details>
              <summary>查看 Git 输出</summary>
              <pre>{result.logs.join("\n")}</pre>
            </details>
            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={close}>
                关闭
              </button>
              {mrInfo?.state === "no-token" && openSettings && (
                <button className="secondary" onClick={openSettings}>
                  <Settings2 size={15} />
                  去设置令牌
                </button>
              )}
              {mrInfo?.mrUrl ? (
                <button
                  className="primary"
                  disabled={busy || pushing}
                  onClick={() => void window.branchNote?.openUrl(mrInfo.mrUrl)}
                >
                  <ExternalLink size={15} />
                  打开 MR
                </button>
              ) : mrInfo?.pageUrl ? (
                <button
                  className="primary"
                  disabled={busy || pushing}
                  onClick={() => void window.branchNote?.openUrl(mrInfo.pageUrl)}
                >
                  <ExternalLink size={15} />
                  打开 MR 创建页
                </button>
              ) : null}
              {!mrInfo && !pushResult && result.remoteRef && (
                <button
                  className="primary"
                  disabled={busy || pushing}
                  onClick={() => void pushNow(result.targetLocal, result.remoteRef)}
                >
                  <UploadCloud size={15} />
                  {pushing ? "正在推送…" : `推送到 ${result.remoteRef.split("/")[0]}`}
                </button>
              )}
            </div>
          </div>
        ) : result?.status === "failed" ? (
          <div className="merge-result">
            <h3>合并已停止</h3>
            <p>{result.message}</p>
            {result.merged.length > 0 && (
              <p className="field-hint">
                以下分支已经合入：{result.merged.join("、")}
              </p>
            )}
            <details>
              <summary>查看 Git 输出</summary>
              <pre>{result.logs.join("\n")}</pre>
            </details>
            <div className="modal-actions">
              <button className="secondary" onClick={close}>
                关闭
              </button>
              <button className="primary" onClick={() => setResult(null)}>
                返回调整
              </button>
            </div>
          </div>
        ) : !repository ? (
          <div className="repository-empty">
            <p>
              这个项目还没有可用的仓库。选择仓库文件夹后，就能把功能分支合入测试或发布分支。
            </p>
            <button
              className="secondary"
              disabled={busy || !window.branchNote}
              onClick={() => void choose()}
            >
              <FolderOpen size={16} />
              选择仓库文件夹
            </button>
          </div>
        ) : (
          <>
            <div className="submit-branches">
              {sources.map(({ branch, info, spec }) => (
                <span className="submit-chip" key={branch.id}>
                  {info?.remoteRef && !info.local ? (
                    <Cloud size={13} />
                  ) : (
                    <GitBranch size={13} />
                  )}
                  <code>{branch.name}</code>
                  {!spec && <span className="tag">仓库中未找到</span>}
                </span>
              ))}
              {missing.length > 0 && (
                <p className="field-hint">
                  {missing.length} 个分支在仓库中找不到，可能已被删除。
                </p>
              )}
            </div>

            <p className="submit-summary">
              {usable.length ? (
                <>
                  已选 {usable.length} 个分支。这次要合并到哪条分支？
                </>
              ) : (
                <>没有可提交的分支，请先在仓库中找到这些分支。</>
              )}
            </p>

            {usable.length > 0 && !custom && (
              <div className="stage-choices">
                <button
                  type="button"
                  className="stage-choice"
                  disabled={busy}
                  onClick={() => start("test")}
                >
                  <FlaskConical size={15} />
                  <span className="stage-choice-title">合并到测试分支</span>
                  <code>
                    {destinationFor("test").value || "还没有测试分支"}
                    {project.testProtected ? " · MR" : ""}
                  </code>
                </button>
                <button
                  type="button"
                  className="stage-choice release"
                  disabled={busy}
                  onClick={() => start("release")}
                >
                  <GitMerge size={15} />
                  <span className="stage-choice-title">合并到发布分支</span>
                  <code>
                    {destinationFor("release").value || "还没有发布分支"}
                    {project.releaseProtected ? " · MR" : ""}
                  </code>
                </button>
              </div>
            )}

            {busy && !step && <p className="picker-note">正在准备合并…</p>}

            <details
              className="advanced-options"
              open={advancedOpen}
              onToggle={(event) =>
                setAdvancedOpen((event.target as HTMLDetailsElement).open)
              }
            >
              <summary>
                <Settings2 size={14} />
                换目标、新建分支、关闭推送
              </summary>
              <div className="advanced-body">
                <div className="stage-toggle" role="group" aria-label="合并阶段">
                  <button
                    type="button"
                    className={stage === "release" ? "selected" : ""}
                    disabled={busy}
                    onClick={() => {
                      if (stage === "release") return;
                      setStageTargets((prev) => ({ ...prev, [stage]: target }));
                      chooseStage("release");
                      setCustom(false);
                      setTarget(stageTargets.release);
                    }}
                  >
                    <GitMerge size={14} />
                    发布分支
                  </button>
                  <button
                    type="button"
                    className={stage === "test" ? "selected" : ""}
                    disabled={busy}
                    onClick={() => {
                      if (stage === "test") return;
                      setStageTargets((prev) => ({ ...prev, [stage]: target }));
                      chooseStage("test");
                      setCustom(false);
                      setTarget(stageTargets.test);
                    }}
                  >
                    测试分支
                  </button>
                </div>

                <label>
                  {stageLabel}
                  <Select
                    label={stageLabel}
                    value={custom ? NEW_TARGET : target}
                    disabled={busy || !branches.length}
                    onChange={(value) => {
                      if (value === NEW_TARGET) {
                        setCustom(true);
                        setNewTarget("");
                      } else {
                        setCustom(false);
                        setTarget(value);
                      }
                    }}
                    options={targetOptions}
                  />
                </label>
                {custom && (
                  <>
                    <label>
                      新分支名称
                      <input
                        value={newTarget}
                        onChange={(event) => setNewTarget(event.target.value)}
                        disabled={busy}
                        aria-label="新分支名称"
                        placeholder={
                          stage === "test"
                            ? "test"
                            : `release/week-${String(weekNumber()).padStart(2, "0")}`
                        }
                      />
                    </label>
                    <label>
                      起点分支
                      <Select
                        label="新分支的起点"
                        value={base}
                        disabled={busy}
                        onChange={setBase}
                        options={baseOptions}
                      />
                    </label>
                  </>
                )}

                {!custom && remoteName && (
                  <label className="push-field">
                    <span>
                      <input
                        type="checkbox"
                        checked={push}
                        disabled={busy}
                        onChange={(event) => setPush(event.target.checked)}
                      />
                      完成后推送到 {remoteName}
                    </span>
                  </label>
                )}

                <div className="repository-top">
                  <div className="repository-location">
                    <span>
                      所属项目{" "}
                      <strong className="inline-strong">{project.name}</strong>
                    </span>
                    <strong title={repository?.path || path}>
                      {repository?.path || path || "先选择仓库文件夹"}
                    </strong>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="更新远程分支"
                    title="fetch 所有远程分支"
                    disabled={busy}
                    onClick={() => void refreshRemote()}
                  >
                    <RefreshCw size={15} className={busy ? "spin" : ""} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="更换仓库文件夹"
                    title="更换仓库文件夹"
                    disabled={busy}
                    onClick={() => void choose()}
                  >
                    <FolderOpen size={15} />
                  </button>
                </div>
              </div>
            </details>

            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={close}>
                <X size={15} />
                取消
              </button>
              {custom && (
                <button
                  className="primary"
                  disabled={busy || !usable.length || !newTarget.trim() || !base}
                  onClick={() => void run()}
                >
                  <GitMerge size={16} />
                  {busy
                    ? "正在合并…"
                    : `新建并合并到 ${newTarget.trim() || "新分支"}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
