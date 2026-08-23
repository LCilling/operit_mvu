# MVU v2 应用 API

本页说明 `examples/operit_mvu/src/mvu/app` 的当前应用契约。`src/mvu/core` 保留 MagVarUpdate 命令兼容能力，但不再作为页面或持久化层的直接接口。

MVU 尚未发布，持久化格式直接使用 `formatVersion: 2`。没有 v1 迁移分支、假角色身份、假聊天记录或恢复演示数据命令。

## 数据集与事务

`MvuDataset` 是唯一权威文档，主要包含：

- `fields`、`rules`、`autoRules`、`temporaryEffects` 与 `settings`
- 仅供默认模板首次接入宿主身份使用的 `pendingBootstrapFieldIds`
- 按作用域键保存的 `stateValues`、`lastSettled`、`turnCounters` 与 `ruleLastTriggered`
- `records`、`messageFacts` 与 `processedMessageIds`
- `formatVersion`、`createdAt` 与单调递增的 `revision`

生产运行时使用 `FileMvuStore` 将数据写入 ToolPkg 私有配置目录。每次提交都校验期望 revision，先写临时文件再移动为正式数据文件。`MvuService` 在 CAS 冲突时基于最新快照重做整个 mutation；解析、校验或文件错误会记录并向调用方抛出。

页面不能直接修改 `MvuDataset`。所有写入都必须经过 `MvuService`，提交成功后页面重新读取快照。

`pendingBootstrapFieldIds` 是 v2 文档中的必填、严格一次性元数据，不以空 `bindingIds` 猜测初始化状态。默认模板首次取得对应宿主稳定 ID 后即从列表移除；用户主动清空绑定、修改作用域、导入配置或后续出现新角色时都不会重新扩张绑定。完整数据集导入会严格保留文件中显式给出的待绑定列表，且列表必须通过字段存在、非全局作用域、尚无绑定和 ID 唯一性校验。

## 作用域上下文

```ts
interface StateScopeContext {
  chatId: string | null;
  actorId: string | null;
  groupId: string | null;
  actorName: string;
}
```

`null` 表示宿主没有权威身份，不得用显示名、成员第一项或固定 ID 补造。字段支持 `character`、`group`、`global` 和 `chat` 四种作用域，因此任何状态命令都需要完整上下文，不能只传一个角色 ID。

作用域键由字段的 `scope` 和对应稳定 ID 确定。角色字段使用 `actorId`，角色组字段使用 `groupId`，聊天字段使用 `chatId`，全局字段使用固定全局键。字段绑定也保存相应宿主稳定 ID。

## `MvuService`

`MvuService` 是统一领域入口：

- 快照与投影：`getDataset`、`projectFields`、`getStateValue`
- 字段：`addField`、`updateField`、`deleteField`
- 联动规则：`addLinkRule`、`updateLinkRule`、`deleteLinkRule`
- 自动规则：`addAutoRule`、`updateAutoRule`、`deleteAutoRule`
- 临时效果：`addTemporaryEffect`、`updateTemporaryEffect`、`deleteTemporaryEffect`
- 状态变化：`setStateValue`、`applyCommand`、`settleNatural`
- 已持久化消息：`processPersistedMessage`、`hasProcessedMessage`、`getRecentMessageFacts`
- AI 候选：`applyAiJudgement`
- 配置与数据：`exportConfiguration`、`replaceConfiguration`、`replaceDataset`、`updateSettings`
- 查询与记录：`getFields`、`getRules`、`getAutoRules`、`getRecords`、`clearRecords`

字段删除会同步清理当前值、自然变化锚点、轮次计数器、规则引用和临时效果；修改字段作用域或绑定时会在同一事务内删除已不再兼容的临时效果。既有变化记录保留其字段名与提交值，继续可读。

`exportConfiguration` 与 `replaceConfiguration` 处理字段和规则配置，配置导入会清空待首次绑定列表。页面使用的完整数据导入导出处理整个 v2 `MvuDataset`；导出由原生 IPC 直接写入 `/sdcard/Download/Operit/exports/` 并返回文件名与保存路径，不使用 WebView Blob 下载。完整数据导入必须先通过严格 v2 文档校验，随后保留本地 CAS revision 的权威递增关系。

## 权威消息身份

```ts
interface PersistedMessageIdentity {
  context: StateScopeContext;
  messageId: string;
  variantId: string | null;
}
```

`processPersistedMessage` 只接收宿主已经持久化且 `isComplete` 的消息。幂等键由 `chatId`、`messageId` 和 `variantId` 共同构成；原始变体使用明确的 `null` 标签，与任何真实变体 ID 区分。时间戳不参与消息身份推导。

一次消息事务依次执行自然时间结算、每轮变化、自动规则、AI 候选、状态联动、临时效果消耗、变化记录写入与幂等标记。任一步校验失败时整次事务不提交。

## AI 判断

MVU 通过 `ToolPkg.systemModel` 调用 Operit 当前默认聊天模型，不选择或复制宿主模型配置，也不使用 `ToolPkg.localModels` 代替系统模型。

模型返回值先按严格 JSON 解析，再校验每一项的字段 ID、有限数值、置信度、字段 AI 开关、最小置信度与最大变化幅度。Markdown 代码块、说明文字、未知字段、重复字段、越界变化或无效数字均不能进入写入链。

模型判断是候选，不是直接写入。只有通过校验的候选才能交给 `processPersistedMessage` 或 `applyAiJudgement`，最终仍由同一事务链提交。

宿主 `complete()` 的执行上限为 150 秒，超时会取消模型请求。MVU 同时提交严格 JSON Schema，宿主关闭该次推理内容通道，公开文本仍由插件整段解析和执行业务校验。页面的 AI IPC 等待上限为 180 秒，因此不会出现页面先超时、宿主仍继续生成并形成不可见提交的时序。其他页面 IPC 使用 20 秒上限。

## Prompt 投影

状态提示词由当前完整 `StateScopeContext` 与字段的 `modelVisibility` 生成。插件只在普通 `CHAT` 请求中追加状态段，并保留 Operit 已组合好的完整系统提示词。摘要、记忆、标题和其他系统任务不注入 MVU 状态。

## MagVarUpdate 命令兼容层

`src/mvu/core` 继续支持锁定上游的 `_.set`、`_.assign`、`_.insert`、`_.delete`、`_.remove`、`_.add` 与受限 JSON Patch 语法。兼容层只能生成经过校验的应用命令，不能绕开 `MvuService` 写入持久化状态。

安全边界保持如下：

- 不使用 `new Function` 或 `eval`
- 数学求值只允许白名单函数与常量
- 拒绝危险键、保留路径、过深路径和超预算输入
- 不执行 JSON Patch `move`，返回 `MVU_MOVE_UNSUPPORTED`

宿主字段与解析规则见 [HOST_INTERFACE_REQUIREMENTS.md](HOST_INTERFACE_REQUIREMENTS.md)。
