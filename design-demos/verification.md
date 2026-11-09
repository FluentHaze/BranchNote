# 原型验证

三方向均使用项目现有 Electron/Chromium 实际渲染，桌面 1440×900，移动 375×812。首屏、整页、移动提交抽屉截图均已生成并检查。

自动验证通过：分支筛选、勾选、模拟创建 MR 后状态更新、移动无横向溢出、无未捕获控制台错误。原型不访问本地 Git 或真实平台。

Python design_lint check/compare 因没有 Python Playwright 跳过，使用真实截图肉眼比较三版骨架与配色。ref_board 对 Linear 同样未完成；Things 官方截图已检查。

现有 React/Electron 源码没有在本轮改动，等待用户选择后再实现。此前未提交的改动全部保留。
