# operit_mvu Android 真机设计 QA

本轮报告以用户提供的页面参考图和 Android 真机截图为准。当前可见页面的视觉比较以及 LM Studio 结构化输出的预览、应用与持久化真机闭环均已通过，整体交付门禁通过。

## 比较目标

- 视觉真值：`D:/Users/MC07CN/Desktop/前端页面/` 下的六张参考图，以及用户补充的无底框汉堡菜单、记录时间轴和抽屉角色名参考图
- Android 实现：主界面（证据文件：mvu-final-home-reinstalled.png）、字段页（证据文件：mvu-final-fields-no-word-split.png）、记录页（证据文件：mvu-final-records-after-ai.png）、最终抽屉（证据文件：mvu-final-drawer-role-name-reinstalled.png）、AI 预览结果（证据文件：mvu-final-ai-preview-result.png）与AI 应用结果（证据文件：mvu-final-ai-applied-result.png）
- 运行证据：AI 应用 logcat（证据文件：mvu-final-ai-apply-logcat.txt）、最终数据集（证据文件：mvu-final-dataset.json）与最终重装包返回 Operit 主界面（证据文件：mvu-final-back-to-operit-reinstalled.png）
- 比较总览：00-comparison-overview.png（证据文件：mvu-visual-comparisons/00-comparison-overview.png）
- 当前状态：状态总览、字段设置、亲密度详情、变化记录、抽屉上下文和 AI 判断入口

参考图原始像素包括 `1447 × 1087`、`1448 × 1086` 与 `1024 × 1535`。用户补充的记录参考为 `643 × 803`，抽屉角色名参考为 `1256 × 2760`。

## 真机基线与归一化

- Android 设备物理分辨率：`1256 × 2760`
- Android 设备物理密度：`640 dpi`
- 原始真机截图：`1256 × 2760`，包含系统状态栏；视觉判断聚焦于状态栏下方的插件自有内容
- 五张聚焦对照图：`1360 × 1580`；总览图：`1200 × 2050`
- 归一化方法：从参考图中等比裁取对应手机页面，与完整真机内容区域并排；不把参考图的设备外框、状态栏差异或空白边缘计为插件偏差

这些对照用于判断结构、比例、文字层级、图标位置和视觉节奏，不作为逐像素差分。参考图使用演示角色与演示记录，真机侧使用 Operit 当前宿主上下文和真实生成的数据，因此内容数量与数值不同不记为视觉缺陷。

## 全视图与聚焦证据

- 主界面对照（证据文件：mvu-visual-comparisons/01-home-reference-vs-device.png）：顶部菜单、角色信息、状态卡片和常驻底栏
- 字段设置对照（证据文件：mvu-visual-comparisons/02-fields-reference-vs-device.png）：左对齐标题、右侧新建操作、字段卡片和设置态底栏
- 亲密度详情对照（证据文件：mvu-visual-comparisons/03-detail-reference-vs-device.png）：左对齐标题、右侧编辑操作、阶段轨道和保存动作
- 记录页对照（证据文件：mvu-visual-comparisons/04-records-reference-vs-device.png）：筛选区、时间轴、记录图标和记录态底栏
- 抽屉上下文对照（证据文件：mvu-visual-comparisons/05-drawer-context-reference-vs-device.png）：头像、当前角色名、分组菜单和关闭动作

主界面、字段设置和记录页均使用同一无底框三横线入口。带右侧操作的页面标题仍保持左侧锚点，不再因按钮出现而横向漂移。

## 用户指定项目验收

### 底栏

- 状态、设置、记录三项底栏已在状态总览、字段设置、亲密度详情、记录页和 AI 判断页的真机截图中出现
- 选中项只改变语义色和图标填充，三个图标与文字保持同轴居中
- 底栏使用一致的玻璃卡片、圆角和内边距，没有在已捕获页面中缺失或覆盖主要操作

### 抽屉与角色名

- 抽屉头部在头像右侧显示宿主当前角色名 `Operit`
- 第二行固定显示“动态状态 · MVU 角色状态插件”，角色身份与插件说明不再混为一个标题
- 抽屉保留关闭按钮，不包含已经删除的“退出插件”按钮
- 最终重装抽屉截图（证据文件：mvu-final-drawer-role-name-reinstalled.png）已复核头像、角色名和插件说明的层级；最终重装包返回宿主截图（证据文件：mvu-final-back-to-operit-reinstalled.png）确认关闭插件后可正常回到 Operit 主界面
- 抽屉每次打开前重新读取宿主快照，本次 UI 层级同时确认 `Operit头像`、`Operit` 与插件说明；非 `Operit` 角色属于可选的补充数据态截图，不阻塞当前验收

### 字体与排版

- 中文正文使用 `Noto Sans CJK SC`、`Noto Sans SC`、`Microsoft YaHei UI`、`PingFang SC` 与系统无衬线字体栈
- 页面标题、分区标题、卡片标题、正文、辅助文字和微型文字分别采用 `22 / 17 / 16 / 15 / 13 / 12px` 的统一层级
- 标题与卡片名称使用中高字重，正文保持常规字重；真机截图中未出现不同页面字体风格突变
- 记录时间保持单行，时间、圆点和竖线在同一轨道上；卡片图标、标题、说明和变化值的基线关系清晰
- 最终字段页（证据文件：mvu-final-fields-no-word-split.png）中“1 个角色”保持完整；滚动到底截图（证据文件：mvu-final-fields-max-scroll-reinstalled.png）中最后一张“欲望”卡片完整位于固定底栏上方

