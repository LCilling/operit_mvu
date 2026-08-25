# MVU v3 应用 API

本文记录 `operit_mvu 3.0.0` 的生产数据、事务、查询与宿主边界。权威持久化格式是 `formatVersion: 3`；v2 只作为保留原文件的迁移输入和迁移失败时的兼容读取源。

## 数据集与提交

`MvuDatasetV3` 的顶层内容包括：

- `fields`、`stateValues`、`lastSettled`、`turnCounters`；
- `conditions`、`rules`、`effectGroups`、`activeEffects`；
- `linkRules` 与旧命令兼容所需的有限状态；
- `recordManifest`、`processedMessageIds`、`ruleLastTriggered`；
- 有界的消息事实与小时计数桶；
- `revision`、`createdAt`、`settings` 和一次性绑定元数据。

主配置与每个 JSONL 记录段通过同一 revision 事务发布。写入流程为：完整临时文件 → 严格回读/校验 → `Tools.Files.replaceAtomically`。宿主不能提供 Android 本地同目录原子替换时提交失败，不使用普通覆盖、copy/delete 或先删后写。

每个修改请求携带 `expectedRevision`。服务在读取后和发布前都验证 compare-and-swap；过期页面收到 stale 错误并重新获取当前实体，不能覆盖其他页面的新提交。

## 字段与作用域

字段作用域为：

- `character`：角色独立，同一字段可绑定多个角色，每个角色有独立值；
- `group`：群组共享，每个绑定群组有一个共享值；
- `global`：全局共享，所有会话读取同一值；
- `chat`：聊天专属，通常自动绑定当前聊天。

字段包含可编辑的 `minimum`、`maximum`、`step`、`initialValue` 和有序阶段。修改范围时，服务按旧范围中的相对位置同步换算当前值、初始值、阶段阈值和字段专属变化配置；任一结果非有限、越界或阶段顺序失效时整个事务拒绝。

`modelVisibility` 可为 `full`、`stage_only` 或 `hidden`。隐藏字段不会进入普通模型投影，但被启用规则直接引用时会被诊断；`stage_only` 只暴露阶段，不暴露数值。

## 有界查询

页面只消费 compact snapshot 和服务端分页查询，不接收无界完整数组。

| 资源 | 页面大小 | 大集合行为 |
| --- | ---: | --- |
| 字段 | 5 | 搜索、作用域筛选、稳定排序 |
| 规则 | 5 | 搜索、启用状态、触发角色与引用摘要 |
| 条件 | 10 | 搜索、谓词类型、引用统计 |
| 效果组 | 10 | 搜索、字段筛选、启用状态 |
| 记录 | 10 | 字段、作用键、来源和时间筛选 |
| 角色/群组/选择器 | 游标窗口 | 180ms 搜索防抖、过期请求丢弃、已选项固定显示 |

游标与查询指纹绑定、有有效期和缓存上限。调用方不能把一个搜索或过滤条件下的游标复用于另一查询。所有总数和“显示 X–Y / 共 Z 条”由 main runtime 计算。

## 条件库

`ConditionDefinition` 是可复用资产，包含名称、说明、启用状态和递归 `ConditionExpression`。表达式支持 `and`、`or`、`not` 与叶子 `predicate`，深度、节点数、字符串和数组均有硬上限。

生产谓词共 14 类：

1. 最近正向变化；
2. 长时间未互动；
3. 用户关心；
4. 特别日子；
5. 高频互动；
6. 字段比较；
7. 消息数量；
8. 关键词；
9. 发送方；
10. 角色；
11. 群组；
12. 具体日期；
13. 每年重复日期；
14. AI 语义条件。

角色、群组和具体日期选择必须包含 1–100 项。日期按真实公历校验。AI 谓词使用稳定 ID、可视化 `triggerType`、`requirement` 和 `minimumConfidence`；模型只判断事实是否满足，不返回字段修改结果。

条件 CRUD 包括查询、按 ID 获取、创建、更新、复制、启停、删除和引用列表。被规则引用的条件不能静默删除；共享条件编辑前页面展示受影响规则。

## 规则

`RuleDefinitionV3` 将触发和结果分离：

```ts
interface RuleDefinitionV3 {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerActorSelector:
    | { kind: "any" }
    | { kind: "current_actor" }
    | { kind: "selected"; actorIds: string[] }
    | { kind: "group"; groupIds: string[] };
  conditionId: string;
  actions: RuleActionV3[];
  cooldownHours: number;
  executionOrder: number;
}
```

动作只有结果语义：

- `change_field`：字段、目标角色选择器、直接变化值和显式导入的多个效果组；
- `activate_effect_group`：激活可复用效果组，并把当前事件角色保存为 `triggerActorId`。

`change_field.target` 可为 `trigger_actor`、`all_bound` 或指定角色。触发角色选择在条件判断和 AI 请求前完成；结果目标不会反向改变触发条件。

