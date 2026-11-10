# BranchNote 官网

用户入口：https://fluenthaze.github.io/BranchNote/

官网提供产品介绍、五语言页面、macOS 下载安装入口、MR 交互演示，以及 Git 冲突处理的交互流程图和详细指南。交互演示不操作真实仓库。

## 用户资源

- `v0.2.5` 下载链接指向 GitHub Releases，明确区分 Apple Silicon 和 Intel；Windows 安装包未提供时保持禁用并展示说明。
- 支持 Client Hints 的浏览器通过 architecture 识别 Apple Silicon / Intel，仅高亮对应架构；Safari 等未提供信息或拒绝请求时不猜测，两种架构仍可手动下载。识别在本机完成，不上传设备信息。
- `/workflow/` 为详细 Git 指南，正文复用项目 `docs/git-workflow.md`。
- `/workflow/git-flow.html` 是 Archify 生成的独立交互图，支持主题切换和导出。目前图与详细指南为简体中文，其他语言页面明确标注。
- 安装包不存入 Pages；更新清单和安装包由 GitHub Releases 提供。

## 维护与本地验证

沿用 Astro + React + TypeScript，静态生成页面，交互部分采用 React islands。需要 Node.js 24，统一使用 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run preview
```

默认子路径为 `/BranchNote/`。预览地址为 `http://127.0.0.1:5192/BranchNote/`。可通过 `SITE_URL` 配置公开站点 origin，使用 `SITE_BASE_PATH` 配置部署子路径，见 `.env.example`。语言链接、logo、资源及 canonical 均需保留该前缀。

`pnpm-lock.yaml` 是当前安装依据；遗留 npm 锁文件不用于本流程。`.npmrc` 只将 Astro 预渲染生成文件按裸包名导入的 `cookie` 和 `picomatch` 暴露在官网依赖目录，避免误解析到上级目录的旧版本。

## Pages 部署

`.github/workflows/pages.yml` 在 `main` 的官网、Git 指南或部署配置变化时构建，也可手动触发。流程使用官网独立锁文件安装，执行 Astro / TypeScript 检查和构建，然后上传官方 Pages artifact 并部署。

仓库 Settings → Pages 的构建来源应为 GitHub Actions。部署结果以 Actions 和实际线上页面为准，不以本地构建成功代替。

## 资源维护

字体随站点提供，不请求字体 CDN；许可见 `src/assets/FONT-LICENSE.txt` 和 `FONT-KR-LICENSE.txt`。新增中日韩文案需要同步扩充字集；保持 `local-fonts.css` 的韩文字形范围一致。

流程图为独立 HTML；若 Git 行为变更，应重新核对源码并用 Archify 生成和验证，不能仅改图中文字。官网内容调整不意味着桌面应用已经重新打包。
