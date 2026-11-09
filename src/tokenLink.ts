export function providerForHost(address: string, fallback: "gitlab" | "github"): "gitlab" | "github" {
  const host = address.trim().replace(/^https?:\/\//i, "").split(/[/:?#]/)[0].toLowerCase();
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  return fallback;
}

export function tokenCreationUrl(address: string, provider: "gitlab" | "github"): string {
  provider = providerForHost(address, provider);
  const raw = address.trim();
  if (!raw) throw new Error("请先填写平台地址");
  let base: URL;
  try {
    base = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    throw new Error("平台地址格式不正确");
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password ||
      !/^[a-z0-9.-]+$/i.test(base.hostname))
    throw new Error("平台地址格式不正确");
  const url = new URL(provider === "gitlab"
    ? "/-/user_settings/personal_access_tokens"
    : "/settings/personal-access-tokens/new", base.origin);
  url.searchParams.set("name", "BranchNote");
  if (provider === "gitlab") url.searchParams.set("scopes", "api");
  else {
    url.searchParams.set("description", "BranchNote MR / PR");
    url.searchParams.set("pull_requests", "write");
    url.searchParams.set("expires_in", "30");
  }
  return url.toString();
}
