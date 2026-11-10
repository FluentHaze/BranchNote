# 协作教训

## 下载入口的设备识别

- 错误模式：只检测到 macOS 就把 Apple Silicon 和 Intel 同时标为“当前设备”，混淆系统与芯片架构。
- 原因：未区分操作系统检测和架构检测，并低估了 Client Hints 可提供的能力。
- 预防：使用受支持的 architecture Client Hint 精确匹配；无信息、被拒绝或移动设备不显示架构推荐；不使用被冻结的 Intel User-Agent 字样推断 CPU。验证 arm、x86、无 API、拒绝及 iPad 场景。
