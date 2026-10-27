# 工作台交互与视觉

2026-10-28，BA7KTC，v0.4.0-beta.1。

服务对象是需要反复整理信道、核对配置和读写电台的人。信道数据占主要空间，所有写入从差异检查进入，而不是把连接、文件和编辑做成互不关联的展示页。

采用工业工具方向：白色 `#FFFFFF` 数据区，`#F4F4F4` 背景，`#161616` 正文，`#6F6F6F` 辅助文字，`#0F62FE` 操作与选中，`#DA1E28` 错误。正文 IBM Plex Sans、中文 Noto Sans SC / sans-serif，频率与编号 IBM Plex Mono；12–14 px 控件和正文，16–19 px 页面标题。

窄侧栏、固定工具栏、紧凑文档信息、42 px 信道行，右侧参数在较窄屏幕改为抽屉。去除首页统计卡片、英文装饰字、仿电台发光屏、绿色铺色和重复帮助文字。文件导出仅提供 DAT 与完整方案；表格保留导入与粘贴。

电台操作为：读取并备份 → 替换/合并/仅配置 → 编辑 → 选择同步范围 → 检查语义变化 → 确认 → 写前重新读取与备份 → 独立写会话 → 完整回读。停止操作和异常均保留重新读取核对的路径，不暗示回滚或原子提交。

42 项整机设置按使用含义分组；A/B 为频率模式入口，C/D 数据按需展开；原始通信记录折叠在排障入口。未知设置保留原始值，不用猜测的控件补齐界面。

参考依据：

- [NN/g：AI Prototyping in Real Design Contexts](https://www.nngroup.com/articles/ai-prototyping/)——将明确任务、真实数据及交互约束用于设计，避免泛化提示带来的同质界面。
- [IBM Carbon：Data table guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)——搜索、筛选放在表格工具栏，批量操作随选中出现，控制行高并按需披露细节。

视觉取舍是本项目对上述原则的应用，不声称存在一套统一的“去 AI 化”标准。