一次消息中超过模型规则预算的 AI 规则按 `executionOrder` 和稳定 ID 确定性选择，产生有界 overflow 诊断，并继续普通状态判断与消息持久化，不能因第 21 条规则中断整个事件。

## 效果组

`EffectGroupDefinition` 是可命名、可复制、可由多个规则引用的模板。它按字段保存 `FieldEffectDefinition`：

```ts
interface FieldEffectDefinition {
  id: string;
  fieldId: string;
  actorSelector:
    | { kind: "all_bound" }
    | { kind: "trigger_actor" }
    | { kind: "selected"; actorIds: string[] };
  operations: EffectOperation[];
}
```

操作类型：

- `immediate_delta`：激活时立即变化；
- `fixed_adjustment`：为匹配来源的变化追加固定量；
- `positive_multiplier`：只修正正向变化；
- `negative_multiplier`：只修正负向变化；
- `all_multiplier`：修正全部变化。

后四类使用 `sources` 限定 `manual`、`natural`、`per_turn`、`rule` 和 `ai`。一个字段可组合多条操作。角色独立字段支持动态 `trigger_actor`，所以“角色 T 触发事件 B 后，只让 T 的欲望 A -30 且后续增长倍率为 0.5”可由一个效果组表达，不会扩散到所有绑定角色。

原因配置支持 `general`、`rule`、`natural`、`per_turn`、`ai`、`manual` 模板或自定义文本。新输入最多 512 字符；旧 v3 文档可读取最多 16,384 字符并安全规范化。激活时生成不可变原因和定义快照，后续改名不会改变旧记录。

`EffectDuration` 由 `expiresAt` 与 `remainingTurns` 组合表达永久、截止时间、剩余轮次和手动结束。运行实例保留已解析目标与 `triggerActorId`。

## 字段模板

字段模板格式为 `operit-mvu-field-template`、schema 1，带规范化校验摘要。默认包含字段定义、范围、阶段、外观和字段专属自动配置，不包含规则、条件、效果组或变化记录。

导出时每个角色/群组值必须显式勾选；导入先返回预览、依赖、冲突和可读目标建议。用户为每个角色或群组决定是否启用，并选择文件值、本地值或初始化值。映射按稳定 ID 与用户确认执行，不按同名首项静默匹配。最终导入以一个 `expectedRevision` 原子事务提交。

## 完整备份

完整备份格式为 `operit-mvu-full-backup`、schema 1，包含完整 v3 配置、运行状态、活跃效果与全部已提交记录。文件名绑定导出时间、来源 revision 和校验摘要。

导入分为两步：

1. `previewDatasetImport` 严格验证格式、大小、嵌套、引用、校验摘要和记录数量，并展示替换警告与 v2 迁移警告；
2. `importDataset` 必须携带预览确认和当前 `expectedRevision`，以一个原子事务替换全部 MVU 数据。

完整恢复不做模糊合并。校验失败、revision 过期或原子发布失败时，当前配置与记录保持可读；清理失败进入可恢复 journal，并在重启后继续。

## 模型投影

MVU 只调用 `ToolPkg.systemModel.probe()` 和 `complete({ systemPrompt, userPrompt, jsonSchema? })`。它不选择、复制或读取宿主模型配置，也不调用 `ToolPkg.localModels`。

最终模型字段行最多 40 条。选择顺序优先保留当前可达规则、条件和效果组直接引用，再按可见性、精确 `(fieldId, scopeKey)` 最近变化、字段顺序和稳定 ID 补足。群组预算对最终成员字段行计算，compact snapshot、页面统计和真实 prompt 共用同一路径。

返回文本必须完整通过 `JSON.parse`、严格键集合、schema、字段授权、置信度、幅度和上下文检查后才可进入事务。宿主模型上限为 150 秒，页面 `judgeState` IPC 为 180 秒；超时、取消、输出越界或解析失败都不提交状态。

## 消息事务

一次完整持久化消息按确定顺序处理自然时间、每轮变化、确定性/AI 规则、普通 AI 候选、联动、活跃效果、记录和幂等标记。身份来自宿主 `message_persisted` 的稳定 `chatId/messageId/variantId/actorCharacterCardId/characterGroupId`；缺失触发角色时动态目标跳过并记录诊断，不扩大为所有角色。

任一步业务校验失败时配置事务不提交。记录段只有被当前主配置 `recordManifest` 引用后才可见，孤立临时段不会在查询或备份中泄露。

## 宿主接口

生产插件的完整宿主白名单由 `scripts/audit-host-api-compat.mjs` 执行。除 Operit 官方接口外，只允许 [OPERITAI_CHANGES.md](OPERITAI_CHANGES.md) 登记的 #1–#8 扩展。精确接口形状见 [HOST_INTERFACE_REQUIREMENTS.md](HOST_INTERFACE_REQUIREMENTS.md)。
