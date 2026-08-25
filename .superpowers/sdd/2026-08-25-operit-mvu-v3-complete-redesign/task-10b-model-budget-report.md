# Task 10B — MVU v3 模型字段预算后端

## 结果

- 新增确定性 `selectModelFields(dataset, context, options)`，默认和硬上限均为 40。
- 字段选择顺序固定为：当前上下文可用 → 启用规则直接/间接引用 → `full`/`stage_only` 可见性 → 最近提交变化 → `order` → 完整稳定字段 ID。
- 递归收集启用条件树中的 `field_comparison`、规则 `change_field.fieldId`、`change_field.effectGroupIds` 及 `activate_effect_group` 引用的启用效果组字段。
- 隐藏字段默认不进入模型；被可达启用规则直接引用时允许进入。禁用和当前作用域不适用的字段始终排除并诊断。
- 引用字段超过 40 时仍严格只投 40 个，按上述顺序确定性选择，并返回 `MVU_MODEL_REFERENCED_FIELDS_OVERFLOW:<referenced>:<limit>`。
- 预算统计包含 `used/total/limit/referencedIncluded/referencedTotal/overflow/diagnostics`；诊断去重、排序并限制为 32 条，不在快照中携带无界字段数组。
- `MvuService.projectFields()` 保持原 public API，但改用同一预算；新增 `projectModelFields()` 单独提供字段投影和统计，供后续 IPC/UI 使用。
- v3 最近变化只读取最后 500 条已提交记录；v2 继续使用兼容数据集中的有界历史。
- 所有 state/rule system-model 字段输入再次执行 40 条防线；`stage_only` 只包含阶段，不包含当前数值或范围。
- v3 结构化当前消息携带 `role`、actor ID/name、chat/group ID；兼容字符串调用保留并显式使用 `role: "unknown"`，不伪造发送者。所有文本和身份元数据均有界，严格 JSON 响应 schema 未改变。

## TDD 证据

### RED 1

命令：

```powershell
pnpm run typecheck
node --test tests/model-budget.test.mjs
```

结果：测试文件因 `MODEL_FIELD_LIMIT` / `selectModelFields` 尚未导出而失败，确认预算能力不存在。

### GREEN 1

实现纯选择器、递归引用收集、作用域过滤、稳定排序、溢出统计、stage-only 投影与结构化当前消息后：10/10 通过。

### RED 2

新增服务统计契约测试后，`service.projectModelFields is not a function`，10/11 通过、1/11 失败。

### GREEN 2

实现兼容 `projectFields()` 与独立 `projectModelFields()` 后：11/11 通过。

## 覆盖

- 少于 40、超过 40、输入重排稳定性。
- 递归条件、规则字段、效果组间接引用保留。
- hidden 直接引用、disabled 排除、缺失/禁用引用诊断。
- 可见性、最近变化、order、稳定 ID 决胜。
- 引用字段超过 40 的确定性溢出。
- character/group/chat/global 四种作用域。
- `stage_only` 在状态块、状态判断、规则判断中的数值隐藏。
- 当前消息 role、actor、chat、group 元数据；单次完成调用和原严格 JSON schema。
- 服务兼容 API 与预算统计结果一致。

## 验证

- `pnpm run typecheck`: PASS。
- focused：`tests/model-budget.test.mjs`，11/11 PASS。
- related：model-budget + rule-engine-v3 + record-store + query，107/107 PASS。
- `pnpm run check`: 271/271 Node tests、4/4 DOM gate，PASS。
- `pnpm run build`: audits、typecheck、effect audit、web build，PASS；`dist/app.html` 9,436,247 bytes。
- `git diff --check`: PASS。

本任务未进行真机或 MuMu 测试；该阶段由总任务最终验收统一执行。
