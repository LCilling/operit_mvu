import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  FULL_BACKUP_FORMAT,
  FULL_BACKUP_MAX_BYTES,
  FULL_BACKUP_MAX_RECORDS,
  FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  FULL_BACKUP_SCHEMA_VERSION,
  createDatasetImportPreview,
  createFullBackupExport,
  parseDatasetImport,
} from "../dist/mvu/app/full-backup.js";
import { createRuntime } from "../dist/mvu/app/index.js";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { V3MvuStore } from "../dist/mvu/app/store-v3.js";
import { FileMvuStore } from "../dist/mvu/app/store.js";
import {
  MVU_IPC,
  MVU_REQUEST_PARSERS,
  installMvuIpc,
  mvuIpcClient,
} from "../dist/shared/ipc.js";
import { createFakeMvuFileApi, legacyDatasetFixture } from "./helpers.mjs";

const NOW = Date.parse("2033-05-18T03:33:20.000Z");
const CONFIG_DIR = "/full-backup-config";
const V2_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v2.json`;
const V3_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v3.json`;
const CLEANUP_PATH = `${CONFIG_DIR}/operit_mvu.records.v3.cleanup.json`;
const RECORD_DIRECTORY = `${CONFIG_DIR}/operit_mvu.records.v3`;

function changeRecord(index, overrides = {}) {
  return {
    id: `record_${index}`,
    scope: "character",
    scopeKey: "character:actor_t",
    fieldId: "field_affinity",
    fieldName: "Affinity",
    actorId: "actor_t",
    actorName: "T",
    chatId: "chat_main",
    groupId: "group_main",
    before: index,
    after: index + 1,
    requestedDelta: 1,
    effectiveRequestedDelta: 1,
    delta: 1,
    stageBefore: "stage_low",
    stageAfter: "stage_low",
    reason: "full backup fixture",
    source: "rule",
    ruleIds: ["auto_positive"],
    effectIds: ["effect_warm"],
    confidence: null,
    messageId: `message_${index}`,
    variantId: null,
    occurredAt: NOW + index,
    ...overrides,
  };
}

function richV3Fixture() {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW).dataset;
  migrated.effectGroups[0].defaultReason = {
    mode: "custom",
    template: "general",
    text: "Native v3 default for {actorName}",
  };
  migrated.activeEffects[0].reason = {
    mode: "custom",
    template: "general",
    text: "Resolved active snapshot",
  };
  migrated.activeEffects[0].definitionSnapshot = {
    name: "Frozen warm effect",
    description: "Snapshot survives definition edits.",
    updatedAt: new Date(NOW).toISOString(),
    fieldEffects: structuredClone(migrated.effectGroups[0].fieldEffects),
  };
  migrated.stateValues = { "character:actor_t": { field_affinity: 42, field_excite: 17 } };
  migrated.lastSettled = { "character:actor_t": { field_affinity: NOW - 1_000 } };
  migrated.turnCounters = {
    "character:actor_t": { field_affinity: { userMessages: 7, characterMessages: 5 } },
  };
  migrated.ruleLastTriggered = { "character:actor_t": { [migrated.rules[0].id]: NOW - 2_000 } };
  migrated.messageFacts = {
    "character:actor_t": [{
      messageId: "message_fact_1",
      variantId: null,
      content: "A complete runtime fact.",
      chatId: "chat_main",
      actorId: "actor_t",
      groupId: "group_main",
      role: "user",
      occurredAt: NOW - 3_000,
      recentPositiveCount: 1,
      userCareDetected: true,
      lastInteractionAt: NOW - 4_000,
      messageCountInLast24Hours: 8,
      specialDayDetected: false,
    }],
  };
  migrated.hourlyMessageBuckets = {
    "character:actor_t": [{ startedAt: Math.floor(NOW / 3_600_000) * 3_600_000, messageCount: 8 }],
  };
  migrated.processedMessageIds = ["chat:value:chat_main|message:value:message_fact_1|variant:original:null"];
  return migrated;
}

function createV3Store(files, initial = legacyDatasetFixture()) {
  const legacyStore = new FileMvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    createInitialDataset: () => structuredClone(initial),
  });
  return new V3MvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    legacyStore,
    createInitialDataset: () => structuredClone(initial),
    now: () => NOW,
  });
}

