# BranchNote 官网

基于用户确认的 A 方案，使用 Astro + React + TypeScript 实现。Astro 生成静态内容，MR 演示在首屏加载，状态展示在进入视口后加载 React。网站与根目录的 Electron 桌面应用分别安装和构建。

## 本地运行

需要 Node.js 22.23.4 或更新版本。

```powershell
cd website
npm install
npm run dev
```

打开 http://127.0.0.1:5192/ 。

```powershell
npm run check
npm run build
npm run preview
```

构建产物位于 `website/dist/`，可部署到支持目录索引的静态托管服务。当前未部署。

## 页面与交互

- `/`：简体中文首页；各语言的固定地址分别为 `/zh-CN/`、`/zh-TW/`、`/en/`、`/ja/`、`/ko/`。
- 每个语言页面在构建时生成独立的正文、标题、描述、`lang` 和语言替代链接。语言切换保留当前锚点。
- 主视觉可选分支、选择目标、编辑标题，并演示预检、推送、MR 创建和等待平台审核的流程。演示不调用真实 Git 或代码托管 API。
- 下载按钮按本轮要求保留外观并禁用，不跳转、不下载；接入时修改 `DownloadButtons.astro` 即可。
- 下载区在浏览器识别 Windows / macOS，首屏与底部都会把匹配平台放在首位并高亮，显示五语言“当前设备”标记。移动设备与其他平台不预选桌面安装包。
- 页签采用无描边的分段选择样式，通过实色底、文字与勾选标记区分选中态。总览图与右侧列表共用 `status-demo.ts` 的分支状态；目标视图按测试／发布目标同步更新图和列表；预检视图显示源分支、目标及独立检查流程。
- 语言、MR 目标和图表目标均使用同一个自定义 Select 组件。组件沿用桌面应用的 Popover / Listbox 交互模式，支持方向键、Home / End、Enter、Esc、点击外部关闭以及滚动时收起。
- 真实应用截图使用演示数据，保留中文界面，明确标注。Astro 自动生成 WebP 与响应式尺寸。
- 页面统一使用自托管的 `Branch Sans` 字体族，包括 Noto Sans SC 的 WOFF2 子集和补齐韩文字形的 Noto Sans KR 子集，许可在 `src/assets/FONT-LICENSE.txt` 和 `FONT-KR-LICENSE.txt`。正文、分支名、按钮和弹出菜单不再指定系统字体或单独的等宽字体。图标使用 SVG。新增文案时需扩充本地字集，确保继续覆盖全部字符。

发布时可通过环境变量 `SITE_URL` 配置实际域名，生成绝对 canonical 和语言链接；未设置时不会填入虚构域名。示例见 `.env.example`。

## 代码结构

```text
src/
  assets/       字体子集、字体许可、真实应用截图
  components/   Astro 页面区块和 React 交互组件
  i18n/         语言类型、路由配置和五套文案
  layouts/      页面元数据、导航和页脚
  pages/        默认首页及各语言静态路由
  styles/       基础样式、A 方案布局、MR 演示及网站适配
public/
  logo.svg
  robots.txt
```

网站不依赖已删除的 `design-demos`、桌面应用开发服务器或任何外部图像、字体 CDN。根目录业务代码与依赖未因官网修改。

## 本轮验证

- `npm run build`：包含 Astro / TypeScript 检查与生产构建。
- 在生产预览中验证五语言 × 桌面 1440 / 平板 768 / 手机 375 共 15 种布局。
- 验证 MR 提交流程、空选择与空标题禁用、编辑标题保留、单分支、重复体验、键盘 Tab 导航、FAQ、语言跳转、图片加载与无 JavaScript 时的静态内容。
- 自定义菜单验证鼠标选择、方向键、Home / End、Enter、Esc、目标切换与语言路由。图表验证三个页签的独立内容、共用状态数据和目标联动。字体检查覆盖当前全部文字的字形，并在浏览器核对五种语言实际渲染使用自托管字库。

旧版三方案、历史截图、生成与截图脚本均已清理，不作为官网运行依赖。
