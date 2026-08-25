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

/** Map-backed implementation of the complete MvuFileApi contract. */
export function createFakeMvuFileApi(initialFiles = {}, options = {}) {
  const files = new Map(Object.entries(initialFiles));
  const directories = new Set();
  const failures = [];
  const barriers = [];
  const operations = [];
  const partialReadLineLimit = options.partialReadLineLimit ?? Number.POSITIVE_INFINITY;

  function failIfRequested(operation, details) {
    const index = failures.findIndex((failure) =>
      failure.operation === operation && failure.matches(details));
    if (index < 0) return;
    const [failure] = failures.splice(index, 1);
    throw failure.error;
  }

  function requireFile(path) {
    const content = files.get(path);
    if (content === undefined) throw new Error(`FAKE_FILE_NOT_FOUND:${path}`);
    return content;
  }

  async function waitAtBarrier(operation, details) {
    const index = barriers.findIndex((barrier) =>
      barrier.operation === operation && barrier.matches(details));
    if (index < 0) return;
    const [barrier] = barriers.splice(index, 1);
    barrier.enteredResolve();
    await barrier.releasePromise;
  }

  const api = {
    async exists(path) {
      failIfRequested("exists", { path });
      return files.has(path) || directories.has(path) ||
        [...files.keys()].some((candidate) => candidate.startsWith(`${path}/`));
    },
    async readText(path) {
      failIfRequested("readText", { path });
      operations.push({ operation: "readText", path });
      await waitAtBarrier("readText", { path });
      return requireFile(path);
    },
    async readTextPart(path, startLine, endLine) {
      failIfRequested("readTextPart", { path, startLine, endLine });
      operations.push({ operation: "readTextPart", path, startLine, endLine });
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) ||
        startLine < 1 || endLine < startLine) {
        throw new Error("FAKE_READ_PART_RANGE_INVALID");
      }
      const lines = requireFile(path).replace(/\r\n/g, "\n").split("\n");
      if (lines.at(-1) === "") lines.pop();
      const selected = lines.slice(startLine - 1, endLine);
      const truncated = selected.length > partialReadLineLimit;
      const visible = selected.slice(0, partialReadLineLimit);
      const width = Math.max(3, String(endLine).length);
      const decorated = visible.map((line, offset) =>
        `${String(startLine + offset).padStart(width, " ")}| ${line}`);
      if (truncated) decorated.push("... (file content truncated) ...");
      return decorated.join("\n");
    },
    async writeText(path, content) {
      failIfRequested("writeText", { path, content });
      operations.push({ operation: "writeText", path, content });
      await waitAtBarrier("writeText", { path, content });
      files.set(path, content);
      failIfRequested("writeTextAfterWrite", { path, content });
    },
    async appendText(path, content) {
      failIfRequested("appendText", { path, content });
      operations.push({ operation: "appendText", path, content });
      await waitAtBarrier("appendText", { path, content });
      files.set(path, (files.get(path) ?? "") + content);
      failIfRequested("appendTextAfterWrite", { path, content });
    },
    async move(source, destination) {
      failIfRequested("move", { source, destination });
      operations.push({ operation: "move", source, destination });
      await waitAtBarrier("move", { source, destination });
      const content = requireFile(source);
      files.set(destination, content);
      failIfRequested("moveAfterCopy", { source, destination });
      files.delete(source);
    },
    async replaceAtomically(source, destination) {
      failIfRequested("replaceAtomically", { source, destination });
      operations.push({ operation: "replaceAtomically", source, destination });
      await waitAtBarrier("replaceAtomically", { source, destination });
      const content = requireFile(source);
      files.set(destination, content);
      files.delete(source);
    },
    async deleteFile(path) {
      failIfRequested("deleteFile", { path });
      operations.push({ operation: "deleteFile", path });
      for (const candidate of [...files.keys()]) {
        if (candidate === path || candidate.startsWith(`${path}/`)) files.delete(candidate);
      }
      for (const candidate of [...directories]) {
        if (candidate === path || candidate.startsWith(`${path}/`)) directories.delete(candidate);
      }
    },
    async mkdir(path) {
      failIfRequested("mkdir", { path });
      operations.push({ operation: "mkdir", path });
      directories.add(path);
    },
    failNext(operation, matches = () => true, error = new Error(`FAKE_${operation.toUpperCase()}_FAILED`)) {
      failures.push({ operation, matches, error });
    },
    pauseNext(operation, matches = () => true) {
      let enteredResolve;
      let releaseResolve;
      const entered = new Promise((resolve) => {
        enteredResolve = resolve;
      });
      const releasePromise = new Promise((resolve) => {
        releaseResolve = resolve;
      });
      barriers.push({ operation, matches, enteredResolve, releasePromise });
      return { entered, release: releaseResolve };
    },
    clearOperations() {
      operations.length = 0;
    },
    operations() {
      return structuredClone(operations);
    },
    snapshot() {
      return Object.fromEntries(files);
    },
  };
  return api;
}

/** Retained for older test callers that only need the in-memory snapshot helpers. */
export const createFakeFiles = createFakeMvuFileApi;

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