function filesWithLegacy(dataset) {
  return createFakeMvuFileApi({ [V2_PATH]: JSON.stringify(dataset, null, 2) });
}

function withoutStoreOwnedMetadata(dataset) {
  const { revision: _revision, recordManifest: _manifest, ...config } = dataset;
  return config;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function resign(document) {
  const unsigned = {
    format: document.format,
    schemaVersion: document.schemaVersion,
    exportedAt: document.exportedAt,
    sourceFormatVersion: document.sourceFormatVersion,
    payload: document.payload,
  };
  document.checksum.value = createHash("sha256").update(canonicalJson(unsigned), "utf8").digest("hex");
  return document;
}

function reorder(value) {
  if (Array.isArray(value)) return value.map(reorder);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reorder(value[key])]));
}

test("full v3 envelope preserves native config/runtime data and logical records", () => {
  const dataset = richV3Fixture();
  const records = [changeRecord(0), changeRecord(1)];
  dataset.recordManifest = {
    segments: [{
      index: 41,
      fileName: "segment-000041.jsonl",
      committedLineCount: records.length,
      firstOccurredAt: records[0].occurredAt,
      lastOccurredAt: records.at(-1).occurredAt,
      firstRevision: dataset.revision,
      lastRevision: dataset.revision,
      filterCounts: { "field_affinity\u0000character:actor_t": records.length },
    }],
    recordCount: records.length,
    nextSegmentIndex: 42,
  };

  const exported = createFullBackupExport({ revision: dataset.revision, dataset, records }, NOW);
  const document = JSON.parse(exported.json);
  const parsed = parseDatasetImport(exported.json, NOW);

  assert.equal(document.format, FULL_BACKUP_FORMAT);
  assert.equal(document.schemaVersion, FULL_BACKUP_SCHEMA_VERSION);
  assert.equal(document.sourceFormatVersion, 3);
  assert.deepEqual(Object.keys(document.payload).sort(), ["config", "records", "sourceRevision"]);
  assert.equal(Object.hasOwn(document.payload.config, "recordManifest"), false);
  assert.equal(Object.hasOwn(document.payload.config, "revision"), false);
  assert.equal(exported.fileName, "operit-mvu-full-backup-v3-schema1-20330518-033320Z.json");
  assert.equal(parsed.kind, "full_v3");
  assert.equal(parsed.sourceRevision, dataset.revision);
  assert.deepEqual(parsed.config, document.payload.config);
  assert.deepEqual(parsed.records, records);
  assert.deepEqual(parsed.config.conditions, dataset.conditions);
  assert.deepEqual(parsed.config.rules, dataset.rules);
  assert.deepEqual(parsed.config.effectGroups, dataset.effectGroups);
  assert.deepEqual(parsed.config.activeEffects, dataset.activeEffects);
  assert.deepEqual(parsed.config.stateValues, dataset.stateValues);
  assert.deepEqual(exported.summary, {
    sourceRevision: dataset.revision,
    fieldCount: 2,
    conditionCount: 1,
    ruleCount: 1,
    effectGroupCount: 1,
    activeEffectCount: 1,
    recordCount: 2,
    byteCount: Buffer.byteLength(exported.json, "utf8"),
  });
});

test("full backup checksum is stable across object key ordering and whitespace", () => {
  const dataset = richV3Fixture();
  const exported = createFullBackupExport({ revision: dataset.revision, dataset, records: [] }, NOW);
  const reordered = JSON.stringify(reorder(JSON.parse(exported.json)), null, 7);

  const parsed = parseDatasetImport(reordered, NOW);

  assert.equal(parsed.kind, "full_v3");
  assert.deepEqual(parsed.config.effectGroups, dataset.effectGroups);
});

test("full backup rejects checksum tampering and re-signed unknown nested keys", () => {
  const dataset = richV3Fixture();
  const document = JSON.parse(createFullBackupExport({ revision: dataset.revision, dataset, records: [] }, NOW).json);
  document.payload.config.settings.aiEnabled = false;
  assert.throws(() => parseDatasetImport(JSON.stringify(document), NOW), /MVU_FULL_BACKUP_CHECKSUM_MISMATCH/);

  document.payload.config.settings.unexpected = true;
  resign(document);
  assert.throws(() => parseDatasetImport(JSON.stringify(document), NOW), /MVU_FULL_BACKUP_UNKNOWN_KEY/);
});

