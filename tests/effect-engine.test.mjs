import assert from "node:assert/strict";
import test from "node:test";

import {
  activateEffectGroup,
  applyActiveEffects,
  resolveEffectReason,
} from "../dist/mvu/app/effect-engine.js";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { assertMvuDatasetV3 } from "../dist/mvu/app/validation.js";
import { legacyDatasetFixture } from "./helpers.mjs";

const NOW = "2033-05-18T03:33:20.000Z";

function characterField(overrides = {}) {
  return {
    id: "A",
    name: "Desire",
    scope: "character",
    bindingIds: ["T", "U", "V"],
    minimum: 0,
    maximum: 100,
    step: 1,
    initialValue: 50,
    enabled: true,
    ...overrides,
  };
}

function group(fieldEffects, overrides = {}) {
  return {
    id: "effect_group_desire",
    name: "Rain walk",
    description: "A calming shared event.",
    enabled: true,
    fieldEffects,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function triggerActorGroup() {
  return group([{
    id: "field_effect_desire",
    fieldId: "A",
    actorSelector: { kind: "trigger_actor" },
    operations: [
      { kind: "immediate_delta", value: -30 },
      { kind: "positive_multiplier", value: 0.5, sources: ["rule"] },
    ],
  }]);
}

function applyFor(actorId, sourceDelta, instances, definition, field = characterField()) {
  return applyActiveEffects({
    field,
    actorId,
    source: "rule",
    sourceDelta,
    currentValue: field.initialValue,
    activeEffects: instances,
    effectGroups: [definition],
  });
}

test("T event changes only T and preserves U and V", () => {
  const definition = triggerActorGroup();
  const activation = activateEffectGroup({
    definition,
    fields: [characterField()],
    triggerActorId: "T",
    instanceId: "active_t",
    activatedAt: NOW,
    reason: { mode: "template", template: "positive" },
  });

  assert.deepEqual(activation.immediateChanges, [{ actorId: "T", fieldId: "A", delta: -30 }]);
  assert.deepEqual(activation.instances[0].resolvedTargets, [{
    fieldId: "A", actorId: "T", scope: "character", scopeKey: "character:T",
  }]);
  assert.equal(applyFor("T", 10, activation.instances, definition).effectiveDelta, 5);
  assert.equal(applyFor("U", 10, activation.instances, definition).effectiveDelta, 10);
  assert.equal(applyFor("V", 10, activation.instances, definition).effectiveDelta, 10);
});

test("missing trigger actor skips dynamic targets and emits a diagnostic instead of broadening", () => {
  const activation = activateEffectGroup({
    definition: triggerActorGroup(),
    fields: [characterField()],
    instanceId: "active_missing_actor",
    activatedAt: NOW,
    reason: { mode: "template", template: "positive" },
  });

  assert.deepEqual(activation.instances, []);
  assert.deepEqual(activation.immediateChanges, []);
  assert.deepEqual(activation.diagnostics, [{
    code: "MVU_EFFECT_TRIGGER_ACTOR_MISSING",
    definitionId: "effect_group_desire",
    fieldEffectId: "field_effect_desire",
  }]);
});

test("a missing trigger actor cancels an entire mixed-selector group activation", () => {
  const fields = [
    characterField(),
    characterField({ id: "B", name: "Calm" }),
    characterField({ id: "C", name: "Focus" }),
  ];
  const definition = group([
    {
      id: "field_effect_all_bound",
      fieldId: "A",
      actorSelector: { kind: "all_bound" },
      operations: [{ kind: "immediate_delta", value: 5 }],
    },
    {
      id: "field_effect_selected",
      fieldId: "B",
      actorSelector: { kind: "selected", actorIds: ["T", "U"] },
      operations: [{ kind: "immediate_delta", value: 7 }],
    },
    {
      id: "field_effect_required_trigger",
      fieldId: "C",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: -30 }],
    },
  ]);

  const activation = activateEffectGroup({
    definition, fields, instanceId: "active_atomic_missing", activatedAt: NOW,
    reason: { mode: "template", template: "general" },
  });

  assert.deepEqual(activation.instances, []);
  assert.deepEqual(activation.immediateChanges, []);
  assert.deepEqual(activation.diagnostics, [{
    code: "MVU_EFFECT_TRIGGER_ACTOR_MISSING",
    definitionId: "effect_group_desire",
    fieldEffectId: "field_effect_required_trigger",
  }]);
});

