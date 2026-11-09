import test from "node:test";
import assert from "node:assert/strict";
import {tokenCreationUrl} from "../src/tokenLink.ts";

test("GitLab 自建平台预填 api，保留协议与端口", () => {
  const url = new URL(tokenCreationUrl("http://git.example.com:8080", "gitlab"));
  assert.equal(url.origin, "http://git.example.com:8080");
  assert.equal(url.pathname, "/-/user_settings/personal_access_tokens");
  assert.equal(url.searchParams.get("scopes"), "api");
  assert.equal(url.searchParams.get("name"), "BranchNote");
});
test("GitHub 仅预填 PR 读写权限并设置有效期", () => {
  const url = new URL(tokenCreationUrl("github.com", "github"));
  assert.equal(url.pathname, "/settings/personal-access-tokens/new");
  assert.equal(url.searchParams.get("pull_requests"), "write");
  assert.equal(url.searchParams.get("expires_in"), "30");
  assert.equal(url.searchParams.has("contents"), false);
});
test("缺少域名或地址含账号信息时拒绝打开", () => {
  for (const value of ["", "https://user:pass@example.com", "bad address"])
    assert.throws(() => tokenCreationUrl(value, "gitlab"));
});

test("官方域名纠正默认平台类型，避免 GitHub 套用 GitLab 路径", () => {
  const github = new URL(tokenCreationUrl("https://GITHUB.com/", "gitlab"));
  assert.equal(github.pathname, "/settings/personal-access-tokens/new");
  assert.equal(github.searchParams.get("pull_requests"), "write");
  assert.equal(github.searchParams.has("scopes"), false);
  const gitlab = new URL(tokenCreationUrl("gitlab.com", "github"));
  assert.equal(gitlab.pathname, "/-/user_settings/personal_access_tokens");
  assert.equal(gitlab.searchParams.get("scopes"), "api");
});