test("full backup rejects unknown schema versions, unsafe numbers, excessive depth, and duplicate record ids", () => {
  const dataset = richV3Fixture();
  const exported = createFullBackupExport({ revision: dataset.revision, dataset, records: [] }, NOW);
  const unknownVersion = JSON.parse(exported.json);
  unknownVersion.schemaVersion = 2;
  resign(unknownVersion);
  assert.throws(() => parseDatasetImport(JSON.stringify(unknownVersion), NOW), /MVU_FULL_BACKUP_SCHEMA_VERSION_UNSUPPORTED/);

  const unsafeNumber = exported.json.replace(`"sourceRevision": ${dataset.revision}`, '"sourceRevision": 1e400');
  assert.throws(() => parseDatasetImport(unsafeNumber, NOW), /MVU_FULL_BACKUP_UNSAFE_NUMBER/);

  const excessiveDepth = JSON.parse(exported.json);
  let nested = 0;
  for (let index = 0; index < 80; index += 1) nested = [nested];
  excessiveDepth.payload.config.stateValues = { nested };
  resign(excessiveDepth);
  assert.throws(() => parseDatasetImport(JSON.stringify(excessiveDepth), NOW), /MVU_FULL_BACKUP_DEPTH_LIMIT/);

  const duplicateRecords = JSON.parse(exported.json);
  duplicateRecords.payload.records = [changeRecord(1), changeRecord(1)];
  resign(duplicateRecords);
  assert.throws(() => parseDatasetImport(JSON.stringify(duplicateRecords), NOW), /MVU_FULL_BACKUP_RECORD_ID_DUPLICATE/);
});

test("full backup export rejects prototype-bearing nested configuration", () => {
  const dataset = richV3Fixture();
  dataset.settings = Object.assign(Object.create({ inherited: true }), { aiEnabled: true });

  assert.throws(
    () => createFullBackupExport({ revision: dataset.revision, dataset, records: [] }, NOW),
    /MVU_FULL_BACKUP_OBJECT_NOT_PLAIN/,
  );
});

test("full backup enforces one import/export byte and record bound", () => {
  assert.throws(
    () => parseDatasetImport(" ".repeat(FULL_BACKUP_MAX_BYTES + 1), NOW),
    /MVU_FULL_BACKUP_TOO_LARGE/,
  );

  const dataset = richV3Fixture();
  dataset.recordManifest.recordCount = FULL_BACKUP_MAX_RECORDS + 1;
  assert.throws(
    () => createFullBackupExport({ revision: dataset.revision, dataset, records: [] }, NOW),
    /MVU_FULL_BACKUP_RECORD_LIMIT/,
  );
});

test("legacy raw v2 import migrates complete records and reports bounded readable preview warnings", () => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const json = JSON.stringify(legacy, null, 2);

  const parsed = parseDatasetImport(json, NOW);
  const preview = createDatasetImportPreview(json, 27, NOW);

  assert.equal(parsed.kind, "legacy_v2");
  assert.equal(parsed.sourceFormatVersion, 2);
  assert.equal(parsed.sourceRevision, legacy.revision);
  assert.equal(parsed.records.length, 501);
  assert.equal(parsed.config.formatVersion, 3);
  assert.equal(parsed.config.conditions.length, legacy.autoRules.length);
  assert.equal(parsed.config.rules.length, legacy.autoRules.length);
  assert.equal(parsed.config.effectGroups.length, legacy.temporaryEffects.length);
  assert.match(parsed.warnings[0], /MVU_EFFECT_REASON_LEGACY_TEMPLATE_CONVERTED/);
  assert.deepEqual(preview, {
    valid: true,
    kind: "legacy_v2",
    sourceFormatVersion: 2,
    schemaVersion: null,
    exportedAt: null,
    sourceRevision: legacy.revision,
    previewRevision: 27,
    expectedRevision: 27,
    summary: {
      fieldCount: 2,
      conditionCount: 1,
      ruleCount: 1,
      effectGroupCount: 1,
      activeEffectCount: 1,
      recordCount: 501,
    },
    migrationWarnings: {
      items: parsed.warnings,
      totalCount: parsed.warningCount,
      truncated: false,
    },
    replacementWarning: "Restoring this backup replaces all current MVU configuration, runtime state, active effects, and history. It never merges data.",
    confirmationValue: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  });
});

