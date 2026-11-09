// 代码托管平台的访问令牌与 MR / PR 创建
// 令牌只存在本机：优先用系统钥匙串（safeStorage）加密，绝不出现在台账、日志或渲染进程里
const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { remoteInfo } = require("./git.cjs");

const PROVIDERS = new Set(["gitlab", "github"]);
const TIMEOUT = 20000;
const filePath = () => path.join(app.getPath("userData"), "hosts.json");

async function readFile() {
  try {
    const data = JSON.parse(await fs.readFile(filePath(), "utf8"));
    if (data && Array.isArray(data.hosts)) return data;
  } catch {
    // 文件不存在或损坏时当作空配置，不影响主流程
  }
  return { version: 1, hosts: [] };
}

async function writeFile(data) {
  const temporary = `${filePath()}.tmp`;
  await fs.mkdir(path.dirname(filePath()), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temporary, filePath());
}

function normalizeHost(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\/+$/, "");
  if (!raw) throw new Error("请填写代码托管平台的域名，例如 gitlab.company.com");
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(raw))
    throw new Error("域名格式不正确，只填域名部分，例如 gitlab.company.com");
  return raw.toLowerCase();
}

function parseAddress(value) {
  const raw = String(value || "").trim();
  const scheme = /^http:\/\//i.test(raw) ? "http" : "https";
  return { host: normalizeHost(raw), scheme };
}

function tokenHint(token) {
  const tail = token.slice(-4);
  return tail ? `••••••${tail}` : "••••••";
}

function encryptToken(token) {
  if (safeStorage.isEncryptionAvailable())
    return {
      encrypted: true,
      value: safeStorage.encryptString(token).toString("base64"),
    };
  // 少数 Linux 桌面没有可用的钥匙串：仍保存，但标记出来由界面提示风险
  return {
    encrypted: false,
    value: Buffer.from(token, "utf8").toString("base64"),
  };
}

function decryptToken(entry) {
  try {
    const buffer = Buffer.from(entry.value, "base64");
    return entry.encrypted ? safeStorage.decryptString(buffer) : buffer.toString("utf8");
  } catch {
    throw new Error("保存的令牌无法解密（可能更换了系统账户或钥匙串），请重新填写");
  }
}

function sanitize(entry) {
  return {
    host: entry.host,
    provider: entry.provider,
    scheme: entry.scheme || "https",
    hint: entry.hint || "••••••",
    encrypted: entry.encrypted !== false,
    updatedAt: entry.updatedAt || "",
  };
}

async function listHosts() {
  const data = await readFile();
  return data.hosts.map(sanitize);
}

async function saveHost({ host, provider, token } = {}) {
  const address = parseAddress(host);
  if (!PROVIDERS.has(provider)) throw new Error("请选择平台类型：GitLab 或 GitHub");
  const value = String(token || "").trim();
  if (!value) throw new Error("请填写访问令牌");
  if (/\s/.test(value)) throw new Error("访问令牌里不应包含空格或换行，请重新复制粘贴");
  const data = await readFile();
  const entry = {
    host: address.host,
    provider,
    scheme: address.scheme,
    hint: tokenHint(value),
    updatedAt: new Date().toISOString(),
    ...encryptToken(value),
  };
  const index = data.hosts.findIndex((item) => item.host === entry.host);
  if (index >= 0) data.hosts[index] = entry;
  else data.hosts.push(entry);
  data.hosts.sort((a, b) => a.host.localeCompare(b.host));
  await writeFile(data);
  return { hosts: data.hosts.map(sanitize), entry: sanitize(entry) };
}

async function removeHost(host) {
  const target = normalizeHost(host);
  const data = await readFile();
  data.hosts = data.hosts.filter((item) => item.host !== target);
  await writeFile(data);
  return data.hosts.map(sanitize);
}

function apiBase(entry) {
  const web = `${entry.scheme || "https"}://${entry.host}`;
  if (entry.provider === "gitlab") return `${web}/api/v4`;
  // github.com 用官方接口域名，企业版走 /api/v3
  return entry.host.toLowerCase() === "github.com"
    ? "https://api.github.com"
    : `${web}/api/v3`;
}

