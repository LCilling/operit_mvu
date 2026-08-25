# operit_mvu

`operit_mvu` 是面向 [OperitAI](https://github.com/AAswordman/Operit) 的动态角色状态 ToolPkg，也是 [Issue #998](https://github.com/AAswordman/Operit/issues/998) 的完整插件实现。3.0.0 将字段、完整条件库、角色绑定规则、可复用效果组、变化记录与 AI 判断封装在单一 `operit_mvu-3.0.0.toolpkg` 中。

插件标识为 `com.lcilling.operit_mvu`。权威数据使用严格的 `formatVersion: 3` 契约；已有 v2 数据会在保留原文件的前提下迁移，迁移失败时进入可重试的 v2 兼容模式，不会静默覆盖原数据。

## 功能

- 为角色独立、群组共享、全局共享或当前会话创建数值字段，并自定义每个字段的上下限、阶段、图标、主题色和模型可见性。
- 当前会话字段默认自动绑定正在打开的聊天；多聊天管理折叠在高级绑定中。角色、群组和聊天始终显示宿主提供的可读名称，ID 只作为辅助信息。
- 字段列表每页 5 条；规则列表每页 5 条；条件库和效果组每页 10 条。字段、角色、群组、条件和效果组等大集合统一通过带搜索与结果统计的选择框处理，不把全部项目塞进页面。
- 完整条件库支持 14 类谓词、递归 `AND`/`OR`/`NOT`、AI 语义条件、创建、查看、修改、复制、启停、删除和引用保护。
- 规则把“触发角色”“触发条件”和“触发后改变的字段内容”明确分离。一个规则可绑定当前角色、指定角色或群组，并产生多个字段变化或激活多个效果组。
- 临时效果以可命名的效果组复用。每个效果组按字段组织，可为字段选择触发角色、全部已绑定角色或指定角色，并组合即时增量、固定修正、正向倍率、负向倍率和全量倍率。
- 效果原因可直接选择规则、自然变化、每轮变化、AI、手动等模板，也可输入自定义原因并预览；激活时保存原因快照。时长支持永久、截止时间、剩余轮次或手动结束。
- 使用 Operit 当前系统模型执行一次有界的严格 JSON Schema 判断；模型字段预算最多 40 条，并在高级页显示“本轮使用 X / 共 Y 个字段”。
- 状态页支持角色状态/群组状态切换、真实 `content://` 头像、阶段与趋势、变化记录筛选。分段历史记录可扩展到大数据量而不一次载入。
- 四个稳定入口为“状态、配置、规则、高级”。根页面使用三横线，子页面使用无底色返回箭头；分段切换带平滑动画并尊重系统减少动态效果设置。
- 插件字体使用 OperitAI 一致的系统字族、常规/中等字重和正常字号，不通过缩小文字挤压移动端布局。

## 导入、导出与恢复

字段模板与完整备份是两种不同用途：

- 字段模板位于“配置 → 字段”。默认导出字段定义、上下限、阶段和专属自动配置；用户可显式选择是否携带各角色或群组的当前值。导入先显示预览、冲突策略和角色/群组映射，每个目标都可决定是否启用以及采用文件值、保留本地值或初始化值。
- 完整备份位于“高级 → 导入与导出”。它包含 v3 配置、规则、条件、效果组、运行实例与全部记录。恢复前显示来源版本、数量、校验摘要、迁移警告和“替换全部当前数据”的确认；恢复使用 revision 校验和原子提交，失败不会留下半恢复状态。

字段模板不会静默导入规则、条件或效果组，只记录未携带依赖；完整备份不会与当前数据模糊合并。所有可能包含大量角色、群组或字段的映射入口都使用可搜索选择框。

## 安装与 APK 依赖

Release 只发布一个 ToolPkg，不发布插件 APK：

1. 下载 [Releases](https://github.com/LCilling/operit_mvu/releases) 中的 `operit_mvu-3.0.0.toolpkg`。
2. 把文件复制到手机可访问的位置。
3. 在 Operit 的“包管理”中选择“导入”，只选择该 ToolPkg。
4. 启用“动态状态”，然后从 Operit 主侧边栏的插件区域打开。

插件仅调用 Operit 官方 ToolPkg 接口和 [docs/OPERITAI_CHANGES.md](docs/OPERITAI_CHANGES.md) 明确登记的宿主扩展，主要包括：

- `ToolPkg.chatContext.snapshot({ chatId? | groupId? })` 与权威角色/群组目录；
- 带稳定消息、变体和角色身份的 `message_persisted`；
- `ToolPkg.systemModel.probe()` 与 `ToolPkg.systemModel.complete({ systemPrompt, userPrompt, jsonSchema? })`；
- 普通聊天 Prompt Hook、main/UI IPC、宿主顶栏和受控 `content://` 资源读取；
- `Tools.Files.replaceAtomically(source, destination)`，用于配置和记录的同目录 Android 本地原子提交。

插件不调用 `ToolPkg.localModels`，也不依赖未登记的 `prepareDispatch`、`dispatchToken` 或 `maxOutputChars` 参数。发布检查会扫描源码、类型和构建产物，发现官方接口或文档扩展以外的宿主调用时直接失败。

如果 Operit 官方版本已经实现上述扩展，只安装 ToolPkg 即可。旧版 Operit 缺少这些接口时，需要先安装一次包含这些宿主接口的 Operit 版本；之后更新插件只替换同一 ToolPkg。插件不打入 APK，也不需要辅助 APK、第二个接口包或独立前端目录。

插件页面不绘制专用退出按钮。离开页面使用 Android 返回手势、系统返回键或 Operit 自身导航。具体宿主改动见 [docs/OPERITAI_CHANGES.md](docs/OPERITAI_CHANGES.md)，精确接口契约见 [docs/HOST_INTERFACE_REQUIREMENTS.md](docs/HOST_INTERFACE_REQUIREMENTS.md)。

## 数据与安全

v3 主配置、事务日志和分段记录保存在 ToolPkg 私有配置目录。消息幂等键由宿主持久化结果中的 `chatId`、`messageId` 和 `variantId` 组成。角色卡、角色组、当前聊天、头像和系统模型均以宿主返回的权威事实为准；缺失或歧义身份会明确失败或跳过，不按名称首项猜测。

AI 返回文本会经过完整 `JSON.parse`、严格键集合、目标字段授权、置信度、字段预算和单次幅度校验，全部通过后才允许提交状态事务。配置与记录先写同目录临时文件，再通过已登记的宿主原子替换接口发布；宿主不支持原子移动时明确失败，不降级为复制后删除。

## 源码结构

```text
src/main.ts                 ToolPkg 注册、宿主事件与状态同步
src/mvu/core/               MagVarUpdate 兼容核心
src/mvu/port/               Operit 安全移植层
src/mvu/app/                v3 状态、事务、条件、规则、效果与记录
src/shared/ipc.ts           main runtime 与页面的类型化 IPC
src/ui/web_container/       Compose DSL WebView 容器
static/app_ui/              移动端生产界面
scripts/                    接口/UI/产物审计、构建与打包
docs/                       API、移植、设计与宿主接口说明
third_party/                上游版本、补丁边界与许可证
```

上游移植范围见 [docs/MVU_PORT.md](docs/MVU_PORT.md)，应用数据契约见 [docs/MVU_API.md](docs/MVU_API.md)。

## 构建与发布检查

```bash
pnpm install
pnpm run check
pnpm run pack
node scripts/audit-v3-package.mjs
```

打包结果位于 `release/operit_mvu-3.0.0.toolpkg`。公开包只包含插件运行时、页面、清单、许可证和用户文档；测试、QA 截图、内部报告、`artifacts/`、依赖目录和 Git 元数据不会进入归档。发布前还会完成多宽度/130% 字体视觉验证和修改版 OperitAI APK 的 MuMu 真机验收。

## 许可证

仓库主体使用 [MIT 许可证](LICENSE)。移植代码和图标等第三方内容按各自上游许可证分发，详见 [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md) 与 `third_party/`。