test("prior v2 single-target exports without effect references remain importable", () => {
  const legacy = legacyDatasetFixture();
  delete legacy.autoRules[0].effects[0].temporaryEffectIds;
  const currentEffect = legacy.temporaryEffects[0];
  const firstTarget = currentEffect.targets[0];
  delete currentEffect.targets;
  delete currentEffect.reasonMode;
  delete currentEffect.reasonTemplate;
  currentEffect.reason = "legacy single-target reason";
  currentEffect.targetFieldId = firstTarget.fieldId;
  currentEffect.scope = firstTarget.scope;
  currentEffect.scopeKey = firstTarget.scopeKey;
  currentEffect.triggerSources = ["rule"];
  currentEffect.source = "rule";

  const parsed = parseDatasetImport(JSON.stringify(legacy), NOW);

  assert.equal(parsed.kind, "legacy_v2");
  assert.deepEqual(parsed.config.rules[0].actions[0].effectGroupIds, []);
  assert.equal(parsed.config.effectGroups[0].fieldEffects.length, 1);
  assert.equal(parsed.config.effectGroups[0].fieldEffects[0].fieldId, firstTarget.fieldId);
});

test("legacy preview rejects unknown keys and remains bounded when migration emits many warnings", () => {
  const unknown = legacyDatasetFixture();
  unknown.settings.unexpected = true;
  assert.throws(
    () => createDatasetImportPreview(JSON.stringify(unknown), 1, NOW),
    /MVU_FULL_BACKUP_UNKNOWN_KEY/,
  );

  const warningHeavy = legacyDatasetFixture();
  warningHeavy.records = Array.from({ length: 150 }, (_, index) =>
    changeRecord(index, { reason: "x".repeat(2_049) }));
  const preview = createDatasetImportPreview(JSON.stringify(warningHeavy), 1, NOW);
  assert.equal(preview.migrationWarnings.items.length, 100);
  assert.equal(preview.migrationWarnings.totalCount, 151);
  assert.equal(preview.migrationWarnings.truncated, true);
});

test("queued full read is one committed config and record snapshot while a concurrent append waits", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const files = filesWithLegacy(legacy);
  const store = createV3Store(files, legacy);
  await store.initialize();
  const before = await store.readV3();
  const barrier = files.pauseNext("readText", ({ path }) => path === V3_PATH);

  const reading = store.readFullBackup();
  const entered = await Promise.race([
    barrier.entered.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 500)),
  ]);
  assert.equal(entered, true, JSON.stringify(files.operations().map(({ operation, path }) => ({ operation, path }))));
  const next = structuredClone(before.dataset);
  next.settings.aiEnabled = false;
  const appending = store.transactV3(before.revision, next, [changeRecord(900)]);
  barrier.release();

  const exportedSnapshot = await reading;
  const committed = await appending;
  assert.equal(exportedSnapshot.revision, before.revision);
  assert.equal(exportedSnapshot.dataset.settings.aiEnabled, true);
  assert.equal(exportedSnapshot.records.length, 501);
  assert.equal(committed.revision, before.revision + 1);
  assert.equal((await store.readFullBackup()).records.length, 502);
});