function requestHeaders(entry, token) {
  if (entry.provider === "gitlab")
    return {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "BranchNote",
  };
}

// 统一的网络错误翻译：证书、DNS、超时都要给出可操作的提示
async function request(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (error) {
    if (error?.name === "TimeoutError")
      throw new Error("连接代码托管平台超时，请检查网络或代理设置");
    const code = error?.cause?.code || error?.code || "";
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(String(code) + String(error?.message)))
      throw new Error(
        `无法验证 ${url.split("/")[2]} 的 HTTPS 证书（可能是自签名证书），请先在系统里信任该证书`,
      );
    if (/ENOTFOUND|EAI_AGAIN/i.test(code)) throw new Error("域名解析失败，请检查网络或代理设置");
    if (/ECONNREFUSED/i.test(code)) throw new Error("对方拒绝连接，请确认地址与端口是否正确");
    throw new Error(`连接代码托管平台失败：${code || error?.message || "未知错误"}`);
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body, text };
}

function describeStatus(entry, status, body) {
  const detail =
    (body && (body.message || body.error_description || body.error)) || "";
  if (status === 401) return "访问令牌无效或已过期，请在设置里重新填写";
  if (status === 403)
    return entry.provider === "gitlab"
      ? "令牌权限不足：GitLab 令牌需要勾选 api（或 write_api）权限"
      : "令牌权限不足：classic 令牌需要 repo 权限，fine-grained 令牌需要 Pull requests 读写权限";
  if (status === 404) return "仓库不存在，或令牌无权访问该项目";
  if (status === 400 || status === 422)
    return detail || "请求被拒绝，请检查源分支与目标分支是否都存在";
  return `接口返回 ${status}${detail ? `：${detail}` : ""}`;
}

async function currentUser(entry, token) {
  const result = await request(`${apiBase(entry)}/user`, {
    headers: requestHeaders(entry, token),
  });
  if (!result.ok) throw new Error(describeStatus(entry, result.status, result.body));
  const body = result.body || {};
  return entry.provider === "gitlab" ? body.username || body.name || "" : body.login || "";
}

async function testHost({ host, provider } = {}) {
  const address = parseAddress(host);
  const entry = { host: address.host, provider, scheme: address.scheme };
  if (!PROVIDERS.has(provider)) throw new Error("请选择平台类型：GitLab 或 GitHub");
  const data = await readFile();
  const saved = data.hosts.find((item) => item.host === entry.host);
  if (!saved) throw new Error(`还没有为 ${entry.host} 保存令牌`);
  const token = decryptToken(saved);
  try {
    const account = await currentUser(saved, token);
    return { ok: true, account, message: account ? `连接成功，当前账号 ${account}` : "连接成功" };
  } catch (error) {
    return { ok: false, account: "", message: error.message };
  }
}

async function findExisting(entry, token, info, source, target) {
  if (entry.provider === "gitlab") {
    const project = encodeURIComponent(info.projectPath);
    const query = new URLSearchParams({
      state: "opened",
      source_branch: source,
      target_branch: target,
      per_page: "1",
    });
    const result = await request(
      `${apiBase(entry)}/projects/${project}/merge_requests?${query}`,
      { headers: requestHeaders(entry, token) },
    );
    const list = Array.isArray(result.body) ? result.body : [];
    return list[0] ? { url: list[0].web_url, number: String(list[0].iid) } : null;
  }
  const query = new URLSearchParams({
    state: "open",
    head: `${info.owner}:${source}`,
    base: target,
    per_page: "1",
  });
  const result = await request(
    `${apiBase(entry)}/repos/${info.owner}/${info.repo}/pulls?${query}`,
    { headers: requestHeaders(entry, token) },
  );
  const list = Array.isArray(result.body) ? result.body : [];
  return list[0] ? { url: list[0].html_url, number: String(list[0].number) } : null;
}

