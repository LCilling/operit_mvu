# Task 9B2 effect reason backend report

## Scope

Task 9B2 persists an effect group's reusable reason configuration and makes every production activation path consume it by default. This review follow-up hardens size boundaries, legacy migration, validation purity, active snapshots, and record persistence. No UI, release/version, field-template implementation, package, manifest, progress ledger, or artifact file is part of this commit.

## Persisted contract and bounds

- `EffectGroupDefinition.defaultReason` is a strict `{ mode, template, text }` object.
- `mode` is `template` or `custom`; `template` is one of `general`, `positive`, `negative`, `environment`, or `relationship`.
- New editor/query/IPC source text is limited to 512 UTF-16 code units. Template mode may use empty text; custom mode must contain non-whitespace text. Query create/update repeats the strict source check so callers cannot bypass the IPC parser.
- A separate 16,384-unit compatibility ceiling permits valid historical v2/v3 source text above 512 to remain readable and round-trip through compatibility APIs.
- Every reason variable is normalized and limited to 256 units before substitution. NUL/control characters are removed or normalized, and oversized message/name values therefore cannot amplify an active snapshot.
- Fully rendered active-instance reasons and persisted `DataChangeRecord.reason` values share a 2,048-unit ceiling. Truncation is deterministic and never leaves a dangling UTF-16 high surrogate.
- Active reason snapshots require exact keys and non-empty bounded rendered text. Record-store append/replace validates the same rendered limit before persistence.

## Activation and records

- `activateEffectGroup` uses `definition.defaultReason` unless a caller provides an explicit override. Explicit new overrides retain the 512 source limit; a migrated legacy definition above 512 remains activatable.
- Supported variables are resolved at activation: `triggerActorName`, `ruleName`, `effectGroupName`, a bounded deterministic `fieldName`, and current message content as `event`.
- The resolved text is frozen in `ActiveEffectInstance.reason`; later definition rename, reason edit, or field-effect edit cannot rewrite an old instance.
- Rule-driven immediate records contain the resolved reason (`规则触发：…；效果：…`) and the complete record reason is normalized to the persistence limit. A million-character event and oversized names do not make ordinary message processing fail; message facts retain their existing 2,000-unit bound.

## Migration and store-boundary strategy

- v2 migration preserves custom reason source text from 513 through 16,384 units without loss in the reusable definition. An active snapshot preserves it while it fits the 2,048 rendered ceiling.
- Pathological legacy definition text above 16,384 is deterministically truncated and emits `MVU_EFFECT_REASON_LEGACY_TRUNCATED`. Historical records above 2,048 are likewise bounded with `MVU_CHANGE_RECORD_REASON_LEGACY_TRUNCATED`, so one pathological entry cannot block the overall migration.
- Template-mode compatibility text remains stored for round-trip fidelity but rendering uses the selected localized built-in template.
- `assertMvuDatasetV3` is now a pure strict validator. Frozen valid input passes without mutation; frozen input missing `defaultReason` fails and remains byte-for-byte unchanged.
- Only `V3MvuStore.loadV3Config` clones a persisted old-v3 document and performs deterministic reason backfill/legacy size normalization before validation. The next successful ordinary commit makes that normalized clone durable.
- v2 startup migration and v2 import/replace compatibility flow use the explicit migration boundary. Valid 513+ source text survives compatibility edits and restart.
- `transactV3` and normal commit do not backfill missing `defaultReason`; they validate before record staging and fail closed. Query create/update also require the field. Copy remains a deep copy and can preserve an existing legacy-compatible definition.
- Existing active instance reason snapshots are never recomputed from a changed definition. Legacy read normalization only bounds the snapshot's own historical text.

## TDD and verification evidence

Review fixes were added to `tests/effect-reason-config.test.mjs` before their source implementation. The first RED run failed at module loading because the three separate boundary constants did not exist. Subsequent focused failures exposed the old shared-bound assumption, mutation-based backfill, missing active/record bounds, and unbounded rendering path. Existing backend fixtures that intentionally create new v3 effect groups were then updated to supply the now-required reason configuration rather than relying on silent commit repair.

Final evidence:

- `node --test tests/effect-reason-config.test.mjs`: 13/13 pass.
- Related query/store/rule regression matrix: 109/109 pass.
- `pnpm run check`: pass, including 234/234 Node tests and 4/4 DOM gate tests.
- `pnpm run typecheck`: pass (also executed inside `check` and `build`).
- `pnpm run audit:effects`: pass (also executed inside `check` and `build`).
- `pnpm run build`: pass; all audits, typecheck, effects audit, and web build completed.
- `git diff --check`: pass.

## Task 9B UI carry (intentionally not changed here)

Concurrent Task 9B UI work owns `static/**`, so this backend commit does not touch it. The UI owner must make these exact integrations:

1. In `static/app_ui/runtime.js`, split `validateEffectReasonConfig` into response/persisted validation and editor-request validation. The current response validator hard-codes `reason.text.length > 512`; entity responses must accept the backend legacy-storage ceiling of 16,384, while create/update payloads must continue to reject source text above 512. Otherwise `getEntityById` will reject a valid imported legacy effect group containing 513+ characters.
2. Preserve required `defaultReason` on both demo entity constructors (`effectEntities` and `demoEffectEntities`) and on every new effect-editor draft. The current concurrent tree already includes template/general defaults in the two demo constructors; the UI task should retain them.
3. The effect editor must submit exact `{ mode, template, text }` keys, expose all five template values, require visible non-empty custom text, and provide a direct 512-character validation message before invoking create/update IPC.

## Residual risk

- The 16,384 compatibility ceiling is intentionally finite. Inputs above it migrate safely with a warning and deterministic truncation rather than preserving pathological payloads indefinitely.
- Until Task 9B UI applies the response/editor validator split above, the current concurrent runtime can reject legacy-compatible 513+ definition responses even though the backend correctly stores and serves them.
