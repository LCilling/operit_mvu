# Task 10B follow-up — MVU v3 模型字段预算生产链

## 结果与复审项映射

1. `MvuService.projectFields()`、`visibleFieldsForContext()` 和 `runtime.snapshot()` 恢复全量兼容投影；44 个字段仍返回 44 个。模型链显式使用 `projectModelFields()`，严格不超过 40 个。
2. 最近变化按完整 `(fieldId, scopeKey)` 查询。`SegmentedRecordStore.queryLatestFieldChanges()` 对段只做串行、至多一次读取，利用段索引跳过无关段；同字段的其他角色不会污染排序，且旧目标不会被更新的 500 条无关记录遮蔽。
3. 生产消息在 `src/main.ts` 先由 `persistedRole(payload.sender)` 固化角色，再以可信 host context 固化 actor/chat/group；state/rule 不再收到 `unknown`。字符串接口仅作为 v2 兼容入口保留。
4. state/rule/condition 共用有界 scope/message 规范。字段名、说明、阶段名/说明、AI prompt、规则名、触发类型、要求、predicate 文本、身份与消息均有单项上限；system + user prompt 合计有 65,536 UTF-8 byte 硬上限。
5. condition judgement 契约可接收可信 `StateScopeContext`；v3 service 生产路径传入 context，并以 context 覆盖调用消息中可能伪造的 actor 元数据。
6. v3 `runtime.buildStateSection()` 与 `runtime.buildMvuData()` 均通过 `readV3()` 权威图选择字段，不再从 v2 compatibility dataset 收集引用。启用条件的 hidden 直接引用被保留，禁用条件不提升 hidden 字段。
7. 群组预算单位是最终 `(fieldId, scopeKey)` 状态条目。20 成员 × 40 字段形成 800 个候选时，只序列化 40 行，`stats.used === 40`，成员输入重排不改变结果。
8. v3 规则可达性与 rule-engine 的 actor selector/cooldown 语义等价：区分 event actor 与 current actor，支持 any/current/selected/group，并使用同一 automation scope 下的 durable last-triggered 时间。不可运行规则不提升 hidden 字段。
9. compact query snapshot 直接暴露有界 `modelBudget`：`used/total/limit/referencedIncluded/referencedTotal/overflow/diagnostics`；诊断最多 32 条、每条最多 256 code points，不携带字段数组。
10. 反转回归覆盖 service/runtime/UI-compatible projection 44→44，同时模型 projection/MVU data/生产 state judgement 均 ≤40。
11. `stage_only` 在状态段、state/rule judgement 与 runtime model data 中只投阶段，不投数值；disabled 始终排除，严格 JSON schema 与单次 `complete()` 行为保持不变。

## 确定性策略

- 先过滤 disabled 与当前 scope 不适用的条目。
- 可达启用规则的直接/递归/效果组引用优先。
- 然后按 `full`、`stage_only`、精确 scope 最近变化、字段 `order`、稳定 field ID、稳定 scope key 排序。
- 引用条目超过 40 时仍只投前 40 个，不静默超预算；统计返回 `referencedTotal/referencedIncluded`，并记录 `MVU_MODEL_REFERENCED_FIELDS_OVERFLOW:<total>:<limit>`。

## TDD 证据

### RED

- 新增 follow-up 测试后，类型检查首先因缺少 `buildScopedStateSectionProjection` 失败。
- 初次 focused run 为 14/17；修正冷却测试夹具的“已过期”时间后，真实 RED 集中在 v3 权威引用路径与可信 condition context/总 DTO 上限。
- compact snapshot 新测试得到 `modelBudget === undefined`。
- runtime model data 的 `stage_only` RED 明确捕获 `[73, ...]` 数值泄漏。
- 可信 context 反例用伪造 actor 调用，RED 得到 `spoofed-actor` 而非 `actor-t`。
- 全量兼容 API 反转测试曾得到 40 而非 44，随后恢复原始语义。
- 真实注册的手动 `judgeState` IPC 在 44 字段下 RED 为 `MANUAL_JUDGE_RECEIVED_UNBOUNDED_FIELDS:44`；仅把该 handler 改为 `projectModelFields().fields` 后转绿，未覆盖 `7eded42` 的 condition production validation。

### GREEN

- `tests/model-budget.test.mjs`: 19/19 PASS。
- `tests/query.test.mjs`: 43/43 PASS。
- model-budget/query/record-store/record-store-hardening/rule-engine-v3/host-boundary/condition-contract-boundary：136/136 PASS。
- 真实 production chat hook 验证可信 role/actor/chat/group、模型字段不超过 40、一次 condition complete、一次 state complete；同一 runtime snapshot 保留全部 44 字段。

## 最终验证

- `pnpm run typecheck`: PASS。
- focused：`tests/model-budget.test.mjs`，19/19 PASS。
- related：136/136 PASS。
- `pnpm run check`: 283/283 Node tests、4/4 DOM gate，PASS。
- `pnpm run build`: manifest/web/v3 audits、typecheck、effect audit、web build，PASS；`dist/app.html` 9,452,242 bytes。
- `git diff --check`: PASS。

本任务不声称进行了真机或 MuMu 测试。

## 3203a9e 复审后的窄范围修复

### 生产修复

- 群组 compact snapshot/IPC 的 `modelBudget` 现在接收与系统 prompt 相同的 `memberContexts`，并直接复用 `MvuService.buildModelStateSection(...).budget`。该链继续使用权威 `readV3()`、精确 scope recency 和同一字段引用图，不再维护单独的单-context UI 预算。
- v2 AI 规则判断先过滤有效候选，再按 `order`、稳定规则 ID 排序，单次选取前 20 条。超过上限时返回唯一有界诊断 `MVU_AI_RULES_OVERFLOW:<total>:<selected>`；生产消息链记录该诊断，继续状态判断和持久化，不增加模型调用。

### 本轮 RED

- 新增生产组合测试通过真实 `registerToolPkg → prompt hook → snapshot IPC` 运行。旧实现中真实 prompt 已输出 40 行，但 compact budget 为 `used=0,total=0,overflow=false`，预期为 `40/800/true`。
- 21 条合法 AI 规则直接调用与真实 v2 compatibility 消息事件均以 `MVU_AI_RULE_LIMIT_EXCEEDED` 失败，事件在 `judgeState` 和持久化前中断。
- 修正测试夹具自身的真实 v2 文件名和合法规则效果后，三个测试均只因上述两个生产缺陷保持 RED。

### 本轮 GREEN 与回归

- 新增目标测试：3/3 PASS。群组 prompt 与 compact/IPC 均为 `used=40,total=800,limit=40,overflow=true`。
- 21 条规则只产生 1 次 rule completion，候选为稳定前 20 条并返回 `MVU_AI_RULES_OVERFLOW:21:20`；随后产生 1 次 state completion，消息成功持久化。
- focused model-budget + query：65/65 PASS。
- related model-budget/condition/query/record-store/rule/host：138/138 PASS。
- 完整 `pnpm run test:v3`：294/294 PASS。
- condition DOM：31/31 PASS；field-template DOM：20/20 PASS。
- `pnpm run typecheck`：PASS；本任务文件 `git diff --check`：PASS。
- `pnpm run build` 已执行，但当前被共享工作树中授权范围外的规则 UI 审计失败阻断；失败项为 `compact rule rows must show actor, condition and action summaries with view/edit actions`。本修复未修改 static UI、审计脚本、manifest、types 或 artifacts。