// 用接口直接创建 MR / PR；返回结构固定的结果对象，前端据此决定展示按钮还是兜底链接
async function createMergeRequest({
  directory,
  source,
  target,
  title,
  description,
  remote,
} = {}) {
  if (!source || !target)
    return { status: "failed", message: "缺少源分支或目标分支，无法创建合并请求" };
  const data = await readFile();
  let info;
  try {
    // 目标分支所在的远程优先；没有就用配了令牌的域名，避免误选本地裸仓库
    info = await remoteInfo(directory, {
      remote,
      hosts: data.hosts.map((item) => item.host),
    });
  } catch (error) {
    return { status: "failed", message: error.message };
  }
  if (!info)
    return { status: "unsupported", message: "没有找到可识别的远程仓库地址（需要 https 或 ssh 形式）" };

  const saved = data.hosts.find((item) => item.host === info.host.toLowerCase());
  // 设置里显式声明过平台类型时以它为准：自建 GitLab 常用 git.company.com 这类域名
  const provider = saved ? saved.provider : info.provider;
  if (provider === "other")
    return {
      status: "unsupported",
      provider,
      message: `无法识别 ${info.host} 的平台类型，请在「数据与设置」里添加该域名并选择 GitLab 或 GitHub`,
    };
  if (!saved)
    return {
      status: "no-token",
      provider,
      message: `还没有为 ${info.host} 配置访问令牌，配置后可以直接创建${
        provider === "gitlab" ? " MR" : " PR"
      }`,
    };

  const entry = { ...saved, provider, host: info.host.toLowerCase() };
  let token;
  try {
    token = decryptToken(saved);
  } catch (error) {
    return { status: "failed", provider, message: error.message };
  }

  const mrTitle =
    String(title || "").trim() || `${source} → ${target}`;
  const body = String(description || "").trim();

  try {
    if (provider === "gitlab") {
      const project = encodeURIComponent(info.projectPath);
      const result = await request(`${apiBase(entry)}/projects/${project}/merge_requests`, {
        method: "POST",
        headers: requestHeaders(entry, token),
        body: JSON.stringify({
          source_branch: source,
          target_branch: target,
          title: mrTitle,
          description: body,
          remove_source_branch: false,
        }),
      });
      if (result.ok && result.body)
        return {
          status: "created",
          provider,
          url: result.body.web_url || "",
          number: String(result.body.iid || ""),
          message: "合并请求已创建",
        };
      const existing = /already exists|已经存在/i.test(
        `${result.body?.message || ""}${result.text || ""}`,
      )
        ? await findExisting(entry, token, info, source, target).catch(() => null)
        : null;
      if (existing)
        return {
          status: "exists",
          provider,
          url: existing.url,
          number: existing.number,
          message: "该源分支已有打开的合并请求",
        };
      return {
        status: "failed",
        provider,
        message: describeStatus(entry, result.status, result.body),
      };
    }

    const result = await request(
      `${apiBase(entry)}/repos/${info.owner}/${info.repo}/pulls`,
      {
        method: "POST",
        headers: requestHeaders(entry, token),
        body: JSON.stringify({ title: mrTitle, head: source, base: target, body }),
      },
    );
    if (result.ok && result.body)
      return {
        status: "created",
        provider,
        url: result.body.html_url || "",
        number: String(result.body.number || ""),
        message: "Pull Request 已创建",
      };
    const existing = /already exists/i.test(`${result.body?.message || ""}${result.text || ""}`)
      ? await findExisting(entry, token, info, source, target).catch(() => null)
      : null;
    if (existing)
      return {
        status: "exists",
        provider,
        url: existing.url,
        number: existing.number,
        message: "该源分支已有打开的 Pull Request",
      };
    return {
      status: "failed",
      provider,
      message: describeStatus(entry, result.status, result.body),
    };
  } catch (error) {
    return { status: "failed", provider, message: error.message };
  }
}

module.exports = {
  listHosts,
  saveHost,
  removeHost,
  testHost,
  createMergeRequest,
  parseAddress,
  tokenHint,
};
