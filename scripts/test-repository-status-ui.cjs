// 独立 Electron 配置与模拟 IPC，不读取或写入用户台账及真实仓库。
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");

async function main() {
  if (!process.versions.electron) {
    const { spawn } = require("node:child_process");
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), "branchnote-status-ui-"));
    try {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require("electron"), [__filename, profile], { env, windowsHide: true, stdio: "inherit" });
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", code => resolve(code ?? 1));
      });
      process.exitCode = code;
    } finally {
      await fs.rm(profile, { recursive: true, force: true });
    }
    return;
  }
  const { app, BrowserWindow, ipcMain } = require("electron");
  app.setPath("userData", process.argv[2]);
  await app.whenReady();
  let win;
  try {
    const store = {
      version: 3, branches: [{ id: "branch-A", projectId: "A", name: "feature/A", description: "已合并功能", note: "",
        createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z",
        testMergedAt: "2026-11-16T00:00:00.000Z", releaseMergedAt: null }], mrRefreshSeconds: 300,
      projects: ["A", "B"].map(name => ({
        id: name, name: `旧名称 ${name}`, note: `演示项目 ${name}`, archived: false,
        repositoryPath: `C:/status-fixture/${name}`, targets: [{id: "test", name: "测试", branch: "origin/test", color: "#4263dc"}],
      })),
    };
    const status = branch => ({
      path: "fixture", head: "branch", branch, commit: "1234567890abcdef",
      upstream: "origin/main", ahead: 2, behind: 1, staged: false,
      unstaged: false, untracked: false, conflicts: false, clean: true, operations: [],
    });
    let valueA = status("feature/A");
    let valueB = status("feature/B");
    let failure = false;
    let delayed = false;
    let release;
    let operation = null;
    let workspaceFailure = false;
    let diffFailure = false;
    let delayDiff = false;
    let releaseDiff;
    let writtenStore = store;
    let committed = false;
    let commitFailure = true;
    let commitCalls = 0;
    let finishCommit;
    let extraFiles = [];
    let workflowBranch = "feature/A";
    let workflowUpstream = null;
    let failPush = false;
    const workflowCalls = [];
    const repository = () => ({ path: "C:/status-fixture/A", current: workflowBranch, remotes: ["origin", "second"], remoteUrls: {}, branches: [
      {name: "feature/A", local: true, remoteRef: "origin/feature/A", remoteRefs: ["origin/feature/A", "second/feature/A"], subject: "Feature A", behind: 0, ahead: 0},
      {name: "main", local: true, remoteRefs: ["origin/main"], subject: "main"},
      {name: "test", local: false, remoteRef: "origin/test", remoteRefs: ["origin/test", "second/test"], subject: "test"},
    ] });
    ipcMain.handle("fixture:repository", () => repository());
    ipcMain.handle("fixture:workflow", () => ({repository: repository(), status: {...status(workflowBranch), clean: true}, upstream: workflowUpstream}));
    ipcMain.handle("fixture:create-branch", (_, name, source, checkout) => {
      workflowCalls.push({action: "create", name, source, checkout});
      if (checkout) workflowBranch = name;
    });
    ipcMain.handle("fixture:switch-branch", (_, ref) => { workflowCalls.push({action: "switch", ref}); workflowBranch = ref.slice("refs/heads/".length); });
    ipcMain.handle("fixture:sync-branch", (_, action, target) => {
      workflowCalls.push({action, ...target});
      if (failPush) throw new Error("远端已有新提交");
      if (action === "push") workflowUpstream = {remote: target.remote, branch: target.target};
      return target;
    });
    ipcMain.handle("fixture:fetch", () => ({repository: repository(), errors: [], remoteResults: [{remote:"origin",success:true,message:"已更新"},{remote:"second",success:false,message:"演示失败"}]}));
    ipcMain.handle("fixture:prepare", (_, sources) => { workflowCalls.push({action: "prepare", sources}); return {id:"workflow-plan", sources:[{subject:"Feature A"}]}; });
    ipcMain.handle("fixture:push-source", (_, branch, remote) => { workflowCalls.push({action:"mr-push",branch,remote}); });
    const indexCalls = [];
    ipcMain.handle("fixture:write", (_, content) => { writtenStore = JSON.parse(content); });
    ipcMain.handle("fixture:index", (_, action, files) => { indexCalls.push({ action, files }); });
    ipcMain.handle("fixture:commit", () => {
      commitCalls++;
      if (commitFailure) throw new Error("blocked hook");
      return new Promise(resolve => { finishCommit = () => {
        committed = true;
        resolve({ branch: "feature/A", commit: "abcdef1234567890" });
      }; });
    });
    ipcMain.handle("fixture:workspace", () => {
      if (workspaceFailure) throw new Error("演示工作区失败");
      return { path: "fixture", files: [
        { path: "shared.txt", group: "staged", status: "M", originalPath: null, submodule: false },
        { path: "shared.txt", group: "unstaged", status: "M", originalPath: null, submodule: false },
        { path: "image.bin", group: "untracked", status: "?", originalPath: null, submodule: false },
        ...extraFiles,
      ].filter(file => !committed || file.group !== "staged") };
    });
    ipcMain.handle("fixture:diff", (_, file, group) => {
      if (diffFailure) throw new Error("演示差异失败");
      const value = { path: file, group, kind: file === "image.bin" ? "binary" : "text",
        text: file === "image.bin" ? "" : `--- a/shared.txt\n+++ b/shared.txt\n@@ -1 +1 @@\n-base\n+${group} content\n`,
        message: file === "image.bin" ? "二进制文件不提供文本 diff" : "" };
      if (delayDiff) return new Promise(resolve => { releaseDiff = () => resolve(value); });
      return value;
    });
    ipcMain.handle("fixture:store", () => JSON.stringify(store));
    ipcMain.handle("fixture:operation", () => operation);
    ipcMain.handle("fixture:status", (_, directory) => {
      if (directory.endsWith("/B")) return valueB;
      if (failure) throw new Error("演示读取失败");
      if (delayed) return new Promise(resolve => { release = () => resolve(status("过期的项目 A")); });
      return valueA;
    });
    const preload = path.join(process.argv[2], "preload.cjs");
    await fs.writeFile(preload, `
      const {contextBridge, ipcRenderer} = require('electron');
      const subscribe = (channel, callback) => {
        const listener = (_, value) => callback(value);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
      };
      contextBridge.exposeInMainWorld('branchNote', {
        platform: process.platform,
        read: () => ipcRenderer.invoke('fixture:store'),
        write: content => ipcRenderer.invoke('fixture:write', content),
        readRepository: () => ipcRenderer.invoke('fixture:repository'),
        readGitWorkflow: () => ipcRenderer.invoke('fixture:workflow'),
        createLocalBranch: (_, name, source, checkout) => ipcRenderer.invoke('fixture:create-branch', name, source, checkout),
        switchLocalBranch: (_, ref) => ipcRenderer.invoke('fixture:switch-branch', ref),
        syncCurrentBranch: (_, action, target) => ipcRenderer.invoke('fixture:sync-branch', action, target),
        fetchRepository: () => ipcRenderer.invoke('fixture:fetch'),
        mergeState: async () => ({session:null, merging:false, unmerged:[], staged:[]}),
        prepareMerge: (_, target, sources) => ipcRenderer.invoke('fixture:prepare', sources),
        checkMerge: async () => ({status:'clean', conflicts:[]}),
        executeMerge: async () => ({status:'success', targetLocal:'feature/A', workingBranch:'feature/A', sourceRef:'refs/remotes/origin/feature/A',sourceHead:'1234567890abcdef'}),
        pushBranch: (_, branch, remote) => ipcRenderer.invoke('fixture:push-source', branch, remote),
        mergeRequestUrl: async () => 'https://example.invalid/new',
        createMergeRequest: async () => ({status:'created',url:'https://github.com/demo/repo/pull/1',number:'1'}),
        getGitOperation: () => ipcRenderer.invoke('fixture:operation'),
        subscribeGitOperation: callback => subscribe('fixture:operation', callback),
        readRepositoryStatus: directory => ipcRenderer.invoke('fixture:status', directory),
        readWorkspace: () => ipcRenderer.invoke('fixture:workspace'),
        readWorkspaceDiff: (_, file, group) => ipcRenderer.invoke('fixture:diff', file, group),
        updateWorkspaceIndex: (_, action, files) => ipcRenderer.invoke('fixture:index', action, files),
        commitWorkspace: () => ipcRenderer.invoke('fixture:commit'),
        commitWorkspaceFiles: () => ipcRenderer.invoke('fixture:commit'),
        requestProvider: async () => 'other',
        subscribeTrayAction: () => () => {},
        getUpdate: async () => ({status: 'manual', installMode: 'restart'}),
        subscribeUpdate: () => () => {},
      });
    `);
    win = new BrowserWindow({ show: false, width: 1100, height: 850,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const execute = async code => {
      try { return await win.webContents.executeJavaScript(code); }
      catch (error) { throw new Error(`界面脚本失败：${code}\n${error.message}`); }
    };
    const wait = async expression => {
      assert.equal(await execute(`(async () => {
        for (let i = 0; i < 100; i++) {
          if (${expression}) return true;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        return false;
      })()`), true, expression);
    };
    const panel = "document.querySelector('.repository-status-panel')";
    const refreshButton = `${panel}.querySelector('.heading-actions button:last-child')`;
    const refresh = () => execute(`${refreshButton}.click()`);
    const select = name => execute(`document.querySelectorAll('.project-nav-item')[${name === "A" ? 0 : 1}].click()`);
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
    await wait(`${panel}?.textContent.includes('feature/A')`);
    const widthBefore = await execute("Number(document.querySelector('.sidebar-resizer').getAttribute('aria-valuenow'))");
    await execute("document.querySelector('.sidebar-resizer').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))");
    await wait(`document.querySelector('.sidebar-resizer').getAttribute('aria-valuenow') === '${widthBefore + 10}'`);
    const handle = await execute("(() => { const rect = document.querySelector('.sidebar-resizer').getBoundingClientRect(); return {x: Math.round(rect.x + rect.width / 2), y: 200}; })()");
    win.webContents.sendInputEvent({type: "mouseMove", ...handle});
    win.webContents.sendInputEvent({type: "mouseDown", ...handle, button: "left", clickCount: 1});
    await execute("new Promise(resolve => requestAnimationFrame(resolve))");
    win.webContents.sendInputEvent({type: "mouseMove", x: handle.x + 50, y: handle.y});
    await wait(`document.querySelector('.sidebar-resizer').getAttribute('aria-valuenow') === '${widthBefore + 60}'`);
    win.webContents.sendInputEvent({type: "mouseUp", x: handle.x + 50, y: handle.y, button: "left", clickCount: 1});
    await wait(`document.querySelector('.sidebar-resizer').getAttribute('aria-valuenow') === '${widthBefore + 60}'`);
    assert.equal(await execute("Number(localStorage.getItem('branchnote-sidebar-width'))"), widthBefore + 60);
    await wait(`${panel}.textContent.includes('↑2 ↓1')`);
    if (process.env.BRANCHNOTE_STATUS_SCREENSHOT) {
      await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await fs.writeFile(process.env.BRANCHNOTE_STATUS_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    }
    await execute("[...document.querySelectorAll('.project-tabs [role=tab]')].find(button => button.textContent.includes('分支跟进')).click()");
    await wait("document.querySelector('.project-mr-workspace') !== null && document.querySelector('.repository-status-panel') === null");
    assert.equal(await execute("document.querySelector('.mr-workspace-topline button.primary')?.textContent.includes('从仓库添加分支')"), true);
    await execute("[...document.querySelectorAll('.project-tabs [role=tab]')].find(button => button.textContent.includes('当前分支与工作区')).click()");
    await wait("document.querySelector('.repository-status-panel') !== null && document.querySelector('.repository-status-panel').textContent.includes('feature/A') && document.querySelector('.project-mr-workspace') === null");
    valueA = { ...status(null), head: "detached", staged: true, unstaged: true, untracked: true,
      conflicts: true, clean: false, operations: ["rebase"] };
    await refresh();
    await wait(`${panel}.textContent.includes('分离 HEAD') && ${panel}.textContent.includes('当前应用不接管')`);
    for (const text of ["存在冲突"]) {
      assert.equal(await execute(`${panel}.textContent.includes(${JSON.stringify(text)})`), true);
    }
    failure = true;
    await refresh();
    await wait(`${panel}.querySelector('[role=alert]')?.textContent.includes('演示读取失败')`);
    failure = false;
    valueA = { ...status("main"), head: "unborn", commit: null, upstream: null };
    await refresh();
    await wait(`${panel}.textContent.includes('尚无首次提交')`);
    delayed = true;
    await refresh();
    await wait(`${panel}.getAttribute('aria-busy') === 'true'`);
    await select("B");
    await wait(`${panel}.textContent.includes('feature/B')`);
    assert.equal(typeof release, "function");
    release();
    await execute("new Promise(resolve => setTimeout(resolve, 100))");
    assert.equal(await execute(`${panel}.textContent.includes('过期的项目 A')`), false);
    operation = "更新远程引用";
    win.webContents.send("fixture:operation", operation);
    await wait(`${panel}.textContent.includes('结束后自动读取')`);
    operation = null;
    win.webContents.send("fixture:operation", operation);
    await wait(`${panel}.textContent.includes('feature/B') && !${refreshButton}.disabled`);
    valueB = status("feature/B-fast");
    win.webContents.send("fixture:operation", "推送分支");
    win.webContents.send("fixture:operation", null);
    await wait(`${panel}.textContent.includes('feature/B-fast')`);
    delayed = false;
    valueA = { ...status("feature/" + "很长的分支名称".repeat(20)), upstream: "origin/" + "很长的上游名称".repeat(20) };
    await select("A");
    await wait(`${panel}.textContent.includes('很长的分支名称')`);
    assert.equal(await execute(`${panel}.scrollWidth <= ${panel}.clientWidth`), true);
    await wait("document.querySelectorAll('.workspace-file').length === 3");
    const choose = group => execute(`document.querySelector('.workspace-files section[aria-label="${group}"] .workspace-file').click()`);
    await choose("已暂存");
    await wait("document.querySelector('.workspace-diff')?.textContent.includes('+staged content')");
    assert.equal(await execute("document.querySelector('.workspace-diff').textContent.includes('unstaged content')"), false);
    delayDiff = true;
    await choose("未暂存");
    await wait("document.querySelector('.workspace-preview').getAttribute('aria-busy') === 'true'");
    delayDiff = false;
    await choose("已暂存");
    await wait("document.querySelector('.workspace-diff')?.textContent.includes('+staged content')");
    releaseDiff();
    await execute("new Promise(resolve => setTimeout(resolve, 100))");
    assert.equal(await execute("document.querySelector('.workspace-diff').textContent.includes('unstaged content')"), false);
    if (process.env.BRANCHNOTE_STATUS_SCREENSHOT) {
      await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await fs.writeFile(process.env.BRANCHNOTE_STATUS_SCREENSHOT.replace(/\.png$/, "-workspace.png"), (await win.webContents.capturePage()).toPNG());
    }
    await choose("未跟踪");
    await wait("document.querySelector('.workspace-preview').textContent.includes('二进制文件')");
    diffFailure = true;
    await choose("已暂存");
    await wait("document.querySelector('.workspace-preview [role=alert]')?.textContent.includes('演示差异失败')");
    diffFailure = false;
    await choose("未暂存");
    await wait("document.querySelector('.workspace-diff')?.textContent.includes('+unstaged content')");
    workspaceFailure = true;
    await execute("document.querySelector('.workspace-toolbar button').click()");
    await wait("document.querySelector('.workspace-inline [role=alert]')?.textContent.includes('演示工作区失败')");
    workspaceFailure = false;
    await execute("document.querySelector('.workspace-toolbar button').click()");
    await wait("document.querySelectorAll('.workspace-file').length === 3");
    console.log("PASS: 工作区入口、分组 diff、快速切换文件防串数据、二进制提示及文件列表/差异失败重试");
    await choose("未暂存");
    await wait("document.querySelector('.workspace-preview button')?.textContent.includes('暂存此文件')");
    await execute("document.querySelector('.workspace-preview button').click()");
    await wait("document.querySelectorAll('.workspace-file').length === 3 && document.querySelector('.workspace-inline').textContent.includes('文件已暂存')");
    assert.deepEqual(indexCalls.at(-1), { action: "stage", files: ["shared.txt"] });
    await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await wait("document.querySelector('.workspace-files section[aria-label=已暂存] .workspace-file-row input') !== null");
    await execute("document.querySelector('.workspace-files section[aria-label=已暂存] .workspace-file-row input').click()");
    await execute("[...document.querySelectorAll('.workspace-actions button')].find(button => button.textContent.includes('取消暂存所选')).click()");
    await wait("document.querySelectorAll('.workspace-file').length === 3 && document.querySelector('.workspace-inline').textContent.includes('已取消暂存')");
    assert.deepEqual(indexCalls.at(-1), { action: "unstage", files: ["shared.txt"] });
    await execute(`(() => {
      const input = document.querySelector('.workspace-commit input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '保留标题');
      input.dispatchEvent(new Event('input', {bubbles:true}));
      const body = document.querySelector('.workspace-commit textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(body, '保留正文');
      body.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await execute("document.querySelector('.workspace-commit').requestSubmit()");
    await wait("document.querySelector('.workspace-inline [role=alert]')?.textContent.includes('blocked hook') && !document.querySelector('.workspace-commit input').disabled");
    assert.equal(await execute("document.querySelector('.workspace-commit input').value"), "保留标题");
    assert.equal(await execute("document.querySelector('.workspace-commit textarea').value"), "保留正文");
    commitFailure = false;
    await execute("document.querySelector('.workspace-commit').requestSubmit(); document.querySelector('.workspace-commit').requestSubmit()");
    await wait("document.querySelector('.workspace-commit input').disabled");
    assert.equal(commitCalls, 2);
    finishCommit();
    await wait("document.querySelector('.workspace-commit input').value === '' && document.querySelector('.workspace-inline').textContent.includes('提交成功')");
    assert.equal(writtenStore.branches[0].testMergedAt, null);
    assert.equal(await execute("document.querySelector('.workspace-commit button[type=submit]').disabled"), true);
    extraFiles = Array.from({length: 120}, (_, index) => ({ path: `many/file-${index}.txt`, group: "untracked", status: "?", originalPath: null, submodule: false }));
    await execute("document.querySelector('.workspace-toolbar button').click()");
    await wait("document.querySelectorAll('.workspace-file').length === 122");
    await execute("document.querySelector('.workspace-files input.workspace-select-all').click()");
    await wait("document.querySelectorAll('.workspace-files .workspace-file-row input:checked').length === 122");
    await execute("document.querySelector('.workspace-files input.workspace-select-all').click()");
    await wait("document.querySelectorAll('.workspace-files .workspace-file-row input:checked').length === 0");
    assert.equal(await execute("(() => { const files = document.querySelector('.workspace-files'); return files.scrollHeight > files.clientHeight; })()"), true);
    assert.equal(await execute("document.querySelector('.workspace-inline') !== null"), true);
    if (process.env.BRANCHNOTE_STATUS_SCREENSHOT) {
      await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await fs.writeFile(process.env.BRANCHNOTE_STATUS_SCREENSHOT.replace(/\.png$/, "-workspace-many.png"), (await win.webContents.capturePage()).toPNG());
    }
    console.log("PASS: 侧栏原生鼠标拖动/键盘调整与宽度保存、120 文件下独立滚动、全局全选及清除、提交按钮无需整窗滚动");
    win.setSize(900, 650);
    await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await execute("[...document.querySelectorAll('.project-summary-actions button')].find(button => button.textContent.includes('编辑项目')).click()");
    await wait("document.querySelector('.project-editor-form') !== null");
    assert.equal(await execute("document.querySelector('.project-editor-form input[name=name]') === null"), true);
    await execute("document.querySelector('.project-editor-form').requestSubmit()");
    await wait("document.querySelector('dialog') === null");
    assert.equal(writtenStore.projects[0].name, "A");
    win.setSize(1100, 850);
    await execute("[...document.querySelectorAll('.workspace-toolbar button')].find(button => button.textContent.includes('切换分支 / 同步')).click()");
    await wait("document.querySelector('.git-workflow-body')?.textContent.includes('feature/A')");
    const workflowClick = async text => {
      await wait(`[...document.querySelectorAll('.git-workflow-body button')].some(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.disabled)`);
      await execute(`[...document.querySelectorAll('.git-workflow-body button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
      await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    };
    const selectOption = async (label, text) => {
      await execute(`document.querySelector('[role=combobox][aria-label=${JSON.stringify(label)}]').click()`);
      await execute(`[...document.querySelectorAll('.select-menu[aria-label=${JSON.stringify(label)}] [role=option]')].find(option => option.textContent.trim() === ${JSON.stringify(text)}).click()`);
    };
    await execute(`(() => {
      const input = document.querySelector('[aria-label="新分支名称"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'feature/新增');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await workflowClick("创建分支");
    await wait("document.querySelector('.git-workflow-body').textContent.includes('当前分支：feature/新增')");
    assert.deepEqual(workflowCalls.find(item => item.action === "create"), {action:"create",name:"feature/新增",source:"HEAD",checkout:true});
    await selectOption("切换分支", "本地 · main");
    await workflowClick("切换到所选分支");
    await wait("document.querySelector('.git-workflow-body').textContent.includes('当前分支：main')");
    await workflowClick("获取远程引用（Fetch）");
    await wait("document.querySelector('.git-workflow-body').textContent.includes('second · 失败')");
    await selectOption("首次推送远程", "second");
    failPush = true;
    await workflowClick("普通推送");
    await wait("document.querySelector('.git-workflow-body [role=alert]')?.textContent.includes('远端已有新提交')");
    assert.equal(await execute("document.querySelector('.git-workflow-body').textContent.includes('为已推送分支提交')"), false);
    failPush = false;
    await workflowClick("普通推送");
    await wait("document.querySelector('.git-workflow-body').textContent.includes('目标：second → main')");
    assert.deepEqual(workflowCalls.filter(item => item.action === "push").at(-1), {action:"push",branch:"main",remote:"second",target:"main"});
    if (process.env.BRANCHNOTE_STATUS_SCREENSHOT) {
      await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await fs.writeFile(process.env.BRANCHNOTE_STATUS_SCREENSHOT.replace(/\.png$/, "-workflow.png"), (await win.webContents.capturePage()).toPNG());
    }
    await workflowClick("快进拉取到当前分支");
    await wait("document.querySelector('.git-workflow-body').textContent.includes('当前分支已完成快进拉取')");
    workflowBranch = "local-alias";
    workflowUpstream = {remote:"origin",branch:"feature/A"};
    win.webContents.send("fixture:operation", "读取仓库状态");
    win.webContents.send("fixture:operation", null);
    await wait("document.querySelector('.git-workflow-body').textContent.includes('当前分支：local-alias')");
    await workflowClick("普通推送");
    await wait("document.querySelector('.git-workflow-body').textContent.includes('为已推送分支提交 MR / PR')");
    await workflowClick("为已推送分支提交 MR / PR");
    await wait("document.querySelector('.submit-dialog-body')?.textContent.includes('本次已推送源：origin/feature/A')");
    assert.equal(await execute("[...document.querySelectorAll('.submit-dialog-body .select-menu [role=option]')].some(option => option.textContent.includes('second/'))"), false);
    await wait("[...document.querySelectorAll('dialog button')].some(button => button.textContent.trim() === '提交 合并请求' && !button.disabled)");
    await execute("[...document.querySelectorAll('dialog button')].find(button => button.textContent.trim() === '提交 合并请求').click()");
    await wait("document.querySelector('.submit-dialog-body')?.textContent.includes('打开 合并请求')");
    assert.deepEqual(workflowCalls.find(item => item.action === "prepare").sources, ["origin/feature/A"]);
    assert.deepEqual(workflowCalls.find(item => item.action === "mr-push"), {action:"mr-push",branch:"feature/A",remote:"origin"});
    assert.equal(writtenStore.branches[0].testMR.source, "feature/A");
    console.log("PASS: 创建/切换、Fetch 分远程结果、首次推送指定远程、推送失败不建 MR、快进拉取及不同名上游 MR 源固定");
    console.log("PASS: 单文件/所选暂存入口、提交失败保留输入、重复提交拦截、同名台账重置、文件夹命名保存");
    console.log("PASS: 状态展示、空提交、分离 HEAD、会话提示、失败重试、项目切换防串数据、操作结束刷新及长名称布局");
  } finally {
    win?.destroy();
    app.quit();
  }
}
main().catch(error => {
  console.error(error);
  if (process.versions.electron) require("electron").app.exit(1);
  else process.exitCode = 1;
});
