import assert from "node:assert/strict";
import test from "node:test";

import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { legacyDatasetFixture } from "./helpers.mjs";

test("migrates v2 without mutating or overwriting it", () => {
  const v2 = legacyDatasetFixture();
  const before = structuredClone(v2);

  const result = migrateDatasetV2ToV3(v2, 2_000_000_000_000);

  assert.deepEqual(v2, before);
  assert.equal(result.dataset.formatVersion, 3);
  assert.equal(result.dataset.rules[0].conditionId, result.dataset.conditions[0].id);
  assert.equal(result.dataset.effectGroups[0].fieldEffects.length, 2);
});

test("preserves legacy rule field, delta, and effect imports", () => {
  const result = migrateDatasetV2ToV3(legacyDatasetFixture(), 2_000_000_000_000);
  const action = result.dataset.rules[0].actions[0];

  assert.deepEqual(action, {
    kind: "change_field",
    fieldId: "field_affinity",
    target: { kind: "all_bound" },
    delta: 4,
    effectGroupIds: ["effect_group_effect_warm"],
  });
});

test("converts legacy temporary targets into field-first group effects and active instances", () => {
  const result = migrateDatasetV2ToV3(legacyDatasetFixture(), 2_000_000_000_000);
  const group = result.dataset.effectGroups[0];

  assert.deepEqual(group.fieldEffects.map((effect) => effect.fieldId), [
    "field_affinity",
    "field_excite",
  ]);
  assert.deepEqual(group.fieldEffects[0].actorSelector, { kind: "selected", actorIds: ["actor_t"] });
  assert.deepEqual(group.fieldEffects[0].operations, [{
    kind: "all_multiplier",
    value: 1.25,
    sources: ["manual", "natural", "per_turn", "rule", "ai"],
  }]);
  assert.deepEqual(result.dataset.activeEffects[0].resolvedTargets, [
    { fieldId: "field_affinity", actorId: "actor_t", scope: "character", scopeKey: "character:actor_t" },
    { fieldId: "field_excite", actorId: "actor_t", scope: "character", scopeKey: "character:actor_t" },
  ]);
  assert.equal("triggerActorId" in result.dataset.activeEffects[0], false);
});

test("creates reusable condition definitions with deterministic migration output", () => {
  const v2 = legacyDatasetFixture();
  const first = migrateDatasetV2ToV3(v2, 2_000_000_000_000);
  const retry = migrateDatasetV2ToV3(v2, 2_000_000_000_000);

  assert.deepEqual(first, retry);
  assert.deepEqual(first.dataset.conditions[0].expression, {
    kind: "predicate",
    predicate: { kind: "recent_positive", count: 6 },
  });
  assert.deepEqual(first.report, {
    migratedFields: 2,
    migratedRules: 1,
    migratedConditions: 1,
    migratedEffectGroups: 1,
    warnings: [],
  });
});