test("full v3 restore replaces every record, rebuilds segments, preserves native state, and keeps local revision authoritative across restart", async () => {
  const sourceLegacy = legacyDatasetFixture();
  sourceLegacy.records = Array.from({ length: 1_001 }, (_, index) => changeRecord(index));
  const sourceFiles = filesWithLegacy(sourceLegacy);
  const source = createV3Store(sourceFiles, sourceLegacy);
  await source.initialize();
  const sourceBefore = await source.readV3();
  const native = richV3Fixture();
  native.revision = sourceBefore.revision;
  native.recordManifest = structuredClone(sourceBefore.dataset.recordManifest);
  await source.transactV3(sourceBefore.revision, native, []);
  const sourceSnapshot = await source.readFullBackup();
  const exported = createFullBackupExport(sourceSnapshot, NOW);

  const targetLegacy = legacyDatasetFixture();
  targetLegacy.revision = 30;
  targetLegacy.records = [changeRecord(50_000, { reason: "old target record" })];
  const targetFiles = filesWithLegacy(targetLegacy);
  const target = createV3Store(targetFiles, targetLegacy);
  await target.initialize();
  const before = await target.readFullBackup();
  const supersededSegmentPath = `${RECORD_DIRECTORY}/${before.dataset.recordManifest.segments[0].fileName}`;
  const preview = await target.previewDatasetImport(exported.json);
  const afterPreview = await target.readFullBackup();

  assert.deepEqual(afterPreview, before);
  assert.equal(preview.kind, "full_v3");
  assert.equal(preview.previewRevision, 31);
  assert.equal(preview.expectedRevision, 31);
  assert.equal(preview.summary.recordCount, 1_001);
  await assert.rejects(
    target.restoreDatasetImport({
      json: exported.json,
      expectedRevision: preview.expectedRevision,
      confirmation: "yes-really",
    }),
    /MVU_FULL_BACKUP_CONFIRMATION_INVALID/,
  );
  assert.deepEqual(await target.readFullBackup(), before);
  await assert.rejects(
    target.restoreDatasetImport({
      json: exported.json,
      expectedRevision: preview.expectedRevision - 1,
      confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
    }),
    /STALE_REVISION/,
  );
  assert.deepEqual(await target.readFullBackup(), before);

  const restored = await target.restoreDatasetImport({
    json: exported.json,
    expectedRevision: preview.expectedRevision,
    confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  });
  const committed = await target.readFullBackup();
  assert.equal(restored.revision, 32);
  assert.notEqual(restored.revision, sourceSnapshot.revision);
  assert.equal(restored.sourceRevision, sourceSnapshot.revision);
  assert.equal(restored.recordCount, 1_001);
  assert.equal(committed.revision, 32);
  assert.deepEqual(withoutStoreOwnedMetadata(committed.dataset), withoutStoreOwnedMetadata(sourceSnapshot.dataset));
  assert.deepEqual(committed.records, sourceSnapshot.records);
  assert.deepEqual(committed.dataset.recordManifest.segments.map((segment) => segment.committedLineCount), [500, 500, 1]);
  assert.equal(committed.dataset.recordManifest.recordCount, 1_001);
  assert.equal(targetFiles.snapshot()[supersededSegmentPath], undefined);

  committed.dataset.settings.aiEnabled = !committed.dataset.settings.aiEnabled;
  committed.records[0].reason = "caller mutation";
  const unaffected = await target.readFullBackup();
  assert.deepEqual(withoutStoreOwnedMetadata(unaffected.dataset), withoutStoreOwnedMetadata(sourceSnapshot.dataset));
  assert.equal(unaffected.records[0].reason, sourceSnapshot.records[0].reason);

  const restarted = createV3Store(targetFiles, targetLegacy);
  assert.equal((await restarted.initialize()).mode, "v3");
  assert.deepEqual(await restarted.readFullBackup(), unaffected);
});

test("raw v2 preview and restore migrate all records through the atomic v3 replacement path", async () => {
  const targetFiles = filesWithLegacy(legacyDatasetFixture());
  const target = createV3Store(targetFiles);
  await target.initialize();
  const incoming = legacyDatasetFixture();
  incoming.revision = 77;
  incoming.records = Array.from({ length: 701 }, (_, index) => changeRecord(index + 10_000));
  const json = JSON.stringify(incoming, null, 2);

  const preview = await target.previewDatasetImport(json);
  const restored = await target.restoreDatasetImport({
    json,
    expectedRevision: preview.expectedRevision,
    confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  });
  const committed = await target.readFullBackup();

  assert.equal(preview.kind, "legacy_v2");
  assert.equal(preview.sourceFormatVersion, 2);
  assert.equal(preview.summary.recordCount, 701);
  assert.equal(preview.migrationWarnings.totalCount > 0, true);
  assert.equal(restored.kind, "legacy_v2");
  assert.equal(restored.sourceRevision, 77);
  assert.equal(restored.recordCount, 701);
  assert.equal(committed.records.length, 701);
  assert.deepEqual(committed.dataset.recordManifest.segments.map(({ committedLineCount }) => committedLineCount), [500, 201]);
});

