# Task 9B2 effect reason backend report

## Scope

Task 9B2 persists an effect group's reusable reason configuration and makes every production activation path consume it by default. This review follow-up separates the v3 product template vocabulary from the legacy v2 vocabulary, adds visible compatibility warnings, and closes the legacy IPC edit-limit bypass without breaking valid 513–16,384-unit historical reasons. No UI, release/version, field-template implementation, package, manifest, progress ledger, or artifact file is part of this commit.

## V3 persisted contract

- `EffectGroupDefinition.defaultReason` is an exact-key `{ mode, template, text }` object.
- `mode` is `template` or `custom`.
- The v3-only `EffectReasonTemplate` enum is `general | rule | natural | per_turn | ai | manual`. It is distinct from `TemporaryEffectReasonTemplate` in the v2 model.
- Localized built-ins render as: `general` → `临时状态影响`, `rule` → `规则触发`, `natural` → `自然变化`, `per_turn` → `每轮变化`, `ai` → `AI 更新`, and `manual` → `手动调整`.
- New v3 IPC/query create and update requests accept only this enum. Legacy values and prototype keys such as `toString` are rejected. Template mode may have empty text; custom mode requires non-whitespace text.
- New source text is limited to 512 UTF-16 code units. A separate 16,384-unit persisted compatibility ceiling retains valid historical custom sources. Every rendered active snapshot and `DataChangeRecord.reason` is limited to 2,048 units; each substituted variable is limited to 256 units.

## Deterministic legacy mapping

The v2 `TemporaryEffectReasonTemplate` remains `general | positive | negative | environment | relationship` and is not widened.

| Legacy template | V3 definition | Preserved visible text |
| --- | --- | --- |
| `general` template mode | `custom/general` | `临时状态影响` |
| `positive` template mode | `custom/general` | `临时增益` |
| `negative` template mode | `custom/general` | `临时减益` |
| `environment` template mode | `custom/general` | `情境影响` |
| `relationship` template mode | `custom/general` | `关系事件` |

- A legacy custom reason becomes `custom/general`; its text is preserved exactly through 16,384 units. Its old category metadata is not reinterpreted as a v3 product template.
- Development-era persisted v3 definitions containing the old-only enum values are normalized only after the store clones the JSON document. Template-mode definitions become readable `custom/general` labels; custom-mode definitions retain their text and use the safe `general` fallback.
- Development-era active snapshots retain their already-rendered text and become `custom/general`; they are never recomputed from a changed definition.
- `general` is already the valid v3 compatibility fallback, so an otherwise valid persisted v3 `general` value needs no enum conversion.
- V3-to-v2 compatibility projection represents non-general v3 templates as `custom/general` localized text. An unrelated v2 edit preserves the authoritative v3 default reason; the definition changes only when the projected `(reasonMode, reasonTemplate, reason)` tuple actually changes.

## Migration warnings

Every compatibility alteration in the effect-reason path is surfaced through `MigrationStatus.report.warnings` using deterministic code-prefixed entries:

- `MVU_EFFECT_REASON_LEGACY_TEMPLATE_CONVERTED`
- `MVU_EFFECT_REASON_LEGACY_TRUNCATED`
- `MVU_ACTIVE_EFFECT_REASON_LEGACY_TRUNCATED`
- `MVU_ACTIVE_EFFECT_REASON_LEGACY_NORMALIZED`
- `MVU_CHANGE_RECORD_REASON_LEGACY_TRUNCATED`
- `MVU_V3_EFFECT_REASON_DEFAULT_BACKFILLED`
- `MVU_V3_EFFECT_REASON_LEGACY_TEMPLATE_CONVERTED`
- `MVU_V3_EFFECT_REASON_LEGACY_TRUNCATED`
- `MVU_V3_ACTIVE_EFFECT_REASON_LEGACY_TEMPLATE_CONVERTED`
- `MVU_V3_ACTIVE_EFFECT_REASON_LEGACY_TRUNCATED`

An unchanged old-v3 file reports the same warnings on each initialize/restart. The read path does not silently persist its normalized clone. After a successful ordinary transaction commits that normalized dataset, the next restart has no compatibility warning. `assertMvuDatasetV3` remains a pure validator and never backfills or mutates input.

