# Task 7 Report — Four-section UI shell and safe mobile layout

## Outcome

Task 7 is implemented on `codex/mvu-v3-complete-redesign`.

- Production commit: `2c2ccb1d03d649ade9aff0a7897d257c19c07612`
- Subject: `feat: rebuild MVU four-section UI shell`
- Base: `ab6d927`
- Release metadata/version: unchanged by this task.

The old 4,479-line monolithic UI was replaced by a shared runtime, component layer, four page modules, and a small boot/event-delegation entry point. The frontend now consumes Task 6's compact snapshot and bounded query contract rather than legacy full arrays.

## Impeccable workflow

Before UI edits:

1. Read the complete Impeccable skill.
2. Ran its context command once against `static/app_ui/app.js`.
3. Read `reference/operate.md` and `reference/craft-floor.md`.
4. Treated `docs/DESIGN.md` as the visual authority and recorded the concrete Operate constraints at the top of `scripts/audit-v3-ui.mjs`.
5. Kept body type at `14px`, retained 44px touch targets, used restrained state color, normal mobile affordances, recoverable errors and reduced-motion behavior.

The final one-shot detector command covered every changed UI target and returned `[]`.

## TDD RED evidence

Initial contract audit:

```text
node scripts/audit-v3-ui.mjs
```

- FAIL with 33 expected violations.
- The failure included missing modules, old five-item navigation, absolute bottom layout, no compact snapshot adapter, no fixed-range trend contract and no uniform detail stack.

Browser-discovered interaction regression:

- The first mobile pass showed that clicking `群组状态` did not switch modes.
- A new audit assertion failed because `.app-screen` reused the delegated `data-route` action attribute.
- After changing the container to `data-current-route`, the group selector rendered and the actor row disappeared.

Additional focused RED checks caught:

- a segmented-control variant reducing the shared body font size;
- stale full-entity cache retention across snapshot revisions;
- loss of the 1600px / JPEG 0.88 custom-background pipeline;
- drawer content clicks bubbling into the overlay close action;
- new rule/condition/effect buttons not opening their owning child editors.

Each check failed before its corresponding production change and passed afterward.

## GREEN evidence

```text
node scripts/audit-v3-ui.mjs
pnpm run build:web
pnpm run check
git diff --check
```

- V3 UI audit: PASS (`7` modules, `4` roots).
- Compatibility/accessibility/bridge UI audit: PASS (`46` bridge cases).
- Self-contained build: PASS, `dist/app.html` contains the modules in dependency order and no external script/style/asset reference.
- TypeScript: PASS.
- Temporary-effect regression audit: PASS.
- Full Node suite: `134` passed / `0` failed.
- `git diff --check`: PASS.

The persistence suite continues to print its intentional failure-injection diagnostics while all assertions pass.

## Visual verification

A bounded local browser pass used the built `dist/app.html?demo=1` at `393×852`.

- Exactly four bottom roots rendered: 状态 / 配置 / 规则 / 高级.
- Bottom navigation computed `position: static`.
- Group mode rendered one horizontal `.group-selector` and zero `.actor-selector` rows.
- Field detail card gaps measured `11.99px` for value→stage, stage→trend, trend→recent and recent→description.
- The contextual action row ended exactly where the navigation row began; measured overlap was `0`.
- The back target computed a transparent background and remained 44×44px.
- Trend rendering used the exact `0–100` field range and showed the current value at `48`, matching the stage/value projection rather than recent-sample autoscaling.
- No evident overlap, clipped title or inconsistent stage/trend seam remained in the inspected viewport.

The pass found and fixed the delegated `data-route` ancestor collision described above. The confirmation pass was clean.

## Architecture and behavior

1. `window.MvuUi` is the only frontend namespace. It owns state, native calls, components, pages, route metadata, navigation and rendering.
2. Root routes use hamburger headers; every child/detail/editor route has a 44px pure unframed back arrow and an explicit owning root.
3. Browser history is preserved. Direct child entry falls back to its owning root.
4. `.app-screen` uses `auto minmax(0, 1fr) auto auto`; contextual actions and bottom navigation stay in normal flow.
5. Compact snapshots are strictly validated. Queries validate item/count/cursor shape. Malformed data shows readable retry/reload states instead of attempting a legacy-array fallback.
6. Snapshot revision changes invalidate cached full entities so edits cannot display stale definitions.
7. Status supports character/group modes, horizontal actor/group controls and multiple group switching. Group mode never renders the role row.
8. Field detail value, stage and trend share the exact field minimum/maximum. Stage thresholds and colors are reused by the canvas; points and a current label preserve small-delta readability without autoscaling.
9. The value, stage, trend, recent changes and status-description cards live in one `gap: 12px` stack with no negative margins or seam collapse.
10. Advanced owns appearance/import/export; the drawer exposes only the same four information-architecture roots.
11. Custom backgrounds remain bounded to a 1600px longest edge and encoded as JPEG at 0.88 quality.
12. Segmented and route content transitions use 180–220ms motion and honor `prefers-reduced-motion`.

## Files

Added:

- `static/app_ui/runtime.js`
- `static/app_ui/components.js`
- `static/app_ui/pages-status.js`
- `static/app_ui/pages-config.js`
- `static/app_ui/pages-rules.js`
- `static/app_ui/pages-advanced.js`
- `scripts/audit-v3-ui.mjs`

Rebuilt or updated:

- `static/app_ui/app.js`
- `static/app_ui/styles.css`
- `static/app_ui/index.html`
- `scripts/build-web.mjs`
- `scripts/audit-web-ui.mjs`
- `package.json`

## Residual boundaries for later tasks

- Task 8 owns live server-backed pagination, debounced searching, virtual picker windows, invisible cursor fetching and interactive result counts. Task 7 renders the bounded first pages and shared shell only; it does not expose a user-facing “加载更多”.
- Task 9 owns complete save/delete/reference behavior for field, condition, rule and effect-group editors. Task 7 establishes their route ownership, hierarchy and approved controls; unfinished save actions remain disabled rather than issuing partial or incompatible writes.
- Task 10 owns migration retry/default-condition restoration/diagnostic commands and model-budget counts. Task 7 keeps those maintenance surfaces visibly subordinate and disabled until their typed commands exist.
- The full 320/360/393/430px plus 130% text matrix and modified-APK acceptance remain Task 11 release gates. This task completed the explicitly requested one bounded local mobile inspection.