test("activates one multi-field group with independent per-field selectors and operations", () => {
  const desire = characterField();
  const calm = characterField({ id: "B", name: "Calm" });
  const definition = group([
    {
      id: "field_effect_desire_trigger",
      fieldId: "A",
      actorSelector: { kind: "trigger_actor" },
      operations: [
        { kind: "immediate_delta", value: -30 },
        { kind: "positive_multiplier", value: 0.5, sources: ["rule"] },
      ],
    },
    {
      id: "field_effect_calm_all",
      fieldId: "B",
      actorSelector: { kind: "all_bound" },
      operations: [{ kind: "fixed_adjustment", value: 2, sources: ["rule"] }],
    },
  ]);
  const activation = activateEffectGroup({
    definition, fields: [desire, calm], triggerActorId: "T", instanceId: "active_multi_field", activatedAt: NOW,
    reason: { mode: "template", template: "general" },
  });

  assert.deepEqual(activation.immediateChanges, [{ actorId: "T", fieldId: "A", delta: -30 }]);
  assert.deepEqual(activation.instances[0].resolvedTargets, [
    { fieldId: "A", actorId: "T", scope: "character", scopeKey: "character:T" },
    { fieldId: "B", actorId: "T", scope: "character", scopeKey: "character:T" },
    { fieldId: "B", actorId: "U", scope: "character", scopeKey: "character:U" },
    { fieldId: "B", actorId: "V", scope: "character", scopeKey: "character:V" },
  ]);
  assert.equal(applyFor("T", 10, activation.instances, definition, desire).effectiveDelta, 5);
  assert.equal(applyFor("U", 10, activation.instances, definition, desire).effectiveDelta, 10);
  assert.equal(applyFor("T", 10, activation.instances, definition, calm).effectiveDelta, 12);
  assert.equal(applyFor("U", 10, activation.instances, definition, calm).effectiveDelta, 12);
});

test("resolves all-bound non-character fields to exact scope keys", () => {
  const field = characterField({ scope: "group", bindingIds: ["G"], initialValue: 20 });
  const definition = group([{
    id: "field_effect_group",
    fieldId: "A",
    actorSelector: { kind: "all_bound" },
    operations: [{ kind: "all_multiplier", value: 2, sources: ["rule"] }],
  }], { id: "effect_group_group", name: "Group effect" });
  const activation = activateEffectGroup({
    definition, fields: [field], instanceId: "active_group", activatedAt: NOW,
    reason: { mode: "template", template: "general" },
  });

  assert.deepEqual(activation.instances[0].resolvedTargets, [{
    fieldId: "A", actorId: null, scope: "group", scopeKey: "group:G",
  }]);
  assert.equal(applyActiveEffects({
    field, actorId: null, scopeKey: "group:G", source: "rule", sourceDelta: 5, currentValue: 20,
    activeEffects: activation.instances, effectGroups: [definition],
  }).effectiveDelta, 10);
});

test("applies fixed adjustment, directional multiplier, general multiplier, then step and bounds", () => {
  const field = characterField({ minimum: 0, maximum: 200, step: 1, initialValue: 10 });
  const definition = group([{
    id: "field_effect_order",
    fieldId: "A",
    actorSelector: { kind: "selected", actorIds: ["T"] },
    operations: [
      { kind: "fixed_adjustment", value: 3, sources: ["rule"] },
      { kind: "positive_multiplier", value: 2, sources: ["rule"] },
      { kind: "negative_multiplier", value: 0.5, sources: ["rule"] },
      { kind: "all_multiplier", value: 4, sources: ["rule"] },
      { kind: "positive_multiplier", value: 100, sources: ["ai"] },
    ],
  }]);
  const activation = activateEffectGroup({
    definition,
    fields: [field],
    instanceId: "active_order",
    activatedAt: NOW,
    reason: { mode: "template", template: "general" },
  });

  assert.equal(applyFor("T", 10, activation.instances, definition, field).effectiveDelta, 104);
  assert.equal(applyFor("T", -8, activation.instances, definition, field).effectiveDelta, -10);
  assert.equal(applyFor("T", 0, activation.instances, definition, field).effectiveDelta, 12);

  const steppedField = characterField({ minimum: 0, maximum: 100, step: 5, initialValue: 14 });
  assert.equal(applyFor("T", -8, activation.instances, definition, steppedField).effectiveDelta, -9);
});

test("orders operations across simultaneously active groups by operation kind", () => {
  const field = characterField({ minimum: 0, maximum: 100, initialValue: 0 });
  const multiplierDefinition = group([{
    id: "field_effect_multiplier",
    fieldId: "A",
    actorSelector: { kind: "selected", actorIds: ["T"] },
    operations: [{ kind: "positive_multiplier", value: 2, sources: ["rule"] }],
  }], { id: "effect_group_multiplier", name: "Multiplier" });
  const adjustmentDefinition = group([{
    id: "field_effect_adjustment",
    fieldId: "A",
    actorSelector: { kind: "selected", actorIds: ["T"] },
    operations: [{ kind: "fixed_adjustment", value: 3, sources: ["rule"] }],
  }], { id: "effect_group_adjustment", name: "Adjustment" });
  const multiplier = activateEffectGroup({
    definition: multiplierDefinition, fields: [field], instanceId: "active_multiplier", activatedAt: NOW,
    reason: { mode: "template", template: "general" },
  });
  const adjustment = activateEffectGroup({
    definition: adjustmentDefinition, fields: [field], instanceId: "active_adjustment", activatedAt: NOW,
    reason: { mode: "template", template: "general" },
  });

  const applied = applyActiveEffects({
    field, actorId: "T", source: "rule", sourceDelta: 10, currentValue: 0,
    activeEffects: [...multiplier.instances, ...adjustment.instances],
    effectGroups: [multiplierDefinition, adjustmentDefinition],
  });

  assert.equal(applied.effectiveDelta, 26);
});