## Legacy IPC and service edit policy

- `addTemporaryEffect` is always a new edit: both parser and service reject reason source above 512.
- `updateTemporaryEffect` parser permits reason text through the 16,384 compatibility ceiling so an unchanged historical reason can reach the authoritative service comparison. Text above 16,384 is rejected and is never silently truncated.
- The service reads the stored effect, applies the patch to a clone, and compares the resulting `(reasonMode, reasonTemplate, reason)` tuple with the authoritative tuple. If any tuple member changes, the resulting source must be at most 512. An unrelated patch, including one that repeats the same 513–16,384 text byte-for-byte, round-trips safely.
- Compatibility reconciliation uses the same tuple comparison before replacing `EffectGroupDefinition.defaultReason`, preventing unrelated v2 edits from degrading a richer v3 product template.

## Activation, immutability, and bounds

- `activateEffectGroup` uses `definition.defaultReason` unless the caller explicitly overrides it. Rule, manual, and other production paths therefore share one default policy.
- Rule activation supplies bounded `triggerActorName`, `ruleName`, `effectGroupName`, `fieldName`, and current `event` variables. Custom sources are rendered once and stored in `ActiveEffectInstance.reason`.
- Immediate rule records contain the resolved reason (`规则触发：…；效果：…`) rather than the old hard-coded `激活效果组` text.
- A million-character event and oversized names are deterministically normalized without failing ordinary message processing. Active snapshots and persisted records enforce the same 2,048-unit exact-key boundary.
- Later definition edits, renames, or reason changes never rewrite an existing active-instance reason or definition snapshot.

## TDD evidence

The first RED run, before production changes, produced 11 expected failures out of 16 focused tests: legacy enum persistence, missing initialization warnings, development-v3 conversion, v3 product templates, compatibility projection, and legacy IPC edit bounds. Follow-up RED cycles separately proved that:

1. prototype key `toString` was incorrectly accepted by the v3 persisted validator;
2. v2 active-reason truncation lacked a migration warning; and
3. update IPC incorrectly rejected an unchanged 513–16,384-unit legacy reason before the service could compare authoritative state.

Final verification evidence collected on the completed backend tree:

- `node --test tests/effect-reason-config.test.mjs`: 16/16 pass.
- Related effect/query/store/rule matrix: 138/138 pass.
- `pnpm run check` passed at the completed-backend checkpoint, including 237/237 Node tests and 4/4 DOM gate tests. A later pre-commit rerun was blocked before backend typecheck by concurrent `static/**` work failing one `audit-v3-ui` rule: `complete effect-group DTOs must fail closed without an exact bounded defaultReason`.
- On the latest shared-tree state, `pnpm run typecheck`, `pnpm run audit:effects`, and the 138-test related backend matrix pass independently.
- `pnpm run build` passed after the backend refactor, including all audits, typecheck, effects audit, and web build, before the later concurrent UI change introduced the audit failure above.

## Task 9B UI carry (intentionally not changed here)

Concurrent Task 9B UI work owns `static/**`. It must make these exact integrations:

1. In `static/app_ui/runtime.js`, update `validateEffectReasonConfig` to accept only `general | rule | natural | per_turn | ai | manual` for v3 DTOs. The current validator still lists the five legacy v2 values.
2. Split response/persisted validation from editor-request validation: entity responses may contain custom source through 16,384 units, while create/update payloads must remain limited to 512.
3. Render the six localized labels listed in this report and keep `defaultReason` on demo constructors, new drafts, create payloads, and update payloads.
4. Update UI-owned tests that construct v3 reasons with `positive`, `negative`, `environment`, or `relationship`; those values are now valid only in legacy v2 temporary-effect contracts.

## Residual risks

- The 16,384 compatibility ceiling is intentionally finite. Larger historical source text is normalized deterministically with a warning rather than retained indefinitely.
- Until Task 9B applies the exact enum and response/editor limit split, its runtime validator can reject valid new v3 templates or valid 513+ legacy-compatible definition responses even though the backend stores them correctly.
- Migration warnings remain the repository's existing structured string format (`CODE:details`) rather than a new object DTO, avoiding an unrelated IPC/report schema break.
