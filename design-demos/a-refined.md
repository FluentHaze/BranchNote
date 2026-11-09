# A 桌面细化实现

已落实到 src/App.tsx、BranchTable.tsx、Sidebar.tsx、TargetBar.tsx、desktop.css。

白色主区、浅灰项目导航、钴蓝动作。移除统计卡与重复说明，功能标题优先，分支名次级。单条通过更多菜单，批量通过底部集中提交栏。

本地字体：Noto Sans SC Variable + JetBrains Mono Variable，随附 OFL 许可证。

最新截图：../docs/e2e/mr-workspace.png、../docs/e2e/mr-selection.png、../docs/e2e/mr-compact.png。1440与900宽桌面验证。不再以移动版为交付目标。

圆角细化：图标与菜单项8px，按钮与输入11px，菜单与轻容器18px，浮动操作栏20px，弹窗24px；选中行12px圆角，减少直角色块带来的突兀感。

后续修正：冷灰背景降低纯白；分支行显示改动备注；隐藏项目区域滚动条；弹窗固定头部、独立滚动内容并锁定背景滚轮；提交前提供令牌配置；远程目标支持搜索与回车选择；令牌表单输入采用一致的非原生边框与高度。
