"use strict";
// Run only on a disposable GitHub-hosted macOS runner after building BASELINE_REPO.
// Uses genuine signed DMGs; only release discovery and transport are simulated in the baseline driver.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const { createRequire } = require("node:module");
const { basename, isAbsolute, join, normalize } = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { Readable } = require("node:stream");
const { setTimeout: sleep } = require("node:timers/promises");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const OLD_VERSION = "0.2.6", NEW_VERSION = "0.2.7";
const BUNDLE_ID = "com.branchnote.desktop";
const DIR = join("Library", "Application Support", "branchnote");
const BASE_SHA = "f633c722f09f663d9adcb08ddadd8ca6a49bb732";
const config = process.env.BRANCHNOTE_TEST_CONFIG && JSON.parse(process.env.BRANCHNOTE_TEST_CONFIG);
const timeout = 120_000;
const hash = async (file) => {
  const h = createHash("sha512");
  for await (const data of createReadStream(file)) h.update(data);
  return h.digest("base64");
};
const json = async (filename) => JSON.parse(await fs.readFile(filename, "utf8"));
const cmd = (name, args, extra = {}) => exec(name, args, { timeout, ...extra });
const required = (key) => {
  const value = process.env[key];
  assert.ok(value && isAbsolute(value), key + " must be an absolute path");
  return value;
};
const exists = (path) => fs.lstat(path).then(() => true, error => {
  if (error.code !== "ENOENT") throw error;
  return false;
});
async function until(description, fn, ms = 45_000) {
  let last;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; }
    catch (error) { last = error; }
    await sleep(250);
  }
  throw new Error(description, { cause: last });
}
async function withDmg(dmg, mount, action) {
  await fs.mkdir(mount);
  await cmd("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  try { return await action(join(mount, "BranchNote.app")); }
  finally { await cmd("/usr/bin/hdiutil", ["detach", mount]); }
}
const plist = (bundle, key) => cmd("/usr/bin/plutil",
  ["-extract", key, "raw", "-o", "-", join(bundle, "Contents", "Info.plist")]).then(p => p.stdout.trim());
async function bundleInfo(bundle, version) {
  assert.equal(await plist(bundle, "CFBundleIdentifier"), BUNDLE_ID);
  assert.equal(await plist(bundle, "CFBundleShortVersionString"), version);
  const name = await plist(bundle, "CFBundleExecutable");
  assert.equal(basename(name), name);
  const exe = join(bundle, "Contents", "MacOS", name);
  const architecture = (await cmd("/usr/bin/file", ["-b", exe])).stdout;
  assert.ok(architecture.includes(process.arch === "arm64" ? "arm64" : "x86_64"), architecture);
  await cmd("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  return { exe, asar: await hash(join(bundle, "Contents", "Resources", "app.asar")) };
}
// Parse only the known electron-builder files stanza; do not invent metadata from the downloaded bytes.
function parseManifest(yaml, assetName) {
  const version = yaml.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1];
  const table = yaml.match(/^files:\s*\n((?:[ \t][^\n]*\n?)*)/m)?.[1];
  assert.ok(table, "latest-mac.yml has no files stanza");
  const rows = table.split(/^\s*- url:\s*/m).slice(1);
  const row = rows.find(value => value.split(/\r?\n/, 1)[0].trim().replace(/^['"]|['"]$/g, "") === assetName);
  assert.ok(row, "Candidate DMG missing in latest-mac.yml");
  const sha512 = row.match(/^\s*sha512:[ \t]*['"]?([A-Za-z0-9+/]{86}==)['"]?[ \t]*\r?$/m)?.[1];
  const size = Number(row.match(/^\s*size:[ \t]*(\d+)[ \t]*\r?$/m)?.[1]);
  assert.equal(version, NEW_VERSION);
  assert.ok(sha512 && Number.isSafeInteger(size) && size > 0, "Candidate manifest checksum/size missing");
  return { version, tag: "v" + version, files: [{ url: assetName, sha512, size }] };
}
const launch = (exe, args, options) => {
  const child = spawn(exe, args, { stdio: "inherit", ...options });
  child.outcome = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  child.outcome.catch(() => {});
  return child;
};
function cleanChildren(pid) {
  if (Number.isInteger(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
async function pids(executable) {
  const { stdout } = await cmd("/bin/ps", ["-axo", "pid=,command="]);
  return stdout.split("\n").flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    return m && (m[2] === executable || m[2].startsWith(executable + " ")) ? [Number(m[1])] : [];
  });
}
const freePort = async () => {
  const s = createServer();
  await new Promise((resolve, reject) => { s.once("error", reject); s.listen(0, "127.0.0.1", resolve); });
  const port = s.address().port;
  await new Promise((resolve, reject) => s.close(error => error ? reject(error) : resolve()));
  return port;
};
function evalCdp(url, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const done = (cb, value) => { clearTimeout(t); ws.close(); cb(value); };
    const t = setTimeout(() => done(reject, new Error("CDP timeout")), 8000);
    ws.addEventListener("error", error => done(reject, error), { once: true });
    ws.addEventListener("open", () => ws.send(JSON.stringify({
      id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true }
    })), { once: true });
    ws.addEventListener("message", event => {
      const result = JSON.parse(event.data);
      if (result.id !== 1) return;
      if (result.error || result.result.exceptionDetails) return done(reject, Error(JSON.stringify(result)));
      return done(resolve, result.result.result.value);
    });
  });
}
const observation = `(async () => ({
  version: (await window.branchNote.getUpdate()).currentVersion,
  text: document.body.innerText,
  data: await window.branchNote.read()
}))()`;
async function inspectRunning(exe, expectedVersion, fixture) {
  const port = await freePort();
  const running = launch(exe, [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"]);
  try {
    await until("Genuine app did not render the fixture at version " + expectedVersion, async () => {
      if (running.exitCode !== null || running.signalCode !== null) return false;
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      const page = (await response.json()).find(x => x.type === "page" && x.url.endsWith("/dist/index.html"));
      if (!page) return false;
      const observed = await evalCdp(page.webSocketDebuggerUrl, observation);
      if (observed?.version !== expectedVersion || !observed.text.includes(fixture.projects[0].name)) return false;
      const read = typeof observed.data === "string" ? JSON.parse(observed.data) : observed.data;
      assertFixture(read, fixture);
      return true;
    });
  } finally {
    if (running.exitCode === null && running.signalCode === null) cleanChildren(running.pid);
    await Promise.race([running.outcome, sleep(10_000)]);
    await until("Genuine inspection process did not quit", async () => !(await pids(exe)).length, 10000);
  }
}
function assertFixture(read, fixture) {
  assert.equal(read.projects.find(p => p.id === "upgrade-project")?.note, fixture.projects[0].note);
  assert.equal(read.branches.find(b => b.id === "upgrade-branch")?.name, fixture.branches[0].name);
  assert.equal(read.branches.find(b => b.id === "upgrade-branch")?.note, fixture.branches[0].note);
  assert.equal(read.mrRefreshSeconds, fixture.mrRefreshSeconds);
}
async function driver(c) {
  const { app, BrowserWindow } = require("electron");
  const { EventEmitter } = require("node:events");
  app.setPath("userData", c.profile);
  app.setVersion(OLD_VERSION);
  const updaterModule = join(c.baseline, "electron", "updater.cjs");
  const native = require(updaterModule).initializeUpdater;
  const mockDiscovery = new EventEmitter();
  let requests = 0;
  mockDiscovery.checkForUpdates = async () => {
    mockDiscovery.emit("checking-for-update");
    mockDiscovery.emit("update-available", c.info);
    return { isUpdateAvailable: true, updateInfo: c.info };
  };
  // Main still owns the native window, preload, real app exit and Git interlock.
  // The development Electron shell acts as v0.2.6 and targets the real copied release .app.
  const facade = {
    isPackaged: true,
    getVersion: () => app.getVersion(),
    getPath: key => key === "exe" ? c.oldExe : key === "temp" ? c.root : app.getPath(key),
    once: app.once.bind(app),
    quit: app.quit.bind(app)
  };
  require.cache[require.resolve(updaterModule)].exports = {
    initializeUpdater(options) {
      native({ ...options, app: facade, autoUpdater: mockDiscovery, fetchUpdate: async (url, opts) => {
        assert.equal(url, `https://github.com/FluentHaze/BranchNote/releases/download/v${NEW_VERSION}/${c.info.files[0].url}`);
        assert.equal(opts.redirect, "manual");
        requests++;
        console.log("Fixture transport requests genuine artifact bytes:", url);
        return new Response(Readable.toWeb(createReadStream(c.newDmg, { signal: opts.signal })), {
          status: 200,
          headers: { "content-length": String(c.info.files[0].size) }
        });
      } });
    }
  };
  const watchdog = setTimeout(() => { console.error("Timed out in v0.2.6 update UI"); app.exit(1); }, timeout);
  app.on("browser-window-created", (_, window) => {
    window.webContents.once("did-finish-load", async () => {
      try {
        assert.equal(new URL(window.webContents.getURL()).pathname.endsWith("/dist/index.html"), true);
        await until("v0.2.6 source UI did not load seeded data", () => window.webContents.executeJavaScript(
          `document.body.innerText.includes(${JSON.stringify(c.fixture.projects[0].name)})`));
        await window.webContents.executeJavaScript("window.branchNote.update('check')");
        await until("Downloaded update card did not show install action", () => window.webContents.executeJavaScript(
          `(async () => {
            const update = await window.branchNote.getUpdate();
            return update.status === "downloaded" && update.version === "${NEW_VERSION}" &&
              document.querySelector(".sidebar-bottom .update-notice button")?.textContent === "重启并安装";
          })()`));
        assert.equal(requests, 1, "Unexpected fixture download retry count");
        assert.equal(await hash(join(c.profile, "mac-update", "update.dmg")), c.info.files[0].sha512);
        await fs.writeFile(join(c.root, "download-verified"), String(requests));
        console.log("Clicking native update UI after size and SHA-512 validated");
        await window.webContents.executeJavaScript(
          `document.querySelector(".sidebar-bottom .update-notice button").click()`);
        // The real updater calls app.quit() only after starting the actual macOS install helper.
      } catch (error) {
        clearTimeout(watchdog);
        console.error(error);
        app.exit(1);
      }
    });
  });
  require(join(c.baseline, "electron", "main.cjs"));
}
async function run() {
  assert.equal(process.platform, "darwin");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Requires a disposable GitHub Actions runner");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Never run on self-hosted or user Macs");
  const oldDmg = await fs.realpath(required("OLD_DMG")), newDmg = await fs.realpath(required("NEW_DMG"));
  const manifest = await fs.readFile(required("NEW_MANIFEST"), "utf8");
  const baseline = await fs.realpath(required("BASELINE_REPO"));
  assert.equal((await cmd("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: baseline })).stdout.trim(), BASE_SHA);
  assert.equal((await cmd("/usr/bin/git", ["status", "--porcelain", "--untracked-files=no"], { cwd: baseline })).stdout.trim(), "",
    "v0.2.6 source must be unmodified");
  const requireBaseline = createRequire(join(baseline, "package.json"));
  assert.equal(requireBaseline("./package.json").version, OLD_VERSION);
  assert.ok(["arm64", "x64"].includes(process.arch));
  assert.equal(basename(oldDmg), `BranchNote-${OLD_VERSION}-mac-${process.arch}.dmg`);
  assert.equal(basename(newDmg), `BranchNote-${NEW_VERSION}-mac-${process.arch}.dmg`);
  const info = parseManifest(manifest, basename(newDmg));
  assert.equal((await fs.stat(newDmg)).size, info.files[0].size);
  assert.equal(await hash(newDmg), info.files[0].sha512);
  const profile = join(await fs.realpath(required("HOME")), DIR);
  assert.equal(await exists(profile), false, "Refusing to touch an existing BranchNote profile");
  assert.equal(await exists(join(profile, "..", "BranchNote")), false, "Refusing alternate-case BranchNote profile");
  const root = await fs.mkdtemp(join(await fs.realpath(required("RUNNER_TEMP")), "branchnote-mac-upgrade-"));
  assert.ok(isAbsolute(root) && normalize(root) === root && !root.startsWith("/Applications"));
  const installed = join(root, "BranchNote.app");
  let oldExe, profileCreated = false;
  try {
    const newApp = await withDmg(newDmg, join(root, "new-mount"), bundle => bundleInfo(bundle, NEW_VERSION));
    await withDmg(oldDmg, join(root, "old-mount"), async bundle => {
      await bundleInfo(bundle, OLD_VERSION);
      await cmd("/usr/bin/ditto", [bundle, installed]);
    });
    oldExe = (await bundleInfo(installed, OLD_VERSION)).exe;
    assert.ok(oldExe.startsWith(root + "/"));
    assert.deepEqual(await pids(oldExe), []);
    assert.equal(newApp.exe.split("/").at(-1), oldExe.split("/").at(-1), "Bundle executable name changed");
    const fixture = {
      version: 3, mrRefreshSeconds: 120,
      projects: [{ id: "upgrade-project", name: "Upgrade fixture project", note: "keep project", archived: false }],
      branches: [{ id: "upgrade-branch", projectId: "upgrade-project", name: "feature/preserved", description: "keep branch",
        note: "keep branch note", testMergedAt: null, releaseMergedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await fs.mkdir(profile, { mode: 0o700 });
    profileCreated = true;
    await fs.writeFile(join(profile, "branchnote.json"), JSON.stringify(fixture));
    await inspectRunning(oldExe, OLD_VERSION, fixture);
    console.log("Genuine v0.2.6 launch and fixture read passed");
    const fixtureDriver = launch(requireBaseline("electron"), [__filename, "--driver"], {
      env: { ...process.env, BRANCHNOTE_TEST_CONFIG: JSON.stringify({ baseline, root, profile, oldExe, newDmg, info, fixture }) }
    });
    try {
      await until("Real updater did not replace/restart signed candidate in disposable bundle",
        async () => await exists(join(root, "download-verified")) &&
          (await plist(installed, "CFBundleShortVersionString")) === NEW_VERSION &&
          fixtureDriver.exitCode === 0 && (await pids(oldExe)).length > 0, timeout);
      assert.deepEqual(await fixtureDriver.outcome, { code: 0, signal: null });
    } finally {
      if (fixtureDriver.exitCode === null && fixtureDriver.signalCode === null) cleanChildren(fixtureDriver.pid);
    }
    assert.equal((await bundleInfo(installed, NEW_VERSION)).asar, newApp.asar, "Reopened bundle is not genuine candidate");
    assertFixture(await json(join(profile, "branchnote.json")), fixture);
    for (const pid of await pids(oldExe)) cleanChildren(pid);
    await until("Native restart process did not quit before UI probe", async () => !(await pids(oldExe)).length, 10000);
    await inspectRunning(oldExe, NEW_VERSION, fixture);
    console.log("PASS: exact v0.2.6 genuine app preflight; v0.2.6 source update UI fetched actual candidate bytes via fixture; production validation/signatures/native swap and automatic restart; genuine v0.2.7 UI reads prior project, branch and settings.");
  } finally {
    if (oldExe) for (const pid of await pids(oldExe)) cleanChildren(pid);
    if (profileCreated) await fs.rm(profile, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
}
if (process.argv.includes("--driver")) {
  driver(config).catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}
