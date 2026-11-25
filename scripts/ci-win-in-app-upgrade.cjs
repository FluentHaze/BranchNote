const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createServer } = require('node:http');
const { join, basename } = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

const exec = promisify(execFile);
const windows = process.platform === 'win32';
const version = '0.2.7';
const oldVersion = '0.2.6';
const title = 'Upgrade QA Project';
const sidebarWidth = '284';

async function until(label, action, timeout = 45000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`${label} timed out`, { cause: lastError });
}

async function ps(script, params = {}, timeout = 15000) {
  const { stdout } = await exec('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, ...params }, timeout, windowsHide: true });
  return stdout.trim();
}

async function openRenderer(exe) {
  // The CI VM has no user installation. Leave the automatic restart's default
  // profile unchanged, and enable CDP only on the two test-controlled launches.
  const socket = createServer();
  await new Promise((ok, fail) => socket.once('error', fail).listen(0, '127.0.0.1', ok));
  const port = socket.address().port;
  await new Promise((ok) => socket.close(ok));
  const app = spawn(exe, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
    { stdio: 'ignore' });
  try {
    const debuggerUrl = await until('Electron renderer', async () => {
      if (app.exitCode !== null) throw new Error(`App exit ${app.exitCode}`);
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1500),
      })).json();
      return list.find((x) => x.type === 'page' && x.url.startsWith('file:') &&
        x.url.endsWith('/index.html'))?.webSocketDebuggerUrl;
    });
    const ws = new WebSocket(debuggerUrl);
    await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('CDP connect timeout')), 5000);
      ws.addEventListener('open', () => { clearTimeout(timer); ok(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); fail(new Error('CDP unavailable')); }, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', ({ data }) => {
      const m = JSON.parse(data);
      pending.get(m.id)?.(m);
    });
    const evaluate = (expression) => new Promise((ok, fail) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error('CDP evaluation timeout')); }, 10000);
      pending.set(id, ({ error, result }) => {
        clearTimeout(timer);
        pending.delete(id);
        if (error || result?.exceptionDetails)
          fail(new Error(JSON.stringify(error || result.exceptionDetails)));
        else ok(result?.result?.value);
      });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression, returnByValue: true, awaitPromise: true,
      } }));
    });
    return { app, evaluate, close: () => ws.close() };
  } catch (error) {
    app.kill();
    throw error;
  }
}

