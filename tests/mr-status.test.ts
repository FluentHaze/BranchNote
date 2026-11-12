import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import type {MRMetadata, MROptions} from "../src/storage";

const script = readFileSync(new URL("../electron/hosts.cjs", import.meta.url), "utf8");
function fixture(provider = "gitlab", route?: (url: string, options: RequestInit) => unknown) {
  const calls: {url: string; options: RequestInit}[] = [];
  let response: unknown = {state: "closed"};
  let status = 200;
  const module = {exports: {} as {
    syncMergeRequests(urls: string[]): Promise<{url: string; state?: string; error?: string; mergedAt?: string}[]>;
    createMergeRequest(options: {directory: string; source: string; target: string; removeSourceBranch?: boolean; metadata?: MRMetadata}): Promise<{status: string; configurationWarning?: string; url?: string}>;
    mergeRequestOptions(directory: string, remote: string): Promise<MROptions>;
    requestProvider(directory: string, remote: string): Promise<string>;
  }};
  vm.runInNewContext(script, {
    module, URL, URLSearchParams, AbortSignal, Buffer,
    require(name: string) {
      if (name === "electron") return {app: {getPath: () => "/fixture"}, safeStorage: {}};
      if (name === "node:fs/promises") return {readFile: async () => JSON.stringify({hosts: [{
        host: "code.example.com", provider, scheme: "https", encrypted: false, value: Buffer.from("secret").toString("base64"),
      }]})};
      if (name === "node:path") return {join: (...parts: string[]) => parts.join("/")};
      if (name === "./git.cjs") return {remoteInfo: async () => ({host: "code.example.com", provider, projectPath: "team/repo", owner: "team", repo: "repo"})};
      throw new Error(name);
    },
    fetch: async (url: string, options: RequestInit) => {
      calls.push({url, options});
      return {ok: status === 200, status, text: async () => JSON.stringify(route ? route(url, options) : response)};
    },
  });
  return {api: module.exports, calls, respond: (body: typeof response, code = 200) => {response = body; status = code;}};
}

test("GitLab 创建 MR 按选择传递合并后删除源分支选项，默认保留", async () => {
  const f = fixture();
  f.respond({web_url: "https://code.example.com/team/repo/-/merge_requests/1", iid: 1});
  for (const removeSourceBranch of [undefined, true, false]) {
    const result = await f.api.createMergeRequest({directory: "/fixture", source: "mr/batch", target: "main", removeSourceBranch});
    assert.equal(result.status, "created");
    const body = JSON.parse(String(f.calls.at(-1)!.options.body));
    assert.equal(body.remove_source_branch, removeSourceBranch === true);
  }
});

test("GitLab 提交指派人、审核者、里程碑和多个标签，未选时省略字段", async () => {
  const f = fixture();
  f.respond({web_url: "https://code.example.com/team/repo/-/merge_requests/1", iid: 1});
  await f.api.createMergeRequest({directory: "/fixture", source: "mr/batch", target: "main",
    metadata: {assigneeId: 1, reviewerId: 2, milestoneId: 3, labels: ["bug", "frontend"]}});
  const body = JSON.parse(String(f.calls.at(-1)!.options.body));
  assert.equal(body.assignee_id, 1);
  assert.deepEqual(body.reviewer_ids, [2]);
  assert.equal(body.milestone_id, 3);
  assert.equal(body.labels, "bug,frontend");
  await f.api.createMergeRequest({directory: "/fixture", source: "mr/batch", target: "main"});
  const empty = JSON.parse(String(f.calls.at(-1)!.options.body));
  for (const key of ["assignee_id", "reviewer_ids", "milestone_id", "labels"]) assert.equal(key in empty, false);
});