### 背景、颜色与素材

- 状态、设置、记录、详情、抽屉与 AI 页面均显示同一背景体系，玻璃卡片透明度和蓝紫语义色一致
- 头像和背景均使用真实图片资源；图标使用同一 Material Symbols Rounded 字体资源，没有 emoji 或占位图
- 用户自定义背景在已有真机截图中跨状态、设置、记录和详情页保持一致；恢复默认背景后仍沿用同一页面结构

## 五项必查表面

- 字体与排版：层级、字重、行高和中文回退栈一致；当前截图未见截断或异常换行
- 间距与布局：顶栏、卡片、筛选区、时间轴和底栏形成统一纵向节奏；带功能按钮的标题仍左对齐
- 颜色与 token：蓝紫玻璃背景、粉橙蓝红等状态色和深色正文具有稳定语义
- 图片与素材：背景与头像裁切清晰，未发现拉伸、透明边缘或低清占位素材
- 文案与内容：抽屉角色名来自宿主上下文；页面标题、字段名称、记录来源和状态值均与当前数据一致

## 比较历史

### 早期反馈

- P2：非标题文字整体偏小，不同页面的正文、说明和记录时间缺少统一层级
- P2：标题右侧存在操作按钮时，标题锚点与无按钮页面不一致
- P1：底栏只在部分页面显示，导致主要导航随页面变化
- P1：抽屉头像旁显示插件名，没有显示宿主当前角色名

### 修正与复核

- 建立统一的 `22 / 17 / 16 / 15 / 13 / 12px` 字体层级，并在五组真机对照中复核标题、正文和微型文字
- 所有标题回到左侧锚点；字段设置对照（证据文件：mvu-visual-comparisons/02-fields-reference-vs-device.png）和亲密度详情对照（证据文件：mvu-visual-comparisons/03-detail-reference-vs-device.png）证明右侧操作不会挤动标题
- 底栏统一为状态、设置、记录三项，并在主界面、字段设置、详情、记录和 AI 页面截图中保持同一位置
- 抽屉头部改为宿主角色头像与 `Operit`，复核证据见抽屉上下文对照（证据文件：mvu-visual-comparisons/05-drawer-context-reference-vs-device.png）

当前视觉复核未发现新的 P0、P1 或 P2 项。

## 结构化输出真机闭环

- 模型提供方为 `LMSTUDIO`，测试模型为 `gemma4-12b`
- 请求使用严格 JSON Schema `response_format`，并设置 `reasoning_effort: none`
- 预览结果（证据文件：mvu-final-ai-preview-result.png）在 `6.653s` 内返回亲密度 `+8`、置信度 `0.9`，页面保持“仅预览”状态，且“最近 AI 记录”为空
- 应用结果（证据文件：mvu-final-ai-applied-result.png）在 `4.784s` 内返回并应用同一项变化，亲密度从 `38` 更新为 `46`
- 最终数据集（证据文件：mvu-final-dataset.json）中的持久化字段值为 `46`；对应记录的 `before / after / delta` 为 `38 / 46 / 8`，`source` 为 `ai`，`confidence` 为 `0.9`
- AI 应用 logcat（证据文件：mvu-final-ai-apply-logcat.txt）记录了 HTTP `200`、结构化响应、`38` 到 `46` 的应用过程；日志中未出现 `MVU_AI_RESPONSE_JSON_INVALID`、`Script execution timed out after 15 seconds` 或 `TextEncoder`

预览展示、判断并应用、页面反馈、记录生成和数据持久化已逐一对应，LM Studio 结构化输出链路通过真机验收。

### 最终证据

- AI 预览结果（证据文件：mvu-final-ai-preview-result.png）
- AI 应用结果（证据文件：mvu-final-ai-applied-result.png）
- AI 应用 logcat（证据文件：mvu-final-ai-apply-logcat.txt）
- 最终数据集（证据文件：mvu-final-dataset.json）
- 抽屉角色名（证据文件：mvu-final-drawer-role-name-reinstalled.png）
- 最终重装包返回 Operit 主界面（证据文件：mvu-final-back-to-operit-reinstalled.png）

## Findings

当前五组视觉对照未发现可执行的 P0、P1 或 P2 视觉问题。参考稿与真机在演示数据数量上存在差异，这是使用真实宿主角色、真实字段和真实记录的产品约束，不是版式回退。

LM Studio 结构化预览与应用已完成真机闭环，最终数据、AI 记录和页面结果一致；插件关闭后可正常返回 Operit 主界面。当前没有阻塞交付的问题。

## Implementation Checklist

1. 已完成最新宿主 APK 上的 LM Studio 严格结构化预览
2. 已完成判断并应用，字段值、AI 记录与持久化数据一致
3. 已保存预览、应用、抽屉角色名、返回宿主页面、logcat 与最终数据集证据
4. 已确认最终日志中不存在 15 秒 IPC 超时、结构化 JSON 无效或 `TextEncoder` 错误

## Follow-up Polish

当前没有阻塞视觉交付的 P3 项。切换到非 Operit 角色后的截图可作为额外数据态证据补充。

final result: passed
