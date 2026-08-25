# Task 7 Report — Four-section UI shell and safe mobile layout

## Outcome

Task 7 is implemented on `codex/mvu-v3-complete-redesign`.

- Production commit: `2c2ccb1d03d649ade9aff0a7897d257c19c07612`
- Review fix A: `4129d58` — runtime contracts, validated DTO recovery, group projection and app-owned navigation.
- Review fix B: `139d4d2` — range/stage restoration, context-first paging and bounded field-detail records.
- Review fix C: `d37e64e` — mobile accessibility, focus/transition behavior, avatar/background hardening and responsive audits.
- Subject: `feat: rebuild MVU four-section UI shell`
- Base: `ab6d927`
- Release metadata/version: unchanged by this task.

The old 4,479-line monolithic UI was replaced by a shared runtime, component layer, four page modules, and a small boot/event-delegation entry point. The frontend now consumes Task 6's compact snapshot and bounded query contract rather than legacy full arrays.

## Independent-review remediation

The Task 7 review fixes were delivered as three focused code commits.

1. Runtime contracts/navigation (`4129d58`): import sends `{json}`, export consumes `{fileName,savedPath}`, group selection reloads an authoritative group snapshot and member directory, direct child back stays inside the app-owned route tree, and every compact/query DTO kind has structural validation plus recovery UI.
2. Range/stage/context (`139d4d2`): restored dirty/disabled range editing, finite/min-max/precision/stage-spacing checks and proportional preview; status filtering now precedes five-item paging; field detail requests records by exact `fieldId + scopeKey`, page size 10, while indexed 100,000-record storage reads remain bounded.
3. Accessibility/visual (`d37e64e`): removed WebView `textZoom: 100`, restored scalable viewport metadata, added drawer focus enter/trap/restore/Escape, unique segmented transition identities and roving keyboard tabs, safe avatar URI schemes, CSS-only default background restore, and a 130% text-only browser fixture.

Browser-discovered RED cases also fixed stale demo condition discriminants, a 4.5px edge-stage anchor offset, async tab focus loss, and the non-functional default/custom reason tabs.

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
- Full Node suite after review remediation: `149` passed / `0` failed.
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

The review-remediation pass then exercised the production build at `320`, `360`, `393`, and `430` CSS pixels, plus a test-only 130% text scale that multiplies font declarations without changing production geometry.

- All widths: document horizontal overflow `0px`; segmented and bottom-navigation text overflow `0px`.
- At 130%: bottom action font measured `19.5px`; both actions remained one line with `0px` x/y overflow at every width.
- Bottom action/navigation overlap: `0px` at every width and scale.
- Stage→trend gap: `11.99px` at every width and scale.
- Stage dot error from exact normalized threshold: `0–0.01px` after the edge-anchor fix (previously about `4.5px`).
- Drawer: first control receives focus; forward/reverse Tab wrap; Escape closes and restores focus to `打开菜单`.
- Segmented controls: ArrowLeft/ArrowRight changes selection and restores focus after asynchronous group reload; reason mode switches its owned panel.
- One Impeccable detector pass over all production UI targets returned `[]`.
- Self-contained bundle: `9,150,635` bytes.

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
- The local 320/360/393/430px plus 130% text matrix is complete. Modified-APK installation, Android system-font validation and MuMu/real-host acceptance remain Task 11 release gates because they require the assembled OperitAI package rather than the browser demo bridge.
- No release metadata or the `3.0.0` release target was changed by Task 7 remediation.