test("GitLab MR 选项读取分页成员、里程碑、标签和当前用户", async () => {
  const f = fixture("gitlab", url => {
    if (url.includes("/members/all")) return url.includes("page=2") ? [] : Array.from({length: 100}, (_, i) => ({id: i + 1, name: "Member", username: "user" + i, state: i ? "active" : "blocked"}));
    if (url.includes("/milestones")) return [{id: 20, title: "v1"}];
    if (url.includes("/labels")) return [{id: 30, name: "bug"}];
    return {id: 2, name: "Me"};
  });
  const options = await f.api.mergeRequestOptions("/fixture", "origin");
  assert.equal(options.members.length, 99);
  assert.equal(options.currentUser.id, 2);
  assert.equal(options.milestones[0].name, "v1");
  assert.equal(options.labels[0].name, "bug");
  assert.ok(f.calls.some(call => call.url.includes("members/all?per_page=100&page=2")));
  f.respond({}, 403);
  await assert.rejects(f.api.mergeRequestOptions("/fixture", "origin"), /权限/);
});

test("GitHub PR 读取可指派成员、审核者、里程碑编号和仓库删除分支设置", async () => {
  const f = fixture("github", url => {
    if (url.includes("/assignees") || url.includes("/collaborators")) return [{id: 1, login: "me"}, {id: 2, login: "reviewer"}];
    if (url.includes("/milestones")) return [{id: 999, number: 3, title: "v1"}];
    if (url.includes("/labels")) return [{id: 4, name: "bug"}];
    if (url.endsWith("/user")) return {id: 1, login: "me"};
    return {delete_branch_on_merge: true};
  });
  assert.equal(await f.api.requestProvider("/fixture", "origin"), "github");
  const result = await f.api.mergeRequestOptions("/fixture", "origin");
  assert.equal(result.provider, "github");
  assert.equal(result.members[0].login, "me");
  assert.equal(result.reviewers?.length, 1);
  assert.equal(result.reviewers?.[0].login, "reviewer");
  assert.equal(result.milestones[0].id, 3);
  assert.equal(result.deleteBranchOnMerge, true);
});

test("GitHub 创建 PR 后分别保存配置并请求审核，不发送 GitLab 参数", async () => {
  const f = fixture("github", () => ({html_url: "https://code.example.com/team/repo/pull/42", number: 42}));
  const result = await f.api.createMergeRequest({directory: "/fixture", source: "mr/batch", target: "main", removeSourceBranch: true,
    metadata: {assigneeId: 1, assigneeLogin: "me", reviewerId: 2, reviewerLogin: "reviewer", milestoneId: 3, labels: ["bug", "frontend"]}});
  assert.equal(result.status, "created");
  const bodies = f.calls.map(call => JSON.parse(String(call.options.body)));
  assert.equal(f.calls[0].url, "https://code.example.com/api/v3/repos/team/repo/pulls");
  assert.equal(bodies[0].remove_source_branch, undefined);
  assert.equal(f.calls[1].options.method, "PATCH");
  assert.deepEqual(bodies[1], {assignees: ["me"], milestone: 3, labels: ["bug", "frontend"]});
  assert.deepEqual(bodies[2], {reviewers: ["reviewer"]});
});

test("GitHub PR 创建成功后配置失败仍返回 PR 地址和可重试提示", async () => {
  const f = fixture("github", url => {
    if (url.includes("/issues/")) throw new Error("update failed");
    return {html_url: "https://code.example.com/team/repo/pull/42", number: 42};
  });
  const result = await f.api.createMergeRequest({directory: "/fixture", source: "mr/batch", target: "main", metadata: {labels: ["bug"]}});
  assert.equal(result.status, "created");
  assert.ok(result.url?.endsWith("/pull/42"));
  assert.match(result.configurationWarning!, /部分配置未保存/);
});

test("GitHub 重试已存在的 PR 时补充配置，不创建第二条记录", async () => {
  const f = fixture("github", (url, options) => {
    if (url.endsWith("/pulls") && options.method === "POST") {
      f.respond({}, 200);
      return {message: "A pull request already exists"};
    }
    if (url.includes("/pulls?")) return [{html_url: "https://code.example.com/team/repo/pull/42", number: 42}];
    return {};
  });
  f.respond({}, 422);
  const result = await f.api.createMergeRequest({directory: "/fixture", source: "mr/batch", target: "main", metadata: {labels: ["bug"]}});
  assert.equal(result.status, "exists");
  assert.equal(result.configurationWarning, "");
  assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1);
  assert.ok(f.calls.some(call => call.url.endsWith("/issues/42") && call.options.method === "PATCH"));
});
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