test("staging and config publication faults leave the old snapshot visible; successful publication cleanup resumes after restart", async () => {
  const targetLegacy = legacyDatasetFixture();
  targetLegacy.records = [changeRecord(70_000, { reason: "durable old record" })];
  const files = filesWithLegacy(targetLegacy);
  const store = createV3Store(files, targetLegacy);
  await store.initialize();
  const before = await store.readFullBackup();

  const incomingDataset = richV3Fixture();
  const incomingRecords = Array.from({ length: 501 }, (_, index) => changeRecord(index + 20_000));
  incomingDataset.recordManifest = {
    segments: [
      {
        index: 1,
        fileName: "segment-000001.jsonl",
        committedLineCount: 500,
        firstOccurredAt: incomingRecords[0].occurredAt,
        lastOccurredAt: incomingRecords[499].occurredAt,
        firstRevision: incomingDataset.revision,
        lastRevision: incomingDataset.revision,
        filterCounts: { "field_affinity\u0000character:actor_t": 500 },
      },
      {
        index: 2,
        fileName: "segment-000002.jsonl",
        committedLineCount: 1,
        firstOccurredAt: incomingRecords[500].occurredAt,
        lastOccurredAt: incomingRecords[500].occurredAt,
        firstRevision: incomingDataset.revision,
        lastRevision: incomingDataset.revision,
        filterCounts: { "field_affinity\u0000character:actor_t": 1 },
      },
    ],
    recordCount: 501,
    nextSegmentIndex: 3,
  };
  const exported = createFullBackupExport({
    revision: incomingDataset.revision,
    dataset: incomingDataset,
    records: incomingRecords,
  }, NOW);

  files.failNext("writeTextAfterWrite", ({ path }) => path.includes(".jsonl.stage."));
  await assert.rejects(
    store.restoreDatasetImport({
      json: exported.json,
      expectedRevision: before.revision,
      confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
    }),
    /FAKE_WRITETEXTAFTERWRITE_FAILED/,
  );
  assert.deepEqual(await store.readFullBackup(), before);

  files.failNext("replaceAtomically", ({ destination }) => destination === V3_PATH);
  await assert.rejects(
    store.restoreDatasetImport({
      json: exported.json,
      expectedRevision: before.revision,
      confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
    }),
    /FAKE_REPLACEATOMICALLY_FAILED/,
  );
  assert.deepEqual(await store.readFullBackup(), before);

  const oldSegment = before.dataset.recordManifest.segments[0].fileName;
  files.failNext("deleteFile", ({ path }) => path === `${RECORD_DIRECTORY}/${oldSegment}`);
  const restored = await store.restoreDatasetImport({
    json: exported.json,
    expectedRevision: before.revision,
    confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  });
  assert.equal(restored.revision, before.revision + 1);
  assert.equal((await store.migrationStatus()).cleanup?.state, "pending");
  assert.equal(typeof files.snapshot()[CLEANUP_PATH], "string");

  const restarted = createV3Store(files, targetLegacy);
  const status = await restarted.initialize();
  assert.equal(status.mode, "v3");
  assert.equal(status.cleanup, undefined);
  assert.equal(files.snapshot()[CLEANUP_PATH], undefined);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/${oldSegment}`], undefined);
  assert.deepEqual((await restarted.readFullBackup()).records, incomingRecords);
});

test("malformed tampered unknown-key/version and oversized restore input fail without mutation or writes", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = [changeRecord(80_000)];
  const files = filesWithLegacy(legacy);
  const store = createV3Store(files, legacy);
  await store.initialize();
  const before = await store.readFullBackup();
  const dataset = richV3Fixture();
  const valid = createFullBackupExport({ revision: dataset.revision, dataset, records: [] }, NOW);

  async function rejectsWithoutMutation(json, pattern) {
    files.clearOperations();
    await assert.rejects(
      store.restoreDatasetImport({
        json,
        expectedRevision: before.revision,
        confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
      }),
      pattern,
    );
    assert.equal(files.operations().some(({ operation }) =>
      operation === "writeText" || operation === "appendText" || operation === "replaceAtomically"), false);
    assert.deepEqual(await store.readFullBackup(), before);
  }

  await rejectsWithoutMutation("{", /MVU_FULL_BACKUP_JSON_INVALID/);
  const tampered = JSON.parse(valid.json);
  tampered.payload.config.settings.aiEnabled = false;
  await rejectsWithoutMutation(JSON.stringify(tampered), /MVU_FULL_BACKUP_CHECKSUM_MISMATCH/);
  const unknownKey = JSON.parse(valid.json);
  unknownKey.payload.config.settings.unexpected = true;
  resign(unknownKey);
  await rejectsWithoutMutation(JSON.stringify(unknownKey), /MVU_FULL_BACKUP_UNKNOWN_KEY/);
  const unknownVersion = JSON.parse(valid.json);
  unknownVersion.schemaVersion = 2;
  resign(unknownVersion);
  await rejectsWithoutMutation(JSON.stringify(unknownVersion), /MVU_FULL_BACKUP_SCHEMA_VERSION_UNSUPPORTED/);
  await rejectsWithoutMutation(" ".repeat(FULL_BACKUP_MAX_BYTES + 1), /MVU_FULL_BACKUP_TOO_LARGE/);
});

test("runtime exports a self-importable full v3 file and exposes preview plus confirmed restore", async () => {
  const sourceLegacy = legacyDatasetFixture();
  sourceLegacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const sourceFiles = filesWithLegacy(sourceLegacy);
  const runtime = createRuntime({ store: createV3Store(sourceFiles, sourceLegacy) });
  await runtime.initialize();

  const exported = await runtime.exportDataset();
  const parsed = parseDatasetImport(exported.json, NOW);
  const preview = await runtime.previewDatasetImport(exported.json);
  const beforeRevision = (await runtime.store.readFullBackup()).revision;
  const result = await runtime.importDataset({
    json: exported.json,
    expectedRevision: preview.expectedRevision,
    confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  });

  assert.match(exported.fileName, /^operit-mvu-full-backup-v3-schema1-\d{8}-\d{6}Z\.json$/);
  assert.equal(parsed.kind, "full_v3");
  assert.equal(parsed.records.length, 501);
  assert.equal(preview.summary.recordCount, 501);
  assert.equal(result.revision, beforeRevision + 1);
});

test("dataset IPC parsers and client require exact preview and revisioned confirmation contracts", async (t) => {
  const previousToolPkg = globalThis.ToolPkg;
  t.after(() => { globalThis.ToolPkg = previousToolPkg; });
  const calls = [];
  globalThis.ToolPkg = {
    ipc: {
      async call(channel, request, options) {
        calls.push({ channel, request, options });
        return { ok: true };
      },
    },
  };
  const importRequest = {
    json: "{}",
    expectedRevision: 9,
    confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  };

  assert.deepEqual(MVU_REQUEST_PARSERS.exportDataset({}), {});
  assert.deepEqual(MVU_REQUEST_PARSERS.previewDatasetImport({ json: "{}" }), { json: "{}" });
  assert.deepEqual(MVU_REQUEST_PARSERS.importDataset(importRequest), importRequest);
  assert.equal(typeof MVU_IPC.previewDatasetImport, "string");
  assert.equal(typeof mvuIpcClient.previewDatasetImport, "function");
  assert.throws(() => MVU_REQUEST_PARSERS.previewDatasetImport({ json: "{}", mode: "template" }),
    /MVU_PREVIEW_DATASET_IMPORT_REQUEST_INVALID/);
  assert.throws(() => MVU_REQUEST_PARSERS.importDataset({ json: "{}" }),
    /MVU_IMPORT_DATASET_REQUEST_INVALID/);
  assert.throws(() => MVU_REQUEST_PARSERS.importDataset({ ...importRequest, merge: true }),
    /MVU_IMPORT_DATASET_REQUEST_INVALID/);
  assert.throws(() => MVU_REQUEST_PARSERS.importDataset({ ...importRequest, confirmation: "replace" }),
    /MVU_IMPORT_DATASET_CONFIRMATION_INVALID/);
  const multibyteOversize = "界".repeat(Math.floor(FULL_BACKUP_MAX_BYTES / 3) + 1);
  assert.throws(() => MVU_REQUEST_PARSERS.previewDatasetImport({ json: multibyteOversize }),
    /MVU_FULL_BACKUP_TOO_LARGE/);

  await mvuIpcClient.previewDatasetImport({ json: "preview" });
  await mvuIpcClient.importDataset(importRequest);
  assert.deepEqual(calls.map(({ channel, request }) => ({ channel, request })), [
    { channel: MVU_IPC.previewDatasetImport, request: { json: "preview" } },
    { channel: MVU_IPC.importDataset, request: importRequest },
  ]);
});

test("main IPC validates a self-importable safe full-backup export before host mkdir/write and forwards preview/restore", async (t) => {
  const previousToolPkg = globalThis.ToolPkg;
  const previousTools = globalThis.Tools;
  t.after(() => {
    globalThis.ToolPkg = previousToolPkg;
    globalThis.Tools = previousTools;
  });
  const handlers = {};
  const fileCalls = [];
  globalThis.ToolPkg = {
    ipc: {
      on(channel, handler) {
        handlers[channel] = handler;
        return () => { delete handlers[channel]; };
      },
    },
  };
  globalThis.Tools = {
    Files: {
      async mkdir(path, recursive, root) {
        fileCalls.push({ operation: "mkdir", path, recursive, root });
        return { successful: true, details: "ok" };
      },
      async write(path, content, append, root) {
        fileCalls.push({ operation: "write", path, content, append, root });
        return { successful: true, details: "ok" };
      },
    },
  };
  const dataset = richV3Fixture();
  const validExport = createFullBackupExport({ revision: dataset.revision, dataset, records: [] }, NOW);
  const runtimeCalls = [];
  const runtime = {
    async exportDataset() { return validExport; },
    async previewDatasetImport(json) {
      runtimeCalls.push(["preview", json]);
      return createDatasetImportPreview(json, 12, NOW);
    },
    async importDataset(request) {
      runtimeCalls.push(["import", request]);
      return { revision: 13, kind: "full_v3", sourceFormatVersion: 3, sourceRevision: 4, recordCount: 0,
        migrationWarnings: { items: [], totalCount: 0, truncated: false } };
    },
  };
  const uninstall = installMvuIpc(runtime, { snapshot() {}, systemModel: {}, queries: {} });
  t.after(uninstall);

  const response = await handlers[MVU_IPC.exportDataset]({});
  assert.deepEqual(response, {
    fileName: validExport.fileName,
    savedPath: `/sdcard/Download/Operit/exports/${validExport.fileName}`,
    summary: validExport.summary,
  });
  assert.deepEqual(fileCalls.map(({ operation, path, append, root }) => ({ operation, path, append, root })), [
    { operation: "mkdir", path: "/sdcard/Download/Operit/exports", append: undefined, root: "android" },
    { operation: "write", path: `/sdcard/Download/Operit/exports/${validExport.fileName}`, append: false, root: "android" },
  ]);
  assert.equal(fileCalls[1].content, validExport.json);

  const previewRequest = { json: validExport.json };
  const importRequest = {
    json: validExport.json,
    expectedRevision: 12,
    confirmation: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  };
  assert.equal((await handlers[MVU_IPC.previewDatasetImport](previewRequest)).expectedRevision, 12);
  assert.equal((await handlers[MVU_IPC.importDataset](importRequest)).revision, 13);
  assert.deepEqual(runtimeCalls, [["preview", validExport.json], ["import", importRequest]]);

  fileCalls.length = 0;
  runtime.exportDataset = async () => ({ ...validExport, fileName: "../../escape.json" });
  await assert.rejects(handlers[MVU_IPC.exportDataset]({}), /MVU_FULL_BACKUP_EXPORT_FILENAME_INVALID/);
  assert.deepEqual(fileCalls, []);

  runtime.exportDataset = async () => ({ ...validExport, json: "{\"format\":\"tampered\"}" });
  await assert.rejects(handlers[MVU_IPC.exportDataset]({}), /MVU_DATASET_IMPORT_FORMAT_UNKNOWN/);
  assert.deepEqual(fileCalls, []);

  runtime.exportDataset = async () => { throw new Error("MVU_FULL_BACKUP_TOO_LARGE"); };
  await assert.rejects(handlers[MVU_IPC.exportDataset]({}), /MVU_FULL_BACKUP_TOO_LARGE/);
  assert.deepEqual(fileCalls, []);

  runtime.exportDataset = async () => validExport;
  globalThis.Tools.Files.write = async () => ({ successful: false, details: "disk full" });
  await assert.rejects(handlers[MVU_IPC.exportDataset]({}), /MVU_EXPORT_WRITE_FAILED:disk full/);
});
