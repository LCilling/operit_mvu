import assert from "node:assert/strict";
import test from "node:test";

import {
  activateEffectGroup,
  applyActiveEffects,
  hydrateLegacyActiveEffectSnapshots,
} from "../dist/mvu/app/effect-engine.js";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { legacyDatasetFixture } from "./helpers.mjs";

const NOW = "2033-05-18T03:33:20.000Z";

function field() {
  return {
    id: "field_desire",
    name: "Desire",
    scope: "character",
    bindingIds: ["T"],
    minimum: 0,
    maximum: 100,
    step: 1,
    initialValue: 20,
    enabled: true,
  };
}

function definition(multiplier = 0.5) {
  return {
    id: "effect_desire",
    name: "Original name",
    description: "Original definition",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_desire",
      fieldId: "field_desire",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "positive_multiplier", value: multiplier, sources: ["rule"] }],
    }],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("active instances snapshot definition data and ignore later group edits", () => {
  const original = definition();
  const activation = activateEffectGroup({
    definition: original,
    fields: [field()],
    triggerActorId: "T",
    instanceId: "active_desire",
    activatedAt: NOW,
    reason: { mode: "custom", template: "general", text: "T triggered B" },
  });
  assert.deepEqual(activation.instances[0].definitionSnapshot, {
    name: "Original name",
    description: "Original definition",
    updatedAt: NOW,
    fieldEffects: original.fieldEffects,
  });

  const edited = definition(3);
  edited.name = "Edited name";
  edited.enabled = false;
  edited.updatedAt = "2033-05-19T03:33:20.000Z";
  const applied = applyActiveEffects({
    field: field(),
    actorId: "T",
    source: "rule",
    sourceDelta: 10,
    currentValue: 20,
    activeEffects: activation.instances,
    effectGroups: [edited],
  });

  assert.equal(applied.effectiveDelta, 5);
  assert.deepEqual(applied.reasons, [{ mode: "custom", template: "general", text: "T triggered B" }]);
});

test("v2 migration creates immutable snapshots for every active effect", () => {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), Date.parse(NOW)).dataset;
  assert.ok(migrated.activeEffects.length > 0);
  for (const instance of migrated.activeEffects) {
    assert.equal(typeof instance.definitionSnapshot?.name, "string");
    assert.ok(instance.definitionSnapshot.fieldEffects.length > 0);
  }
});

test("legacy v3 instances are hydrated once and then remain immune to definition edits", () => {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), Date.parse(NOW)).dataset;
  const instance = migrated.activeEffects[0];
  delete instance.definitionSnapshot;
  hydrateLegacyActiveEffectSnapshots(migrated);
  assert.equal(instance.definitionSnapshot.name, migrated.effectGroups[0].name);

  const target = instance.resolvedTargets[0];
  const targetField = migrated.fields.find((candidate) => candidate.id === target.fieldId);
  const group = migrated.effectGroups.find((candidate) => candidate.id === instance.definitionId);
  const beforeEdit = applyActiveEffects({
    field: targetField,
    actorId: target.actorId,
    scopeKey: target.scopeKey,
    source: "rule",
    sourceDelta: 8,
    currentValue: 20,
    activeEffects: [instance],
    effectGroups: [group],
  });
  group.fieldEffects[0].operations[0].value = 4;
  group.enabled = false;
  const afterEdit = applyActiveEffects({
    field: targetField,
    actorId: target.actorId,
    scopeKey: target.scopeKey,
    source: "rule",
    sourceDelta: 8,
    currentValue: 20,
    activeEffects: [instance],
    effectGroups: [group],
  });
  assert.equal(afterEdit.effectiveDelta, beforeEdit.effectiveDelta);
});