async function main() {
  assert(windows && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'Ephemeral Windows GitHub Actions only');
  const { RUNNER_TEMP, OLD_EXE, WIN_ASSETS } = process.env;
  assert(RUNNER_TEMP && OLD_EXE && WIN_ASSETS);
  const install = join(RUNNER_TEMP, 'branchnote-in-app-update');
  const exe = join(install, 'BranchNote.exe');
  const installerName = `BranchNote-Setup-${version}-x64.exe`;
  const allowed = new Set(['latest.yml', installerName, `${installerName}.blockmap`]);
  const hits = new Map();
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname.slice(1));
      if (!allowed.has(name) || name !== basename(name)) {
        res.writeHead(404).end();
        return;
      }
      const path = join(WIN_ASSETS, name);
      const size = (await fs.stat(path)).size;
      let first = 0, last = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        first = match ? Number(match[1]) : size;
        last = match?.[2] ? Math.min(Number(match[2]), last) : last;
        if (first >= size || last < first) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
          return;
        }
        res.setHeader('Content-Range', `bytes ${first}-${last}/${size}`);
      }
      res.writeHead(req.headers.range ? 206 : 200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': last - first + 1,
        'Content-Type': 'application/octet-stream',
      });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(path, { start: first, end: last });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      res.on('finish', () => hits.set(name, (hits.get(name) || 0) + last - first + 1));
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(404).end();
      else res.destroy();
    }
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const live = [];
  let relaunched;
  try {
    const active = await ps('@(Get-Process -Name BranchNote -ErrorAction SilentlyContinue).Count');
    assert.equal(active, '0', 'Runner already has BranchNote running');
    await ps(`$ErrorActionPreference='Stop'
      $p=Start-Process -FilePath $env:QA_OLD -ArgumentList "/S /D=$env:QA_DEST" -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "Baseline installer exit code: $($p.ExitCode)" }`,
      { QA_OLD: OLD_EXE, QA_DEST: install }, 120000);
    await ps(`$ErrorActionPreference='Stop'
      $v=(Get-Item -LiteralPath $env:QA_EXE).VersionInfo.ProductVersion
      if ($v -notin @('0.2.6','0.2.6.0')) { throw "Wrong baseline: $v" }`,
      { QA_EXE: exe });
    const config = join(install, 'resources', 'app-update.yml');
    const original = await fs.readFile(config, 'utf8');
    assert.match(original, /^provider:\s*github\s*$/m);
    // Change only the disposable old installation's feed routing. Leave the
    // publisher, updater cache and the new installer's size/hash checks intact.
    const feed = original.split(/\r?\n/).filter((line) => !/^(provider|owner|repo|url|useMultipleRangeRequest):/.test(line)).join('\n');
    await fs.writeFile(config, `provider: generic\nurl: http://127.0.0.1:${server.address().port}/\nuseMultipleRangeRequest: false\n${feed}`);
    const old = await openRenderer(exe);
    live.push(old);
    const project = { version: 3, projects: [{ id: 'ci-update', name: title, note: '', color: '#4263dc', archived: false, targets: [] }], branches: [] };
    await old.evaluate(`(async()=>{localStorage.setItem('branchnote-sidebar-width', '${sidebarWidth}'); await window.branchNote.write(${JSON.stringify(JSON.stringify(project))}); return true})()`);
    const loadedOldVersion = await old.evaluate('window.branchNote.getUpdate().then(s=>s.currentVersion)');
    assert.equal(loadedOldVersion, oldVersion);
    await until('v0.2.7 downloaded and install prompt visible', async () => old.evaluate(`(async()=>{
      const state=await window.branchNote.getUpdate();
      return state.status==='downloaded' && state.version==='${version}' &&
        [...document.querySelectorAll('.update-notice button')].some(b=>b.textContent==='重启并安装' && !b.disabled);
    })()`), 180000);
    assert(hits.get('latest.yml') > 0, 'No update metadata served');
    assert(hits.get(installerName) > 0, 'No actual installer bytes served');
    // Click the real renderer control; the test never launches the new installer.
    assert.equal(await old.evaluate(`(()=>{const b=[...document.querySelectorAll('.update-notice button')].find(b=>b.textContent==='重启并安装'&&!b.disabled); if(!b)return false; setTimeout(()=>b.click(),50);return true})()`), true);
    await until('old process exits', () => old.app.exitCode !== null, 60000);
    relaunched = await until('installer automatically reopens v0.2.7', async () =>
      ps(`$ErrorActionPreference='Stop'
        $v=(Get-Item -LiteralPath $env:QA_EXE).VersionInfo.ProductVersion
        if ($v -notin @('0.2.7','0.2.7.0')) { return }
        Get-Process -Name BranchNote -ErrorAction SilentlyContinue |
          Where-Object { $_.Path -eq $env:QA_EXE -and $_.MainWindowHandle -ne 0 } |
          Select-Object -First 1 -ExpandProperty Id`, { QA_EXE: exe }), 120000);
    await ps('Stop-Process -Id ([int]$env:QA_PID) -ErrorAction Stop', { QA_PID: relaunched });
    relaunched = undefined;
    const upgraded = await openRenderer(exe);
    live.push(upgraded);
    const data = await upgraded.evaluate(`(async()=>({
      version:(await window.branchNote.getUpdate()).currentVersion,
      data:JSON.parse(await window.branchNote.read()),
      width:localStorage.getItem('branchnote-sidebar-width'),
      visible:document.body.textContent.includes(${JSON.stringify(title)})
    }))()`);
    assert.equal(data.version, version);
    assert.equal(data.data.projects[0].name, title);
    assert.equal(data.width, sidebarWidth);
    if (!data.visible) await until('seeded project visible after upgrade', () =>
      upgraded.evaluate(`document.body.textContent.includes(${JSON.stringify(title)})`));
    console.log('PASS: real v0.2.6 NSIS in-app download, prompted install, automatic v0.2.7 restart, project/settings persistence');
  } finally {
    for (const entry of live) {
      entry.close();
      if (entry.app.exitCode === null) entry.app.kill();
    }
    if (relaunched) await ps('Stop-Process -Id ([int]$env:QA_PID) -ErrorAction SilentlyContinue', { QA_PID: relaunched });
    server.closeAllConnections();
    server.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
