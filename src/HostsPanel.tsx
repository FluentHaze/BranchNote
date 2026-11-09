import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import Select from "./Select";
import type { HostCredential } from "./storage";

const PROVIDERS = [
  { value: "gitlab", label: "GitLab" },
  { value: "github", label: "GitHub" },
];

const text = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

// 代码托管令牌：按域名保存，只用于调接口创建 MR / PR
export default function HostsPanel({
  notify,
}: {
  notify(message: string): void;
}) {
  const api = window.branchNote;
  const [hosts, setHosts] = useState<HostCredential[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [host, setHost] = useState("");
  const [provider, setProvider] = useState<"gitlab" | "github">("gitlab");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!api?.listHosts) {
      setLoaded(true);
      return;
    }
    let active = true;
    api
      .listHosts()
      .then((list) => active && setHosts(list))
      .catch((reason) => active && setError(text(reason)))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [api]);

  async function save() {
    if (!api?.saveHost) return;
    setError("");
    if (!host.trim()) {
      setError("请填写代码托管平台的域名，例如 gitlab.company.com");
      return;
    }
    if (!token.trim()) {
      setError("请填写访问令牌");
      return;
    }
    setBusy("save");
    try {
      const result = await api.saveHost({
        host: host.trim(),
        provider,
        token: token.trim(),
      });
      setHosts(result.hosts);
      setToken("");
      setHost("");
      notify(`已保存 ${result.entry.host} 的令牌`);
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy("");
    }
  }

  async function test(entry: HostCredential) {
    if (!api?.testHost) return;
    setBusy(`test:${entry.host}`);
    setFeedback((prev) => ({ ...prev, [entry.host]: "正在连接…" }));
    try {
      const result = await api.testHost({
        host: entry.host,
        provider: entry.provider,
      });
      setFeedback((prev) => ({ ...prev, [entry.host]: result.message }));
    } catch (reason) {
      setFeedback((prev) => ({ ...prev, [entry.host]: text(reason) }));
    } finally {
      setBusy("");
    }
  }

  async function remove(entry: HostCredential) {
    if (!api?.removeHost) return;
    setBusy(`remove:${entry.host}`);
    setError("");
    try {
      setHosts(await api.removeHost(entry.host));
      setConfirming("");
      notify(`已删除 ${entry.host} 的令牌`);
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy("");
    }
  }

  const plain = hosts.filter((entry) => !entry.encrypted);

  return (
    <section className="settings-panel">
      <h2>代码托管令牌</h2>
      <p className="settings-copy">
        配置后，受保护分支在提交完成时会直接调用接口创建 MR / PR，不用再手填网页表单。
        令牌按域名保存，用系统钥匙串加密，只留在本机，不会写进台账或导出的备份里。
      </p>

      {!api?.listHosts && (
        <p className="settings-copy">
          浏览器预览版无法保存令牌，请使用桌面版配置。
        </p>
      )}

      {loaded && hosts.length > 0 && (
        <div className="host-list">
          {hosts.map((entry) => (
            <div className="host-item" key={entry.host}>
              <div className="host-item-main">
                <span
                  className={`tag ${entry.provider === "gitlab" ? "orange" : "blue"}`}
                >
                  {entry.provider === "gitlab" ? "GitLab" : "GitHub"}
                </span>
                <code>{entry.host}</code>
                <span className="host-token">
                  <KeyRound size={13} />
                  {entry.hint}
                </span>
                {!entry.encrypted && (
                  <span className="host-flag">未加密存储</span>
                )}
              </div>
              <div className="host-item-actions">
                {feedback[entry.host] && (
                  <span className="host-feedback">{feedback[entry.host]}</span>
                )}
                <button
                  className="secondary compact"
                  disabled={!!busy}
                  onClick={() => void test(entry)}
                >
                  {busy === `test:${entry.host}` ? "测试中…" : "测试连接"}
                </button>
                {confirming === entry.host ? (
                  <>
                    <button
                      className="danger-button compact"
                      disabled={!!busy}
                      onClick={() => void remove(entry)}
                    >
                      <Trash2 size={14} />
                      确认删除
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirming("")}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className="icon-button"
                    title="删除这条令牌"
                    aria-label={`删除 ${entry.host} 的令牌`}
                    disabled={!!busy}
                    onClick={() => setConfirming(entry.host)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {loaded && hosts.length === 0 && (
        <p className="settings-copy host-empty">
          <ShieldCheck size={15} />
          还没有配置令牌。不配置也能用：提交完成后会打开预填好的 MR 创建页。
        </p>
      )}

      {plain.length > 0 && (
        <p className="host-warning">
          这台电脑的系统钥匙串不可用，{plain.map((entry) => entry.host).join("、")}
          的令牌以明文保存在应用数据目录，请注意设备安全。
        </p>
      )}

      {api?.saveHost && (
        <>
          <div className="host-form">
            <label className="host-field">
              <span>平台地址</span>
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="gitlab.company.com"
                spellCheck={false}
                aria-label="平台地址"
              />
            </label>
            <label className="host-field host-field-provider">
              <span>平台类型</span>
              <Select
                label="平台类型"
                options={PROVIDERS}
                value={provider}
                onChange={(value) =>
                  setProvider(value as "gitlab" | "github")
                }
              />
            </label>
            <label className="host-field host-field-token">
              <span>访问令牌</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="粘贴 Personal Access Token"
                autoComplete="off"
                spellCheck={false}
                aria-label="访问令牌"
              />
            </label>
            <button
              className="primary compact host-save"
              disabled={!!busy}
              onClick={() => void save()}
            >
              {busy === "save" ? "保存中…" : "保存令牌"}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <p className="settings-copy">
            {provider === "gitlab"
              ? "GitLab：右上角头像 → Preferences → Access Tokens，勾选 api（或 write_api）权限。自建 GitLab 填它自己的域名，接口会按该域名调用。"
              : "GitHub：Settings → Developer settings → Personal access tokens。classic 勾 repo；fine-grained 需 Pull requests 读写权限。GitHub Enterprise 填企业域名即可。"}
          </p>
        </>
      )}
    </section>
  );
}
