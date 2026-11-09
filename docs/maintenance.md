# BranchNote 维护说明

本页仅供源码维护和发行维护使用。普通用户请阅读[安装与使用指南](../README.md)，无需执行这些命令。

## 环境与依赖

使用 Node.js 22.16 或更高版本，并满足当前依赖的引擎要求；本次本地构建使用 Node.js 24.22.1。项目统一使用 pnpm，锁文件为 `pnpm-lock.yaml`。遗留 `package-lock.json` 不作为本页安装依据，不通过 npm 更新它。

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm exec electron .
```

当前 `start`、`pack:win`、`pack:mac` 脚本仍内嵌 npm 调用，本次文档更新未改脚本。使用下方显式 pnpm 命令启动和打包，避免混用包管理器。

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
pnpm run build
pnpm exec electron-builder --win nsis
```

macOS 在对应平台构建：

```sh
pnpm run build
pnpm exec electron-builder --mac dmg
```

产物输出到 `release/`。当前未配置签名、公证或自动更新。发布前需验证实际安装、首次启动、数据保留、权限和平台连接，并在发行说明中明确系统与架构。生成本地产物不代表已经发布。

未经授权不上传安装包、不创建发行版。安装用户只应接触发行包及使用文档，不能把从源码构建作为产品的默认安装方式。

## 资料边界

- [产品说明](../PRD.md)：当前能力和产品边界。
- [字体与许可](../public/fonts/README.md)：随包资源及授权来源。
- 历史验证记录仅说明当时检查，不覆盖当前提交或全部系统。
