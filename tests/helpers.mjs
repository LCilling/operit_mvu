export function legacyDatasetFixture() {
  return {
    formatVersion: 2,
    createdAt: 1_700_000_000_000,
    revision: 4,
    settings: { aiEnabled: true },
    fields: [
      fieldFixture("field_affinity", "Affinity", 0),
      fieldFixture("field_excite", "Excitement", 1),
    ],
    pendingBootstrapFieldIds: [],
    rules: [],
    autoRules: [{
      id: "auto_positive",
      name: "Positive interaction",
      description: "Recent messages are positive.",
      enabled: true,
      condition: { kind: "recentPositive", count: 6 },
      effects: [{
        fieldId: "field_affinity",
        delta: 4,
        temporaryEffectIds: ["effect_warm"],
      }],
      cooldownMs: 21_600_000,
      order: 1,
    }],
    temporaryEffects: [effectFixture()],
    stateValues: {},
    records: [],
    lastSettled: {},
    turnCounters: {},
    processedMessageIds: [],
    ruleLastTriggered: {},
    messageFacts: {},
  };
}

export function conditionContextFixture(overrides = {}) {
  return {
    actorId: "actor_t",
    groupId: "group_main",
    chatId: "chat_main",
    now: "2033-05-18T03:33:20.000Z",
    fieldValues: { field_affinity: 30, field_excite: 20 },
    messageFacts: [],
    currentMessage: null,
    ...overrides,
  };
}

export function effectFixture(overrides = {}) {
  return {
    id: "effect_warm",
    targets: [
      { fieldId: "field_affinity", scope: "character", scopeKey: "character:actor_t" },
      { fieldId: "field_excite", scope: "character", scopeKey: "character:actor_t" },
    ],
    mode: "multiplier",
    value: 1.25,
    enabled: true,
    expiresAt: 1_700_000_360_000,
    remainingTurns: null,
    reasonMode: "template",
    reasonTemplate: "positive",
    reason: "",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function largeDatasetFixture() {
  const dataset = legacyDatasetFixture();
  dataset.fields = Array.from({ length: 500 }, (_, index) =>
    fieldFixture(`field_${index}`, `Field ${index}`, index)
  );
  dataset.autoRules = Array.from({ length: 1_000 }, (_, index) => ({
    id: `auto_${index}`,
    name: `Rule ${index}`,
    description: "Large fixture rule.",
    enabled: true,
    condition: { kind: "recentPositive", count: index + 1 },
    effects: [{ fieldId: `field_${index % 500}`, delta: 1, temporaryEffectIds: [] }],
    cooldownMs: 0,
    order: index,
  }));
  dataset.temporaryEffects = [];
  dataset.records = Array.from({ length: 100_000 }, (_, index) => ({
    id: `record_${index}`,
    scope: "character",
    scopeKey: "character:actor_t",
    fieldId: `field_${index % 500}`,
    fieldName: `Field ${index % 500}`,
    actorId: "actor_t",
    actorName: "T",
    chatId: "chat_main",
    groupId: "group_main",
    before: 0,
    after: 1,
    requestedDelta: 1,
    effectiveRequestedDelta: 1,
    delta: 1,
    stageBefore: "Low",
    stageAfter: "Low",
    reason: "fixture",
    source: "rule",
    ruleIds: [],
    effectIds: [],
    confidence: null,
    messageId: null,
    variantId: null,
    occurredAt: 1_700_000_000_000 + index,
  }));
  return dataset;
}

export function createFakeFiles(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  return {
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, value) {
      files.set(path, value);
    },
    async remove(path) {
      files.delete(path);
    },
    snapshot() {
      return Object.fromEntries(files);
    },
  };
}

function fieldFixture(id, name, order) {
  return {
    id,
    name,
    description: `${name} description.`,
    minimum: 0,
    maximum: 100,
    step: 1,
    initialValue: 0,
    icon: "Favorite",
    themeColor: "#ff4f87",
    enabled: true,
    scope: "character",
    modelVisibility: "full",
    ai: { enabled: false, minConfidence: 0.7, maxDelta: 10, prompt: "" },
    stages: [{ id: "stage_low", name: "Low", description: "Low.", threshold: 0 }],
    bindingIds: ["actor_t"],
    naturalChange: { enabled: false, unitMs: 3_600_000, amount: 0 },
    perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" },
    order,
  };
}
