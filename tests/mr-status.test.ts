import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../electron/hosts.cjs", import.meta.url), "utf8");
function fixture(provider = "gitlab") {
  const calls: {url: string; options: RequestInit}[] = [];
  let response: {state?: string; merged_at?: string | null} = {state: "closed"};
  let status = 200;
  const module = {exports: {} as {syncMergeRequests(urls: string[]): Promise<{url: string; state?: string; error?: string; mergedAt?: string}[]>}};
  vm.runInNewContext(script, {
    module, URL, URLSearchParams, AbortSignal, Buffer,
    require(name: string) {
      if (name === "electron") return {app: {getPath: () => "/fixture"}, safeStorage: {}};
      if (name === "node:fs/promises") return {readFile: async () => JSON.stringify({hosts: [{
        host: "code.example.com", provider, scheme: "https", encrypted: false, value: Buffer.from("secret").toString("base64"),
      }]})};
      if (name === "node:path") return {join: (...parts: string[]) => parts.join("/")};
      if (name === "./git.cjs") return {};
      throw new Error(name);
    },
    fetch: async (url: string, options: RequestInit) => {
      calls.push({url, options});
      return {ok: status === 200, status, text: async () => JSON.stringify(response)};
    },
  });
  return {api: module.exports, calls, respond: (body: typeof response, code = 200) => {response = body; status = code;}};
}
test("GitLab 关闭、重新打开、合并与批量去重", async () => {
  const f = fixture();
  const url = "https://code.example.com/team/sub/repo/-/merge_requests/138";
  assert.equal((await f.api.syncMergeRequests([url, url])).length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://code.example.com/api/v4/projects/team%2Fsub%2Frepo/merge_requests/138");
  assert.equal(f.calls[0].options.redirect, "error");
  assert.equal((await f.api.syncMergeRequests([url]))[0].state, "closed");
  f.respond({state: "opened"});
  assert.equal((await f.api.syncMergeRequests([url]))[0].state, "opened");
  f.respond({state: "merged", merged_at: "2026-11-09T01:00:00Z"});
  assert.equal((await f.api.syncMergeRequests([url]))[0].mergedAt, "2026-11-09T01:00:00Z");
});
test("GitHub 区分关闭与合并，企业版走正确接口", async () => {
  const f = fixture("github");
  const url = "https://code.example.com/team/repo/pull/42";
  assert.equal((await f.api.syncMergeRequests([url]))[0].state, "closed");
  assert.equal(f.calls[0].url, "https://code.example.com/api/v3/repos/team/repo/pulls/42");
  f.respond({state: "closed", merged_at: "2026-11-09T01:00:00Z"});
  assert.equal((await f.api.syncMergeRequests([url]))[0].state, "merged");
});
test("鉴权失败、未知状态、非法链接不伪造关闭状态或泄露令牌", async () => {
  const f = fixture();
  const url = "https://code.example.com/team/repo/-/merge_requests/1";
  f.respond({}, 401);
  const result = (await f.api.syncMergeRequests([url]))[0];
  assert.match(result.error!, /令牌/);
  assert.equal(result.state, undefined);
  f.respond({state: "unexpected"});
  assert.match((await f.api.syncMergeRequests([url]))[0].error!, /无法识别/);
  const count = f.calls.length;
  assert.ok((await f.api.syncMergeRequests(["https://untrusted.example/team/repo/-/merge_requests/1"]))[0].error);
  assert.equal(f.calls.length, count);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
