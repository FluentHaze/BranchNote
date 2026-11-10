import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const { initializeUpdater } = createRequire(import.meta.url)("../electron/updater.cjs");

test("Windows 更新检查去重、下载进度、安装与 Git 操作互斥", { skip: process.platform !== "win32" }, async () => {
  const app = Object.assign(new EventEmitter(), { isPackaged: true, getVersion: () => "0.2.0" });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let checks = 0;
  let installs = 0;
  let merging = true;
  let finishDownload!: () => void;
  const downloadPromise = new Promise<void>(resolve => { finishDownload = resolve; });
  const autoUpdater = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    checkForUpdates: async () => {
      checks++;
      autoUpdater.emit("checking-for-update");
      autoUpdater.emit("update-available", { version: "0.3.0" });
      return { downloadPromise };
    },
    quitAndInstall: () => { installs++; },
  });
  initializeUpdater({ app, BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) },
    shell: { openExternal: async () => {} }, autoUpdater, canInstall: () => !merging });
  const action = handlers.get("update:action")!;
  const get = handlers.get("update:get")!;
  const event = { senderFrame: { url: "file:///app/index.html" } };
  try {
    const checking = action(event, "check");
    await action(event, "check");
    assert.equal(checks, 1);
    autoUpdater.emit("download-progress", { percent: 55 });
    assert.equal((await get() as { percent: number }).percent, 55);
    autoUpdater.emit("update-downloaded", { version: "0.3.0" });
    finishDownload();
    await checking;
    await assert.rejects(async () => action(event, "install"), /Git/);
    merging = false;
    await action(event, "install");
    assert.equal(installs, 1);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
    await assert.rejects(async () => action({ senderFrame: { url: "https://example.com" } }, "install"), /无效/);
  } finally {
    app.emit("before-quit");
  }
});

test("开发版仅提供手动下载，不检查更新", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let opened = "";
  initializeUpdater({ app: { isPackaged: false, getVersion: () => "0.2.0" },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) },
    shell: { openExternal: async (url: string) => { opened = url; } },
    autoUpdater: new EventEmitter(), canInstall: () => true });
  assert.equal((await handlers.get("update:get")!() as { status: string }).status, "manual");
  await handlers.get("update:action")!({ senderFrame: { url: "file:///app/index.html" } }, "manual");
  assert.equal(opened, "https://github.com/FluentHaze/BranchNote/releases/latest");
});

test("Mac 使用独立 DMG 下载器并恢复已校验的安装包，不触发 Squirrel 下载", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  const root = await mkdtemp(join(tmpdir(), "branchnote-mac-updater-"));
  const bytes = Buffer.from("fixture DMG");
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, getVersion: () => "0.2.0", getPath: () => root,
  });
  const autoUpdater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    checkForUpdates: async () => {
      autoUpdater.emit("checking-for-update");
      autoUpdater.emit("update-available", { version: "0.3.0" });
      return { isUpdateAvailable: true, updateInfo: {
        version: "0.3.0", tag: "v0.3.0", files: [{
          url: `BranchNote-0.3.0-mac-${process.arch}.dmg`,
          sha512: createHash("sha512").update(bytes).digest("base64"), size: bytes.length,
        }],
      } };
    },
  });
  const options = { app, BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) },
    shell: {}, autoUpdater, canInstall: () => false,
    fetchUpdate: async () => new Response(bytes) };
  try {
    Object.defineProperty(process, "platform", { value: "darwin" });
    initializeUpdater(options);
    assert.equal(autoUpdater.autoDownload, false);
    const event = { senderFrame: { url: "file:///app/index.html" } };
    await handlers.get("update:action")!(event, "check");
    const state = await handlers.get("update:get")!() as { status: string; version: string; installMode: string };
    assert.equal(state.status, "downloaded");
    assert.equal(state.version, "0.3.0");
    assert.equal(state.installMode, "dmg");
    await assert.rejects(async () => handlers.get("update:action")!(event, "install"), /Git/);
    app.emit("before-quit");
    initializeUpdater({ ...options, autoUpdater: new EventEmitter() });
    assert.equal((await handlers.get("update:get")!() as { status: string }).status, "downloaded");
  } finally {
    app.emit("before-quit");
    Object.defineProperty(process, "platform", descriptor);
    await rm(root, { recursive: true, force: true });
  }
});