test("normalizes immediate deltas after resolving exact targets without reapplying future operations", () => {
  const field = characterField({ minimum: 0, maximum: 100, step: 5, initialValue: 98 });
  const definition = group([{
    id: "field_effect_immediate",
    fieldId: "A",
    actorSelector: { kind: "selected", actorIds: ["T"] },
    operations: [
      { kind: "immediate_delta", value: 4 },
      { kind: "all_multiplier", value: 100, sources: ["rule"] },
    ],
  }]);

  const activation = activateEffectGroup({
    definition,
    fields: [field],
    instanceId: "active_immediate",
    activatedAt: NOW,
    reason: { mode: "template", template: "general" },
    currentValues: { "character:T\u0000A": 98 },
  });

  assert.deepEqual(activation.immediateChanges, [{ actorId: "T", fieldId: "A", delta: 2 }]);
});

test("normalizes a field change even when no active effect target applies", () => {
  const field = characterField({ minimum: 0, maximum: 100, step: 5, initialValue: 98 });
  const applied = applyActiveEffects({
    field, actorId: null, source: "rule", sourceDelta: 5, currentValue: 98,
    activeEffects: [], effectGroups: [],
  });

  assert.deepEqual(applied, {
    requestedDelta: 5,
    effectiveDelta: 2,
    nextValue: 100,
    effectIds: [],
    reasons: [],
  });
});

test("renders template and custom reasons as immutable safe snapshots", () => {
  assert.deepEqual(resolveEffectReason({
    reason: { mode: "template", template: "positive" },
    variables: { triggerActorName: "T", effectGroupName: "Rain walk", fieldName: "Desire", event: "message" },
  }), {
    mode: "template",
    template: "positive",
    text: "临时增益",
  });
  assert.deepEqual(resolveEffectReason({
    reason: { mode: "custom", template: "general", text: "{{triggerActorName}}: {{effectGroupName}} → {{fieldName}} ({{event}}) {{constructor}}" },
    variables: { triggerActorName: "T", effectGroupName: "Rain walk", fieldName: "Desire", event: "message" },
  }), {
    mode: "custom",
    template: "general",
    text: "T: Rain walk → Desire (message) {{constructor}}",
  });
});

test("rejects blank custom reason text before activating an effect instance", () => {
  assert.throws(() => activateEffectGroup({
    definition: triggerActorGroup(),
    fields: [characterField()],
    triggerActorId: "T",
    instanceId: "active_blank_reason",
    activatedAt: NOW,
    reason: { mode: "custom", template: "general", text: "  " },
  }), /MVU_EFFECT_REASON_EMPTY/);
});

test("migrates same-field multi-actor v2 effects into one field-first definition", () => {
  const legacy = legacyDatasetFixture();
  legacy.fields[0].bindingIds = ["actor_t", "actor_u"];
  legacy.temporaryEffects[0].targets = [
    { fieldId: "field_affinity", scope: "character", scopeKey: "character:actor_t" },
    { fieldId: "field_affinity", scope: "character", scopeKey: "character:actor_u" },
  ];

  const first = migrateDatasetV2ToV3(legacy, Date.parse(NOW)).dataset;
  const retry = migrateDatasetV2ToV3(legacy, Date.parse(NOW)).dataset;

  assert.deepEqual(first, retry);
  assert.deepEqual(first.effectGroups[0].fieldEffects, [{
    id: "field_effect_effect_warm_0",
    fieldId: "field_affinity",
    actorSelector: { kind: "selected", actorIds: ["actor_t", "actor_u"] },
    operations: [{ kind: "all_multiplier", value: 1.25, sources: ["manual", "natural", "per_turn", "rule", "ai"] }],
  }]);
  assert.deepEqual(first.activeEffects[0].resolvedTargets, [
    { fieldId: "field_affinity", actorId: "actor_t", scope: "character", scopeKey: "character:actor_t" },
    { fieldId: "field_affinity", actorId: "actor_u", scope: "character", scopeKey: "character:actor_u" },
  ]);
});

test("validates field-first effect operations and resolved active targets", () => {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), Date.parse(NOW)).dataset;
  const duplicateField = structuredClone(migrated);
  duplicateField.effectGroups[0].fieldEffects.push({
    ...structuredClone(duplicateField.effectGroups[0].fieldEffects[0]),
    id: "field_effect_duplicate",
  });
  assert.throws(() => assertMvuDatasetV3(duplicateField), /MVU_V3_EFFECT_FIELD_DUPLICATE/);

  const invalidSource = structuredClone(migrated);
  invalidSource.effectGroups[0].fieldEffects[0].operations[0].sources = ["invalid_source"];
  assert.throws(() => assertMvuDatasetV3(invalidSource), /MVU_V3_EFFECT_OPERATION_INVALID/);

  const invalidTarget = structuredClone(migrated);
  invalidTarget.activeEffects[0].resolvedTargets[0].scopeKey = "character:actor_u";
  assert.throws(() => assertMvuDatasetV3(invalidTarget), /MVU_V3_ACTIVE_EFFECT_TARGET_INVALID/);
});
