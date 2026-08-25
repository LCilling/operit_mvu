# Task 9B2 effect reason backend report

## Scope

Task 9B2 makes an effect group's reusable reason configuration part of the v3 persisted definition and makes every activation path consume that configuration by default. No UI, release/version, field-template, package, manifest, progress ledger, or artifact file is part of this change.

## Persisted contract

- `EffectGroupDefinition.defaultReason` is a strict `{ mode, template, text }` object.
- `mode` is `template` or `custom`; `template` is one of `general`, `positive`, `negative`, `environment`, or `relationship`.
- Definition source text is bounded to 512 UTF-16 code units. Template mode may retain an empty or legacy compatibility text value, but rendering always uses the selected built-in template. Custom mode requires non-whitespace text.
- Effect-group create and update IPC parsers require exact reason keys, reject unknown nested keys, and share the same bounds as persisted v3 validation.
- Query input/patch DTOs derive the new required field from `EffectGroupDefinition`; the existing generic create/update/query/copy implementation already deep-clones nested data with `klona`, so no query implementation fork was needed.

## Activation and snapshots

- `activateEffectGroup` now uses `definition.defaultReason` when the caller does not provide an explicit override. This makes manual and future production activation paths consistent by construction.
- Safe variables are resolved at activation: `triggerActorName`, `ruleName`, `effectGroupName`, a deterministic joined `fieldName`, and the current message content as `event`.
- The resolved text is stored in `ActiveEffectInstance.reason`; later definition rename, reason edit, or field-effect edit does not rewrite an existing instance.
- Rule-driven immediate change records include the resolved reason (`规则触发：…；效果：…`) instead of the generic `激活效果组` label.

## Migration and compatibility strategy

- v2 migration copies `reasonMode`, `reasonTemplate`, and `reason` losslessly into `defaultReason`. The active instance receives the fully resolved reason snapshot, including a localized built-in template string for template mode.
- A v3 file written before this field existed receives deterministic `template/general` with empty source text at the validation/store boundary. The in-memory dataset is immediately complete; the next ordinary atomic commit persists the backfill. Repeated startup before that commit produces the same result.
- Legacy active definition snapshots remain unchanged, and legacy active reason snapshots are never recomputed during backfill.
- v3-to-v2 compatibility projection now reads the definition default rather than borrowing one active instance's frozen reason. A v2 compatibility edit updates the reusable definition and preserves every old active instance reason.

## TDD evidence

Initial RED after adding only `tests/effect-reason-config.test.mjs`:

- 7 tests run: 1 passed, 6 failed for the intended missing behaviors.
- Failures proved the old code had no definition reason, no old-v3 backfill, hard-coded rule activation, mandatory caller reason, no new IPC key, and instance-based compatibility projection.

GREEN and focused verification:

- `pnpm run typecheck`: pass.
- `node --test tests/effect-reason-config.test.mjs`: 7/7 pass.
- Relevant backend regression matrix (`effect-engine`, `effect-immutability`, Task 9B2, `rule-engine-v3`, `record-store`, `record-store-hardening`, and `query`): 132/132 pass.
- `pnpm run audit:effects`: pass.
- `pnpm run build:web`: pass; generated `dist/app.html`.
- Targeted `git diff --check`: pass.

At the time of this report draft, whole-repository `pnpm run check` and `pnpm run build` are temporarily blocked by concurrent, uncommitted Task 9B field-template UI work outside this task's authorized paths. The first check stopped in the UI audit, and a later all-Node run reached 227/228 with only the concurrently edited UI shell failing. Final whole-repository evidence must be refreshed after that shared UI edit settles; these failures are not suppressed or changed by Task 9B2.

## Residual risks

- Template-mode compatibility text is retained for round-trip fidelity but intentionally does not override the built-in localized template.
- The `event` variable contains the current persisted message content. Existing message-fact validation bounds persisted message content; unknown template variables remain literal and no expression evaluation occurs.
- Backfill does not create a special migration-only revision. It becomes durable on the next normal CAS commit, avoiding a startup revision jump while remaining deterministic across restarts.
