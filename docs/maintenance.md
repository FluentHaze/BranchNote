# BranchNote 维护说明

本页仅供源码维护和发行维护使用。普通用户请阅读[安装与使用指南](../README.md)，无需执行这些命令。

## 环境与依赖

使用 Node.js 22.16 或更高版本，并满足当前依赖的引擎要求；本次本地构建使用 Node.js 24.22.1。项目统一使用 pnpm，锁文件为 `pnpm-lock.yaml`。遗留 `package-lock.json` 不作为本页安装依据，不通过 npm 更新它。

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm exec electron .
```

正式打包通过 `scripts/pack.mjs` 执行，沿用启动命令所使用的包管理器；不安装或升级依赖。`start` 脚本仍内嵌 npm 构建调用，可使用上面的显式命令启动。

浏览器预览使用 `pnpm run dev`，只适合页面查看，不能替代桌面 Git、令牌和文件系统流程的验证；浏览器与桌面数据相互独立。

## 验证

```sh
pnpm test
pnpm run build
pnpm run test:mr-ui
```

其他已有检查入口为 `test:e2e`、`test:ui`、`test:stage`。运行前先检查对应脚本的夹具、数据目录及当前流程适用性，不把旧场景的结果作为新流程验收。

MR UI 检查使用模拟平台接口；Git 检查使用临时仓库。它们不能代替真实平台权限、网络、安装包和真实系统窗口的验收。结果记录在[验证记录](validation.md)，操作场景见[使用检查清单](测试流程.md)。

## 打包与发行

```sh
pnpm run pack:win
```

macOS 在对应平台构建：

```sh
pnpm run pack:mac
```

每次正式打包先递增 `package.json` 的补丁版本，再构建界面及主进程，最后生成安装包和更新清单。遗留 `package-lock.json` 只同步根版本号，不通过它更新依赖；pnpm 锁文件没有根版本字段。普通 `build` 和 `test` 不递增版本。构建或打包失败时保留已递增版本，避免复用同一版本分发不同内容。

Windows 产物位于 `release/win/`，macOS 产物位于 `release/mac/`。在 Mac 上执行 `pnpm run pack` 可用同一版本生成双平台产物；分别执行两个平台命令会分别递增版本。打包时不要运行输出目录中的应用，以免文件占用。

已配置 GitHub Releases 应用内更新；Windows 未配置代码签名，Mac 使用本地签名并检查完整性，尚未经过 Apple 公证。发布前需验证实际安装、首次启动、数据保留、权限和平台连接，并在发行说明中明确系统与架构。生成本地产物不代表已经发布。

未经授权不上传安装包、不创建发行版。安装用户只应接触发行包及使用文档，不能把从源码构建作为产品的默认安装方式。

## 资料边界

- [产品说明](../PRD.md)：当前能力和产品边界。
- [字体与许可](../public/fonts/README.md)：随包资源及授权来源。
- 历史验证记录仅说明当时检查，不覆盖当前提交或全部系统。
