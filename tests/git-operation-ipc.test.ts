import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);

test("主进程所有 Git 写入口共用互斥状态，更新检查随操作恢复，只读入口保持可用", async () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  const events: unknown[][] = [];
  let ready!: () => Promise<void>;
  let canInstall!: () => boolean;
  let finish!: () => void;
  let pushes = 0;
  const failure = new Error("保存失败");
  class Window extends EventEmitter {
    static getAllWindows() { return [new Window()]; }
    webContents = Object.assign(new EventEmitter(), {
      send: (...args: unknown[]) => events.push(args),
      setWindowOpenHandler() {},
      setZoomFactor() {},
    });
    isDestroyed() { return false; }
    loadFile() {}
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (callback: typeof ready) => { ready = callback; } }),
  });
  const git = {
    fetchRepository: () => new Promise<void>(resolve => { finish = resolve; }),
    readRepositoryStatus: () => ({ head: "branch" }),
    pushBranch: () => { pushes++; return { status: "pushed" }; },
    resolveConflictFile: () => { throw failure; },
  };
  const electron = {
    app, BrowserWindow: Window, Tray,
    ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) },
    nativeTheme: {}, Menu: { buildFromTemplate() {} },
    nativeImage: { createFromPath: () => ({ resize() {} }) },
  };
  const source = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
  vm.runInNewContext(source, {
    require: (name: string) => {
      if (name === "electron") return electron;
      if (name === "./git.cjs") return git;
      if (name === "./hosts.cjs") return {};
      if (name === "electron-updater") return {};
      if (name === "../dist-electron/update-fetch.cjs") return {};
      if (name === "./updater.cjs") return {
        initializeUpdater: (options: {canInstall: () => boolean}) => { canInstall = options.canInstall; },
      };
      return require(name === "./git-operation.cjs" ? "../electron/git-operation.cjs" : name);
    },
    process: { platform: process.platform },
    __dirname: fileURLToPath(new URL("../electron/", import.meta.url)),
  });
  await ready();
  const invoke = (name: string, ...args: unknown[]) => handlers.get(`repository:${name}`)!(null, ...args);
  assert.equal(canInstall(), true);
  const fetching = invoke("fetch", path.resolve("fixture"));
  assert.equal(canInstall(), false);
  assert.equal(invoke("operation"), "更新远程引用");
  assert.equal((invoke("status", "fixture") as {head: string}).head, "branch");
  for (const [name, payload] of [
    ["fetch", "fixture"], ["prepare-merge", {}], ["check-merge", "plan"],
    ["execute-merge", "plan"], ["push", {}], ["conflict-resolve", {}],
    ["conflict-side", {}], ["conflict-union", {}], ["conflict-commit", {}],
    ["conflict-abort", {}], ["continue-merge", {}], ["finalize-merge", {}],
    ["workspace-index", { action: "stage" }], ["workspace-commit", {}],
    ["create-branch", {}], ["switch-branch", {}], ["sync-branch", {}],
  ] as const) {
    await assert.rejects(async () => invoke(name, payload), /正在更新远程引用/);
  }
  assert.equal(pushes, 0);
  finish();
  await fetching;
  assert.equal(canInstall(), true);
  assert.equal(invoke("operation"), null);
  await invoke("push", {});
  assert.equal(pushes, 1);
  await assert.rejects(async () => invoke("conflict-resolve", {}), error => error === failure);
  assert.equal(canInstall(), true);
  assert.equal(invoke("operation"), null);
  assert.deepEqual(events, [
    ["repository:operation", "更新远程引用"], ["repository:operation", null],
    ["repository:operation", "推送分支"], ["repository:operation", null],
    ["repository:operation", "保存冲突文件"], ["repository:operation", null],
  ]);
});
