import assert from "node:assert/strict";
import test from "node:test";

import { automationScopeKey } from "../dist/mvu/app/scope.js";
import { createRuntime } from "../dist/mvu/app/index.js";
import {
  createEmptyRecordManifest,
  SegmentedRecordStore,
} from "../dist/mvu/app/record-store.js";
import {
  V3MvuStore,
} from "../dist/mvu/app/store-v3.js";
import {
  FileMvuStore,
  StaleRevisionError,
} from "../dist/mvu/app/store.js";
import { installMvuIpc } from "../dist/shared/ipc.js";
import {
  createFakeMvuFileApi,
  legacyDatasetFixture,
} from "./helpers.mjs";

const CONFIG_DIR = "/config";
const V2_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v2.json`;
const V3_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v3.json`;
const V3_CLEANUP_PATH = `${CONFIG_DIR}/operit_mvu.records.v3.cleanup.json`;
const RECORD_DIRECTORY = `${CONFIG_DIR}/operit_mvu.records.v3`;
const NOW = Date.parse("2033-05-18T03:33:20.000Z");
const HOUR = 3_600_000;

function changeRecord(index, overrides = {}) {
  return {
    id: `record_${index}`,
    scope: "character",
    scopeKey: "character:T",
    fieldId: "field_affinity",
    fieldName: "Affinity",
    actorId: "T",
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
    reason: "record fixture",
    source: "rule",
    ruleIds: [],
    effectIds: [],
    confidence: null,
    messageId: `message_${index}`,
    variantId: null,
    occurredAt: NOW + index,
    ...overrides,
  };
}

function legacyStore(files, initial = legacyDatasetFixture()) {
  return new FileMvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    createInitialDataset: () => structuredClone(initial),
  });
}

function v3Store(files, initial = legacyDatasetFixture()) {
  return new V3MvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    legacyStore: legacyStore(files, initial),
    createInitialDataset: () => structuredClone(initial),
    now: () => NOW,
  });
}

function filesWithV2(dataset = legacyDatasetFixture()) {
  const serialized = JSON.stringify(dataset, null, 2);
  return {
    files: createFakeMvuFileApi({ [V2_PATH]: serialized }),
    serialized,
  };
}

function lineCount(content) {
  if (content.length === 0) return 0;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

async function createLegacyUnindexedV3(files, segmentCount = 6) {
  const seed = v3Store(files);
  await seed.initialize();
  const before = await seed.readV3();
  const next = structuredClone(before.dataset);
  const firstTargetIndex = (segmentCount - 1) * 500;
  const source = Array.from({ length: segmentCount * 500 }, (_, index) => changeRecord(index, index < firstTargetIndex
    ? { fieldId: "field_other", scopeKey: "character:U", actorId: "U", actorName: "U" }
    : {}));
  await seed.transactV3(before.revision, next, source);
  const legacy = JSON.parse(files.snapshot()[V3_PATH]);
  for (const segment of legacy.recordManifest.segments) delete segment.filterCounts;
  await files.writeText(V3_PATH, JSON.stringify(legacy, null, 2));
  files.clearOperations();
  return { legacy, firstTargetIndex };
}

test("indexed field-scope record pages keep exact totals with bounded segment reads", async () => {
  const files = createFakeMvuFileApi();
  const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });
  const source = Array.from({ length: 1_000 }, (_, index) => changeRecord(index, index < 500
    ? { fieldId: "field_other", scopeKey: "character:U", actorId: "U" }
    : {}));
  const staged = await records.stageAppend(createEmptyRecordManifest(), source, 1);
  const beforeQuery = files.operations().length;

  const result = await records.queryRecords(staged.manifest, {
    limit: 10,
    direction: "desc",
    fieldId: "field_affinity",
    scopeKey: "character:T",
  });

  assert.equal(result.totalCount, 500);
  assert.deepEqual(result.items.map((item) => item.id), [
    "record_999", "record_998", "record_997", "record_996", "record_995",
    "record_994", "record_993", "record_992", "record_991", "record_990",
  ]);
  const reads = files.operations().slice(beforeQuery).filter((operation) => operation.operation.startsWith("readText"));
  assert.equal(reads.length, 1);
  assert.equal(reads[0].startLine, 1);
  assert.equal(reads[0].endLine, 500);
});

test("startup backfills a legacy v3 record index once and filtered queries read only the needed segment", async () => {
  const files = createFakeMvuFileApi();
  const { legacy } = await createLegacyUnindexedV3(files);
  const store = v3Store(files);

  const status = await store.initialize();

  assert.equal(status.mode, "v3");
  assert.equal(status.source, "existing");
  assert.equal(status.indexing, undefined);
  const persisted = JSON.parse(files.snapshot()[V3_PATH]);
  assert.equal(persisted.revision, legacy.revision);
  assert.equal(persisted.recordManifest.segments.every((segment) => segment.filterCounts !== undefined), true);
  assert.equal(files.operations().filter(({ operation, destination }) =>
    operation === "replaceAtomically" && destination === V3_PATH).length, 1);

  files.clearOperations();
  const result = await store.queryRecords({
    offset: 0,
    limit: 10,
    direction: "desc",
    fieldId: "field_affinity",
    scopeKey: "character:T",
  });

  assert.equal(result.totalCount, 500);
  assert.deepEqual(result.items.map(({ id }) => id), [
    "record_2999", "record_2998", "record_2997", "record_2996", "record_2995",
    "record_2994", "record_2993", "record_2992", "record_2991", "record_2990",
  ]);
  const recordReads = files.operations().filter(({ operation, path }) =>
    operation.startsWith("readText") && path.startsWith(RECORD_DIRECTORY));
  assert.equal(recordReads.length, 1);
  assert.equal(recordReads[0].operation, "readTextPart");
  assert.equal(recordReads[0].path, `${RECORD_DIRECTORY}/segment-000006.jsonl`);

  files.clearOperations();
  const restarted = v3Store(files);
  assert.equal((await restarted.initialize()).mode, "v3");
  assert.equal(files.operations().filter(({ operation, destination }) =>
    operation === "replaceAtomically" && destination === V3_PATH).length, 0);
});

test("failed legacy index publication keeps v3 authoritative and filtered queries fail closed until restart retries", async () => {
  const files = createFakeMvuFileApi();
  const { legacy } = await createLegacyUnindexedV3(files, 3);
  files.failNext("replaceAtomically", ({ destination }) => destination === V3_PATH);
  const pendingStore = v3Store(files);

  const pending = await pendingStore.initialize();

  assert.equal(pending.mode, "v3");
  assert.equal(pending.source, "existing");
  assert.equal(pending.indexing?.state, "pending");
  assert.match(pending.indexing?.error.message ?? "", /FAKE_REPLACEATOMICALLY_FAILED/);
  assert.equal((await pendingStore.readV3()).revision, legacy.revision);
  files.clearOperations();
  await assert.rejects(
    pendingStore.queryRecords({
      offset: 0,
      limit: 10,
      direction: "desc",
      fieldId: "field_affinity",
      scopeKey: "character:T",
    }),
    /MVU_V3_RECORD_INDEX_UNAVAILABLE/,
  );
  assert.equal(files.operations().some(({ operation, path }) =>
    operation.startsWith("readText") && path.startsWith(RECORD_DIRECTORY)), false);

  const restarted = v3Store(files);
  const recovered = await restarted.initialize();
  assert.equal(recovered.mode, "v3");
  assert.equal(recovered.indexing, undefined);
  assert.equal(JSON.parse(files.snapshot()[V3_PATH]).recordManifest.segments.every((segment) =>
    segment.filterCounts !== undefined), true);
});

test("legacy index backfill CAS never overwrites a changed durable v3 config", async () => {
  const backing = createFakeMvuFileApi();
  await createLegacyUnindexedV3(backing, 2);
  let configReads = 0;
  const files = {
    ...backing,
    async readText(path) {
      if (path === V3_PATH) {
        configReads += 1;
        if (configReads === 2) {
          const external = JSON.parse(backing.snapshot()[V3_PATH]);
          external.settings.aiEnabled = false;
          await backing.writeText(V3_PATH, JSON.stringify(external, null, 2));
        }
      }
      return backing.readText(path);
    },
  };
  const store = v3Store(files);

  const status = await store.initialize();

  assert.equal(status.mode, "v3");
  assert.equal(status.indexing?.error.code, "MVU_V3_RECORD_INDEX_BACKFILL_STALE");
  const durable = JSON.parse(backing.snapshot()[V3_PATH]);
  assert.equal(durable.settings.aiEnabled, false);
  assert.equal(durable.recordManifest.segments.some((segment) => segment.filterCounts === undefined), true);
});

test("legacy index backfill preserves a pending Task5 cleanup journal and resumes deletion", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const { files } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();
  const before = await store.read();
  const replacement = structuredClone(before.dataset);
  replacement.records = Array.from({ length: 501 }, (_, index) => changeRecord(index + 1_000));
  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));
  await store.transact(before.revision, replacement);
  const config = JSON.parse(files.snapshot()[V3_PATH]);
  const journal = JSON.parse(files.snapshot()[V3_CLEANUP_PATH]);
  for (const segment of config.recordManifest.segments) delete segment.filterCounts;
  for (const segment of journal.expectedRecordManifest.segments) delete segment.filterCounts;
  await files.writeText(V3_PATH, JSON.stringify(config, null, 2));
  await files.writeText(V3_CLEANUP_PATH, JSON.stringify(journal, null, 2));

  const restarted = v3Store(files, legacy);
  const status = await restarted.initialize();

  assert.equal(status.mode, "v3");
  assert.equal(status.indexing, undefined);
  assert.equal(status.cleanup, undefined);
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], undefined);
  assert.equal((await restarted.queryRecords({ offset: 0, limit: 1 })).totalCount, 501);
});

function installProductionHost(t, files, hostSnapshot, modelCalls, registrations, fileCalls) {
  const previous = {
    hasIcons: Object.prototype.hasOwnProperty.call(globalThis, "Icons"),
    icons: globalThis.Icons,
    hasToolPkg: Object.prototype.hasOwnProperty.call(globalThis, "ToolPkg"),
    toolPkg: globalThis.ToolPkg,
    hasTools: Object.prototype.hasOwnProperty.call(globalThis, "Tools"),
    tools: globalThis.Tools,
  };
  t.after(() => {
    if (previous.hasIcons) globalThis.Icons = previous.icons;
    else delete globalThis.Icons;
    if (previous.hasToolPkg) globalThis.ToolPkg = previous.toolPkg;
    else delete globalThis.ToolPkg;
    if (previous.hasTools) globalThis.Tools = previous.tools;
    else delete globalThis.Tools;
  });

  const successful = (operation, path) => ({ operation, path, successful: true, details: "" });
  globalThis.Icons = { Favorite: "favorite" };
  globalThis.Tools = {
    Files: {
      async exists(path, environment) {
        fileCalls.push({ operation: "exists", path, environment });
        return { exists: await files.exists(path) };
      },
      async read(path) {
        fileCalls.push({ operation: "read", path });
        return { content: await files.readText(path) };
      },
      async readPart(path, startLine, endLine, environment) {
        fileCalls.push({ operation: "readPart", path, startLine, endLine, environment });
        return { content: await files.readTextPart(path, startLine, endLine) };
      },
      async write(path, content, append = false, environment) {
        fileCalls.push({ operation: "write", path, content, append, environment });
        if (append) await files.appendText(path, content);
        else await files.writeText(path, content);
        return successful(append ? "append" : "write", path);
      },
      async move(source, destination, environment) {
        fileCalls.push({ operation: "move", source, destination, environment });
        await files.move(source, destination);
        return successful("move", destination);
      },
      async replaceAtomically(source, destination) {
        fileCalls.push({ operation: "replaceAtomically", source, destination });
        await files.replaceAtomically(source, destination);
        return successful("replaceAtomically", destination);
      },
      async deleteFile(path, recursive, environment) {
        fileCalls.push({ operation: "deleteFile", path, recursive, environment });
        await files.deleteFile(path);
        return successful("delete", path);
      },
      async mkdir(path, recursive, environment) {
        fileCalls.push({ operation: "mkdir", path, recursive, environment });
        await files.mkdir(path);
        return successful("mkdir", path);
      },
    },
  };
  globalThis.ToolPkg = {
    getConfigDir() { return CONFIG_DIR; },
    chatContext: {
      async snapshot() { return structuredClone(hostSnapshot); },
    },
    systemModel: {
      async probe() { return { available: true, provider: "test", model: "test" }; },
      async complete(request) {
        modelCalls.push(structuredClone(request));
        if (request.jsonSchema.name === "mvu_state_judgement") {
          return { text: JSON.stringify({ changes: [{
            fieldId: "field_affinity",
            delta: 4,
            reason: "state AI",
            confidence: 0.9,
          }] }) };
        }
        if (request.jsonSchema.name === "mvu_condition_judgement") {
          return { text: JSON.stringify({ judgements: [{
            predicateId: "predicate_character_event",
            matched: true,
            confidence: 0.95,
          }] }) };
        }
        throw new Error(`UNEXPECTED_MODEL_SCHEMA:${request.jsonSchema.name}`);
      },
    },
    ipc: {
      on(channel, handler) {
        registrations.ipc ??= {};
        registrations.ipc[channel] = handler;
        return () => { delete registrations.ipc[channel]; };
      },
      async call() { throw new Error("UNEXPECTED_IPC_CALL"); },
    },
    registerUiRoute(definition) { registrations.ui = definition; },
    registerNavigationEntry(definition) { registrations.navigation = definition; },
    registerAppLifecycleHook(definition) { registrations.lifecycle = definition; },
    registerChatMessageHook(definition) { registrations.chat = definition; },
    registerSystemPromptComposeHook(definition) { registrations.prompt = definition; },
  };
}

test("rotates at 500 records and exposes only the supplied committed manifest", async () => {
  const files = createFakeMvuFileApi();
  const records = new SegmentedRecordStore({
    getConfigDir: () => CONFIG_DIR,
    files,
  });
  const uncommitted = createEmptyRecordManifest();

  const staged = await records.stageAppend(
    uncommitted,
    Array.from({ length: 501 }, (_, index) => changeRecord(index)),
    1,
  );

  const physical = files.snapshot();
  assert.equal(lineCount(physical[`${RECORD_DIRECTORY}/segment-000001.jsonl`]), 500);
  assert.equal(lineCount(physical[`${RECORD_DIRECTORY}/segment-000002.jsonl`]), 1);
  assert.deepEqual(staged.manifest.segments.map((segment) => segment.committedLineCount), [500, 1]);
  assert.equal(staged.manifest.recordCount, 501);
  assert.equal(staged.manifest.nextSegmentIndex, 3);

  const hidden = await records.queryRecords(uncommitted, {
    offset: 0,
    limit: 10,
    direction: "asc",
  });
  assert.deepEqual(hidden.items, []);
  assert.equal(hidden.totalCount, 0);

  const visible = await records.queryRecords(staged.manifest, {
    offset: 495,
    limit: 10,
    direction: "asc",
  });
  assert.deepEqual(visible.items.map((record) => record.id), [
    "record_495", "record_496", "record_497", "record_498", "record_499", "record_500",
  ]);
  assert.equal(visible.totalCount, 501);
  assert.equal(visible.hasMore, false);
});

test("repairs an orphan tail without parsing or exposing it", async () => {
  const files = createFakeMvuFileApi();
  const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });
  const staged = await records.stageAppend(
    createEmptyRecordManifest(),
    [changeRecord(1), changeRecord(2)],
    1,
  );
  const segmentPath = `${RECORD_DIRECTORY}/segment-000001.jsonl`;
  await files.appendText(segmentPath, "{not committed json}\n");

  await records.validateAndRepair(staged.manifest, 1);

  assert.equal(lineCount(files.snapshot()[segmentPath]), 2);
  const result = await records.queryRecords(staged.manifest, {
    offset: 0,
    limit: 10,
    direction: "asc",
  });
  assert.deepEqual(result.items.map((record) => record.id), ["record_1", "record_2"]);
});

test("record segment creation uses unique transaction staging and atomic publication", async () => {
  const files = createFakeMvuFileApi();
  const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });

  const firstTransaction = await records.stageAppend(
    createEmptyRecordManifest(),
    Array.from({ length: 501 }, (_, index) => changeRecord(index)),
    1,
  );
  await records.stageReplace(firstTransaction.manifest, [changeRecord(1_000)], 2);

  const operations = files.operations();
  const stagedWrites = operations.filter(({ operation, path }) =>
    operation === "writeText" && path.includes(".stage."));
  const publications = operations.filter(({ operation, destination }) =>
    operation === "replaceAtomically" && destination?.startsWith(`${RECORD_DIRECTORY}/segment-`));
  assert.equal(stagedWrites.length, 3);
  assert.equal(new Set(stagedWrites.map(({ path }) => path)).size, 3);
  const transactionIds = stagedWrites.map(({ path }) =>
    path.match(/\.stage\.([^.]+)\.\d+$/)?.[1]);
  assert.equal(transactionIds[0], transactionIds[1]);
  assert.notEqual(transactionIds[1], transactionIds[2]);
  assert.deepEqual(
    publications.map(({ source, destination }) => ({ source, destination })),
    stagedWrites.map(({ path }, index) => ({
      source: path,
      destination: `${RECORD_DIRECTORY}/segment-${String(index + 1).padStart(6, "0")}.jsonl`,
    })),
  );
  assert.equal(operations.some(({ operation, path }) =>
    operation === "appendText" && path.startsWith(`${RECORD_DIRECTORY}/segment-`)), false);
});

test("orphan recovery has a hard probe bound", async () => {
  const backing = createFakeMvuFileApi();
  let segmentProbes = 0;
  const files = {
    ...backing,
    async exists(path) {
      if (path.startsWith(`${RECORD_DIRECTORY}/segment-`)) {
        segmentProbes += 1;
        return segmentProbes <= 1_025;
      }
      return backing.exists(path);
    },
  };
  const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });

  await assert.rejects(
    records.validateAndRepair(createEmptyRecordManifest(), 0),
    /MVU_V3_RECORD_ORPHAN_SCAN_LIMIT/,
  );
  assert.equal(segmentProbes <= 1_024, true);
  assert.equal(backing.operations().some(({ operation }) => operation === "deleteFile"), false);
});

test("replacement allocation has a hard collision-probe bound", async () => {
  const backing = createFakeMvuFileApi();
  let segmentProbes = 0;
  const files = {
    ...backing,
    async exists(path) {
      if (path.startsWith(`${RECORD_DIRECTORY}/segment-`)) {
        segmentProbes += 1;
        return segmentProbes <= 1_025;
      }
      return backing.exists(path);
    },
  };
  const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });

  await assert.rejects(
    records.stageReplace(createEmptyRecordManifest(), [changeRecord(1)], 1),
    /MVU_V3_RECORD_STAGING_SCAN_LIMIT/,
  );
  assert.equal(segmentProbes <= 1_024, true);
});

test("MAX_SAFE_INTEGER orphan guard runs before deletion", async () => {
  const index = Number.MAX_SAFE_INTEGER;
  const orphanPath = `${RECORD_DIRECTORY}/segment-${index}.jsonl`;
  const files = createFakeMvuFileApi({ [orphanPath]: "orphan bytes\n" });
  const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });

  await assert.rejects(
    records.validateAndRepair(createEmptyRecordManifest(index), 0),
    /MVU_V3_RECORD_NEXT_SEGMENT_OVERFLOW/,
  );
  assert.equal(files.snapshot()[orphanPath], "orphan bytes\n");
  assert.equal(files.operations().some(({ operation, path }) =>
    operation === "deleteFile" && path === orphanPath), false);
});

test("commits records and configuration together and rejects a stale CAS revision", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  const status = await store.initialize();
  assert.equal(status.mode, "v3");
  const before = await store.readV3();
  const next = structuredClone(before.dataset);
  next.settings.aiEnabled = false;

  const committed = await store.transactV3(before.revision, next, [changeRecord(1)]);

  assert.equal(committed.revision, before.revision + 1);
  assert.equal(committed.dataset.settings.aiEnabled, false);
  assert.equal(committed.dataset.recordManifest.recordCount, 1);
  const records = await store.queryRecords({ offset: 0, limit: 10, direction: "asc" });
  assert.deepEqual(records.items.map((record) => record.id), ["record_1"]);
  await assert.rejects(
    store.transactV3(before.revision, structuredClone(committed.dataset), [changeRecord(2)]),
    StaleRevisionError,
  );
  assert.deepEqual(
    (await store.queryRecords({ offset: 0, limit: 10, direction: "asc" })).items.map((record) => record.id),
    ["record_1"],
  );
});

test("store CAS deliberately excludes writers outside the persistent ToolPkg main runtime", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const before = await store.readV3();
  const next = structuredClone(before.dataset);
  next.settings.aiEnabled = false;
  const replacementBarrier = files.pauseNext(
    "replaceAtomically",
    ({ destination }) => destination === V3_PATH,
  );

  const transaction = store.transactV3(before.revision, next, []);
  await replacementBarrier.entered;
  const external = structuredClone(before.dataset);
  external.revision = before.revision + 1;
  external.settings.aiEnabled = true;
  external.pendingBootstrapFieldIds = ["external_writer_marker"];
  await files.writeText(V3_PATH, JSON.stringify(external));
  replacementBarrier.release();

  const committed = await transaction;
  assert.equal(committed.dataset.settings.aiEnabled, false);
  assert.deepEqual(committed.dataset.pendingBootstrapFieldIds, []);
  assert.deepEqual((await store.readV3()).dataset.pendingBootstrapFieldIds, []);
});

test("a failed atomic config replace leaves state and records uncommitted, then restart repairs and retries", async () => {
  const { files } = filesWithV2();
  const firstStore = v3Store(files);
  await firstStore.initialize();
  const before = await firstStore.readV3();
  const interrupted = structuredClone(before.dataset);
  interrupted.settings.aiEnabled = false;
  interrupted.hourlyMessageBuckets["event:test"] = [{
    startedAt: Math.floor(NOW / HOUR) * HOUR - HOUR,
    messageCount: 7,
  }];
  files.failNext("replaceAtomically", ({ destination }) => destination === V3_PATH);

  await assert.rejects(
    firstStore.transactV3(before.revision, interrupted, [changeRecord(1)]),
    /FAKE_REPLACEATOMICALLY_FAILED/,
  );

  const restarted = v3Store(files);
  assert.equal((await restarted.initialize()).mode, "v3");
  const recovered = await restarted.readV3();
  assert.equal(recovered.revision, before.revision);
  assert.equal(recovered.dataset.settings.aiEnabled, true);
  assert.equal(recovered.dataset.hourlyMessageBuckets["event:test"], undefined);
  assert.equal((await restarted.queryRecords({ offset: 0, limit: 10 })).totalCount, 0);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], undefined);

  const retry = structuredClone(recovered.dataset);
  retry.settings.aiEnabled = false;
  const committed = await restarted.transactV3(recovered.revision, retry, [changeRecord(2)]);
  assert.equal(committed.dataset.recordManifest.recordCount, 1);
  assert.deepEqual(
    (await restarted.queryRecords({ offset: 0, limit: 10, direction: "asc" })).items.map((record) => record.id),
    ["record_2"],
  );
  assert.equal(lineCount(files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`]), 1);
});

test("startup migrates into new v3 paths, preserves v2 byte-for-byte, and prefers valid v3", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = [changeRecord(1), changeRecord(2)];
  const { files, serialized } = filesWithV2(legacy);
  const first = v3Store(files, legacy);

  const migrated = await first.initialize();

  assert.equal(migrated.mode, "v3");
  assert.equal(migrated.source, "migrated");
  assert.equal(files.snapshot()[V2_PATH], serialized);
  assert.equal((await first.readV3()).dataset.recordManifest.recordCount, 2);
  assert.equal((await first.queryRecords({ offset: 0, limit: 10 })).totalCount, 2);

  const changedV2 = structuredClone(legacy);
  changedV2.settings.aiEnabled = false;
  await files.writeText(V2_PATH, JSON.stringify(changedV2));
  const restarted = v3Store(files, changedV2);
  const preferred = await restarted.initialize();
  assert.equal(preferred.mode, "v3");
  assert.equal(preferred.source, "existing");
  assert.equal((await restarted.readV3()).dataset.settings.aiEnabled, true);
});

test("failed migration retains structured v2 compatibility and a clean retry succeeds", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = [changeRecord(1)];
  const { files, serialized } = filesWithV2(legacy);
  files.failNext("replaceAtomically", ({ destination }) => destination === V3_PATH);
  const store = v3Store(files, legacy);

  const failed = await store.initialize();

  assert.equal(failed.mode, "v2_compat");
  assert.equal(typeof failed.error.code, "string");
  assert.match(failed.error.message, /FAKE_REPLACEATOMICALLY_FAILED/);
  assert.equal((await store.read()).dataset.formatVersion, 2);
  assert.equal(files.snapshot()[V2_PATH], serialized);
  const failedSegmentBytes = files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`];
  assert.equal(typeof failedSegmentBytes, "string");

  const retried = await store.retryMigration();
  assert.equal(retried.mode, "v3");
  assert.equal(retried.source, "migrated");
  assert.equal(files.snapshot()[V2_PATH], serialized);
  assert.equal((await store.queryRecords({ offset: 0, limit: 10 })).totalCount, 1);
  const migratedV3 = (await store.readV3()).dataset;
  assert.deepEqual(migratedV3.recordManifest.segments.map(({ fileName }) => fileName), [
    "segment-000002.jsonl",
  ]);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], failedSegmentBytes);
  const stagingPaths = files.operations()
    .filter((operation) => operation.operation === "writeText" && operation.path.startsWith(`${V3_PATH}.tmp.`))
    .map(({ path }) => path);
  assert.equal(new Set(stagingPaths).size, 2);
});

test("each invalid v3 reference and committed count falls back without overwriting either dataset", async () => {
  const corruptions = [
    (dataset) => { dataset.rules[0].conditionId = "missing_condition"; },
    (dataset) => { dataset.recordManifest.recordCount = 9; },
  ];
  for (const corrupt of corruptions) {
    const { files, serialized } = filesWithV2();
    const initial = v3Store(files);
    await initial.initialize();
    const invalid = JSON.parse(files.snapshot()[V3_PATH]);
    corrupt(invalid);
    const invalidSerialized = JSON.stringify(invalid);
    await files.writeText(V3_PATH, invalidSerialized);

    const restarted = v3Store(files);
    const status = await restarted.initialize();

    assert.equal(status.mode, "v2_compat");
    assert.equal((await restarted.read()).dataset.formatVersion, 2);
    assert.equal(files.snapshot()[V2_PATH], serialized);
    assert.equal(files.snapshot()[V3_PATH], invalidSerialized);
    assert.equal((await restarted.retryMigration()).mode, "v3");
    assert.equal(files.snapshot()[V2_PATH], serialized);
  }
});

test("legacy compatibility writes preserve v3-only conditions, rules, and effects", async () => {
  const legacy = legacyDatasetFixture();
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  const { files } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();

  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  const createdAt = new Date(NOW).toISOString();
  configured.conditions.push({
    id: "condition_v3_only",
    name: "V3-only sender condition",
    description: "",
    enabled: true,
    expression: { kind: "predicate", predicate: { kind: "sender", senders: ["character"] } },
    createdAt,
    updatedAt: createdAt,
  });
  configured.effectGroups.push({
    id: "effect_group_v3_only",
    name: "V3-only immediate effect",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_v3_only",
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 2 }],
    }],
    defaultDuration: { expiresAt: null, remainingTurns: 2 },
    createdAt,
    updatedAt: createdAt,
  });
  configured.rules.push({
    id: "rule_v3_only",
    name: "V3-only activation rule",
    description: "",
    enabled: true,
    triggerActorSelector: { kind: "current_actor" },
    conditionId: "condition_v3_only",
    actions: [{ kind: "activate_effect_group", effectGroupId: "effect_group_v3_only" }],
    cooldownHours: 0,
    executionOrder: 0,
    createdAt,
    updatedAt: createdAt,
  });
  await store.transactV3(before.revision, configured, []);

  const runtime = createRuntime({ store });
  const legacyRule = await runtime.service.addAutoRule({
    name: "Legacy-compatible rule",
    description: "",
    enabled: true,
    condition: { kind: "recentPositive", count: 1 },
    effects: [{ fieldId: "field_affinity", delta: 1, temporaryEffectIds: [] }],
    cooldownMs: 0,
    order: 1,
  });

  const after = await store.readV3();
  assert.equal(after.dataset.conditions.some(({ id }) => id === "condition_v3_only"), true);
  assert.equal(after.dataset.rules.some(({ id }) => id === "rule_v3_only"), true);
  assert.equal(after.dataset.effectGroups.some(({ id }) => id === "effect_group_v3_only"), true);
  assert.equal(after.dataset.rules.some(({ id }) => id === legacyRule.id), true);
});

test("legacy rule writes commit true action additions with migrated defaults", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const before = await store.read();
  const next = structuredClone(before.dataset);
  next.autoRules[0].effects.push({
    fieldId: "field_excite",
    delta: 2,
    temporaryEffectIds: [],
  });

  await store.transact(before.revision, next);

  const after = await store.readV3();
  const actions = after.dataset.rules.find(({ id }) => id === "auto_positive").actions;
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[1], {
    kind: "change_field",
    fieldId: "field_excite",
    target: { kind: "trigger_actor" },
    delta: 2,
    effectGroupIds: [],
  });
});

test("legacy rule reordering keeps hidden action metadata attached to its matched action", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  const createdAt = new Date(NOW).toISOString();
  configured.effectGroups.push({
    id: "effect_group_hidden_action",
    name: "Hidden immediate action metadata",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_hidden_action",
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    }],
    createdAt,
    updatedAt: createdAt,
  });
  const rule = configured.rules.find(({ id }) => id === "auto_positive");
  rule.actions = [
    {
      kind: "change_field",
      fieldId: "field_affinity",
      target: { kind: "selected", actorIds: ["actor_t"] },
      delta: 4,
      effectGroupIds: ["effect_group_effect_warm", "effect_group_hidden_action"],
    },
    {
      kind: "change_field",
      fieldId: "field_excite",
      target: { kind: "trigger_actor" },
      delta: 2,
      effectGroupIds: [],
    },
  ];
  await store.transactV3(before.revision, configured, []);
  const compatibility = await store.read();
  const reordered = structuredClone(compatibility.dataset);
  reordered.autoRules[0].effects.reverse();

  await store.transact(compatibility.revision, reordered);

  const actions = (await store.readV3()).dataset.rules
    .find(({ id }) => id === "auto_positive").actions;
  assert.deepEqual(actions.map(({ fieldId }) => fieldId), ["field_excite", "field_affinity"]);
  assert.deepEqual(actions[1].target, { kind: "selected", actorIds: ["actor_t"] });
  assert.deepEqual(actions[1].effectGroupIds, [
    "effect_group_hidden_action",
    "effect_group_effect_warm",
  ]);
});

test("legacy rule writes remove an unambiguous representable action", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  configured.rules.find(({ id }) => id === "auto_positive").actions.push({
    kind: "change_field",
    fieldId: "field_excite",
    target: { kind: "trigger_actor" },
    delta: 2,
    effectGroupIds: [],
  });
  await store.transactV3(before.revision, configured, []);
  const compatibility = await store.read();
  const next = structuredClone(compatibility.dataset);
  next.autoRules[0].effects = next.autoRules[0].effects.filter(({ fieldId }) =>
    fieldId !== "field_excite");

  await store.transact(compatibility.revision, next);

  const actions = (await store.readV3()).dataset.rules
    .find(({ id }) => id === "auto_positive").actions;
  assert.deepEqual(actions.map(({ fieldId }) => fieldId), ["field_affinity"]);
});

test("legacy rule writes reject an ambiguous removal of hidden action semantics", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  const rule = configured.rules.find(({ id }) => id === "auto_positive");
  rule.actions = [
    {
      kind: "change_field",
      fieldId: "field_affinity",
      target: { kind: "selected", actorIds: ["actor_t"] },
      delta: 4,
      effectGroupIds: ["effect_group_effect_warm"],
    },
    {
      kind: "change_field",
      fieldId: "field_affinity",
      target: { kind: "all_bound" },
      delta: 4,
      effectGroupIds: ["effect_group_effect_warm"],
    },
  ];
  await store.transactV3(before.revision, configured, []);
  const compatibility = await store.read();
  const next = structuredClone(compatibility.dataset);
  next.autoRules[0].effects.pop();

  await assert.rejects(
    store.transact(compatibility.revision, next),
    /MVU_V3_COMPAT_RULE_ACTIONS_AMBIGUOUS:auto_positive/,
  );
});

test("legacy temporary-effect writes preserve hidden v3 effect definitions", async () => {
  const legacy = legacyDatasetFixture();
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  const { files } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();

  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  const createdAt = new Date(NOW).toISOString();
  configured.effectGroups.push({
    id: "effect_group_v3_hidden",
    name: "V3-only hidden effect",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_v3_hidden",
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 2 }],
    }],
    defaultDuration: { expiresAt: null, remainingTurns: 2 },
    createdAt,
    updatedAt: createdAt,
  });
  await store.transactV3(before.revision, configured, []);

  const runtime = createRuntime({ store });
  const legacyEffect = await runtime.service.addTemporaryEffect({
    targets: [{
      fieldId: "field_affinity",
      scope: "character",
      scopeKey: "character:actor_t",
    }],
    mode: "additive",
    value: 1,
    enabled: true,
    expiresAt: null,
    remainingTurns: 2,
    reasonMode: "template",
    reasonTemplate: "general",
    reason: "",
    createdAt: NOW,
  });

  const after = await store.readV3();
  assert.equal(after.dataset.effectGroups.some(({ id }) => id === "effect_group_v3_hidden"), true);
  assert.equal(after.dataset.effectGroups.some(({ id }) => id === `effect_group_${legacyEffect.id}`), true);
});

test("legacy expiry settles an expired non-first active effect instance independently", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  const definition = configured.effectGroups.find(({ id }) => id === "effect_group_effect_warm");
  definition.fieldEffects[0].operations[0].sources = ["ai"];
  definition.fieldEffects[1].operations[0].sources = ["rule"];
  const first = configured.activeEffects.find(({ definitionId }) =>
    definition.id === "effect_group_effect_warm");
  first.id = "active_effect_future_first";
  first.triggerActorId = "actor_t";
  first.resolvedTargets = [first.resolvedTargets[0]];
  first.duration = { expiresAt: new Date(NOW + HOUR).toISOString(), remainingTurns: 5 };
  first.reason = { mode: "custom", template: "general", text: "future first reason" };
  const expiredSecond = {
    ...structuredClone(first),
    id: "active_effect_expired_second",
    resolvedTargets: [{
      fieldId: "field_excite",
      actorId: "actor_t",
      scope: "character",
      scopeKey: "character:actor_t",
    }],
    duration: { expiresAt: new Date(NOW - HOUR).toISOString(), remainingTurns: 2 },
    reason: { mode: "custom", template: "general", text: "expired second reason" },
  };
  configured.activeEffects = [first, expiredSecond];
  await store.transactV3(before.revision, configured, []);
  const expectedSurvivor = structuredClone(first);
  const expectedFieldEffects = structuredClone(definition.fieldEffects);
  const runtime = createRuntime({ store });

  await runtime.service.settleNatural({
    chatId: "chat_main",
    actorId: "actor_t",
    groupId: "group_main",
    actorName: "T",
  }, NOW);

  const after = await store.readV3();
  assert.deepEqual(after.dataset.activeEffects, [expectedSurvivor]);
  assert.deepEqual(
    after.dataset.effectGroups.find(({ id }) => id === definition.id).fieldEffects,
    expectedFieldEffects,
  );
});

test("adding a legacy effect target adds a matching definition field effect", async () => {
  const { files } = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  const definition = configured.effectGroups.find(({ id }) => id === "effect_group_effect_warm");
  definition.fieldEffects = [definition.fieldEffects.find(({ fieldId }) =>
    fieldId === "field_affinity")];
  definition.fieldEffects[0].operations[0].sources = ["ai"];
  const instance = configured.activeEffects.find(({ definitionId }) =>
    definitionId === definition.id);
  instance.id = "active_effect_hidden_metadata";
  instance.triggerActorId = "actor_t";
  instance.resolvedTargets = [instance.resolvedTargets.find(({ fieldId }) =>
    fieldId === "field_affinity")];
  instance.duration = { expiresAt: null, remainingTurns: 7 };
  instance.reason = { mode: "custom", template: "general", text: "keep this reason" };
  await store.transactV3(before.revision, configured, []);
  const compatibility = await store.read();
  const next = structuredClone(compatibility.dataset);
  next.temporaryEffects[0].targets.push({
    fieldId: "field_excite",
    scope: "character",
    scopeKey: "character:actor_t",
  });

  await store.transact(compatibility.revision, next);

  const after = await store.readV3();
  const afterDefinition = after.dataset.effectGroups.find(({ id }) => id === definition.id);
  assert.deepEqual(afterDefinition.fieldEffects[0], definition.fieldEffects[0]);
  const addedFieldEffect = afterDefinition.fieldEffects.find(({ fieldId }) =>
    fieldId === "field_excite");
  assert.ok(addedFieldEffect);
  assert.deepEqual(addedFieldEffect.actorSelector, { kind: "selected", actorIds: ["actor_t"] });
  assert.equal(addedFieldEffect.operations[0].kind, "all_multiplier");
  assert.equal(addedFieldEffect.operations[0].value, 1.25);
  assert.deepEqual([...addedFieldEffect.operations[0].sources].sort(), [
    "ai", "manual", "natural", "per_turn", "rule",
  ]);
  const afterInstance = after.dataset.activeEffects.find(({ id }) =>
    id === "active_effect_hidden_metadata");
  assert.equal(afterInstance.triggerActorId, "actor_t");
  assert.deepEqual(afterInstance.duration, { expiresAt: null, remainingTurns: 7 });
  assert.deepEqual(afterInstance.reason, {
    mode: "custom", template: "general", text: "keep this reason",
  });
  assert.deepEqual(afterInstance.resolvedTargets.map(({ fieldId }) => fieldId), [
    "field_affinity", "field_excite",
  ]);
});

test("registered production chat hook commits legacy changes, v3 effects, AI rules, facts, and records atomically", async (t) => {
  const legacy = legacyDatasetFixture();
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  legacy.fields[0].bindingIds = ["T"];
  legacy.fields[0].initialValue = 10;
  legacy.fields[0].naturalChange = { enabled: true, unitMs: HOUR, amount: 2 };
  legacy.fields[0].perTurnChange = {
    enabled: true, intervalTurns: 1, amount: 3, countMode: "character",
  };
  legacy.fields[0].ai = { enabled: true, minConfidence: 0.5, maxDelta: 10, prompt: "Track affinity." };
  legacy.fields[1].bindingIds = ["T"];
  legacy.fields[1].initialValue = 0;
  legacy.rules = [{
    id: "link_affinity_excite",
    sourceFieldId: "field_affinity",
    operator: ">=",
    sourceThreshold: 0,
    targetFieldId: "field_excite",
    effect: { kind: "delta", value: 5 },
    enabled: true,
  }];
  legacy.stateValues = {
    "character:T": { field_affinity: 10, field_excite: 0 },
  };
  legacy.lastSettled = {
    "character:T": { field_affinity: NOW - HOUR },
  };
  const { files, serialized } = filesWithV2(legacy);
  const seedStore = v3Store(files, legacy);
  await seedStore.initialize();
  const configured = await seedStore.readV3();
  const next = structuredClone(configured.dataset);
  const createdAt = new Date(NOW).toISOString();
  next.conditions = [
    {
      id: "condition_ai_character",
      name: "AI character event",
      description: "",
      enabled: true,
      expression: {
        kind: "and",
        children: [
          { kind: "predicate", predicate: { kind: "sender", senders: ["character"] } },
          { kind: "predicate", predicate: {
            kind: "ai_semantic",
            id: "predicate_character_event",
            triggerType: "character event",
            requirement: "The character event should activate focus.",
            minimumConfidence: 0.7,
          } },
        ],
      },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "condition_character",
      name: "Character turn",
      description: "",
      enabled: true,
      expression: { kind: "predicate", predicate: { kind: "sender", senders: ["character"] } },
      createdAt,
      updatedAt: createdAt,
    },
  ];
  next.effectGroups = [
    {
      id: "effect_group_existing",
      name: "Existing source-aware effect",
      description: "",
      enabled: true,
      fieldEffects: [{
        id: "field_effect_existing",
        fieldId: "field_affinity",
        actorSelector: { kind: "selected", actorIds: ["T"] },
        operations: [
          { kind: "fixed_adjustment", value: 1, sources: ["natural"] },
          { kind: "positive_multiplier", value: 2, sources: ["ai"] },
        ],
      }],
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "effect_group_focus",
      name: "Focus",
      description: "",
      enabled: true,
      fieldEffects: [{
        id: "field_effect_focus",
        fieldId: "field_affinity",
        actorSelector: { kind: "trigger_actor" },
        operations: [
          { kind: "immediate_delta", value: -1 },
          { kind: "positive_multiplier", value: 0.5, sources: ["rule"] },
        ],
      }],
      defaultDuration: { expiresAt: null, remainingTurns: 2 },
      createdAt,
      updatedAt: createdAt,
    },
  ];
  next.activeEffects = [{
    id: "active_existing",
    definitionId: "effect_group_existing",
    triggerActorId: "T",
    resolvedTargets: [{
      fieldId: "field_affinity",
      actorId: "T",
      scope: "character",
      scopeKey: "character:T",
    }],
    duration: { expiresAt: null, remainingTurns: 3 },
    activatedAt: createdAt,
    reason: { mode: "template", template: "general", text: "Existing source-aware effect" },
  }];
  next.rules = [
    {
      id: "rule_activate_focus",
      name: "Activate focus",
      description: "",
      enabled: true,
      triggerActorSelector: { kind: "current_actor" },
      conditionId: "condition_ai_character",
      actions: [{ kind: "activate_effect_group", effectGroupId: "effect_group_focus" }],
      cooldownHours: 0,
      executionOrder: 0,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "rule_focus_gain",
      name: "Focused gain",
      description: "",
      enabled: true,
      triggerActorSelector: { kind: "current_actor" },
      conditionId: "condition_character",
      actions: [{
        kind: "change_field",
        fieldId: "field_affinity",
        target: { kind: "trigger_actor" },
        delta: 10,
        effectGroupIds: ["effect_group_focus"],
      }],
      cooldownHours: 0,
      executionOrder: 1,
      createdAt,
      updatedAt: createdAt,
    },
  ];
  await seedStore.transactV3(configured.revision, next, []);
  const beforeMessage = await seedStore.readV3();

  const character = { characterCardId: "T", name: "T", avatarUri: null };
  const hostSnapshot = {
    chatId: "chat_main",
    activePrompt: { type: "character_card", id: "T", name: "T" },
    activeCharacter: character,
    activeGroup: null,
    characters: [character],
    groups: [],
    members: [],
    currentCharacter: character,
  };
  const modelCalls = [];
  const registrations = {};
  const fileCalls = [];
  installProductionHost(t, files, hostSnapshot, modelCalls, registrations, fileCalls);
  const main = await import("../dist/main.js");
  assert.equal(main.registerToolPkg(), true);
  assert.equal(typeof registrations.chat?.function, "function");
  assert.deepEqual(await registrations.lifecycle.function(), { ok: true });

  const hookResult = await registrations.chat.function({
    eventName: "message_persisted",
    eventPayload: {
      chatId: "chat_main",
      messageId: "message_production_hook",
      variantId: null,
      actorCharacterCardId: "T",
      characterGroupId: null,
      actorName: "T",
      isComplete: true,
      timestamp: NOW,
      sender: "ai",
      content: "A role-aware production event",
    },
  });

  assert.equal(hookResult, null);
  const committed = await seedStore.readV3();
  assert.equal(committed.revision, beforeMessage.revision + 1);
  assert.equal(committed.dataset.stateValues["character:T"].field_affinity, 28);
  assert.equal(committed.dataset.stateValues["character:T"].field_excite, 10);
  assert.equal(committed.dataset.activeEffects.length, 2);
  assert.deepEqual(committed.dataset.activeEffects.map((effect) => effect.duration.remainingTurns), [2, 1]);
  assert.equal(committed.dataset.processedMessageIds.length, 1);
  assert.equal(Object.values(committed.dataset.messageFacts).flat().length, 1);
  assert.equal(Object.values(committed.dataset.hourlyMessageBuckets).flat()
    .reduce((sum, bucket) => sum + bucket.messageCount, 0), 1);
  assert.equal(committed.dataset.recordManifest.recordCount, 7);
  assert.equal(files.snapshot()[V2_PATH], serialized);

  const conditionCall = modelCalls.find((call) => call.jsonSchema.name === "mvu_condition_judgement");
  assert.deepEqual(JSON.parse(conditionCall.userPrompt), {
    role: "character",
    actorId: "T",
    actorName: "T",
    content: "A role-aware production event",
  });
  assert.equal(modelCalls.filter((call) => call.jsonSchema.name === "mvu_condition_judgement").length, 1);
  assert.equal(modelCalls.filter((call) => call.jsonSchema.name === "mvu_state_judgement").length, 1);

  const storedLines = Object.entries(files.snapshot())
    .filter(([path]) => path.startsWith(`${RECORD_DIRECTORY}/segment-`))
    .flatMap(([, content]) => content.trim().split("\n").filter(Boolean).map(JSON.parse));
  assert.equal(storedLines.length, 7);
  assert.equal(storedLines.every((line) => line.commitRevision === committed.revision), true);
  assert.equal(fileCalls.filter((call) =>
    call.operation === "replaceAtomically" && call.destination === V3_PATH).length, 1);
  assert.equal(fileCalls.some((call) => call.operation === "move" && call.destination === V3_PATH), false);
  const stagedSegmentWriteIndex = fileCalls.findIndex((call) =>
    call.operation === "write" && call.append === false && call.path.includes(".jsonl.stage."));
  const segmentPublicationIndex = fileCalls.findIndex((call) =>
    call.operation === "replaceAtomically" && call.destination.startsWith(`${RECORD_DIRECTORY}/segment-`));
  const configPublicationIndex = fileCalls.findIndex((call) =>
    call.operation === "replaceAtomically" && call.destination === V3_PATH);
  assert.equal(stagedSegmentWriteIndex >= 0 &&
    segmentPublicationIndex > stagedSegmentWriteIndex &&
    configPublicationIndex > segmentPublicationIndex, true);

  const committedConfigBytes = files.snapshot()[V3_PATH];
  const failureCallStart = fileCalls.length;
  files.failNext("replaceAtomically", ({ destination }) => destination === V3_PATH);
  await assert.rejects(registrations.chat.function({
    eventName: "message_persisted",
    eventPayload: {
      chatId: "chat_main",
      messageId: "message_production_hook_interrupted",
      variantId: null,
      actorCharacterCardId: "T",
      characterGroupId: null,
      actorName: "T",
      isComplete: true,
      timestamp: NOW + 1,
      sender: "ai",
      content: "An interrupted production event",
    },
  }), /FAKE_REPLACEATOMICALLY_FAILED/);
  assert.equal(files.snapshot()[V3_PATH], committedConfigBytes);
  assert.equal((await seedStore.readV3()).revision, committed.revision);
  assert.equal((await seedStore.queryRecords({ offset: 0, limit: 20 })).totalCount, 7);
  const failedProductionCalls = fileCalls.slice(failureCallStart);
  const appendIndex = failedProductionCalls.findIndex((call) =>
    call.operation === "write" && call.append === true);
  const atomicIndex = failedProductionCalls.findIndex((call) =>
    call.operation === "replaceAtomically" && call.destination === V3_PATH);
  assert.equal(appendIndex >= 0 && atomicIndex > appendIndex, true);

  const productionReader = createRuntime({ getConfigDir: () => CONFIG_DIR });
  assert.equal((await productionReader.initialize()).mode, "v3");
  const queryCallStart = fileCalls.length;
  const queried = await productionReader.store.queryRecords({ offset: 0, limit: 10, direction: "asc" });
  const queryCalls = fileCalls.slice(queryCallStart);
  assert.equal(queried.items.length, 7);
  assert.equal(queryCalls.some((call) => call.operation === "readPart"), true);
  assert.equal(queryCalls.some((call) =>
    call.operation === "read" && call.path.startsWith(`${RECORD_DIRECTORY}/segment-`)), false);
  const compatibility = await productionReader.snapshot({
    chatId: "chat_main", actorId: "T", groupId: null, actorName: "T",
  });
  assert.equal(compatibility.fields.find((field) => field.definition.id === "field_affinity").currentValue, 28);
  assert.equal(compatibility.records.length, 7);
  assert.equal(compatibility.migrationStatus.mode, "v3");

  const orphanPath = `${RECORD_DIRECTORY}/segment-${String(committed.dataset.recordManifest.nextSegmentIndex).padStart(6, "0")}.jsonl`;
  await files.writeText(orphanPath, "orphan\n");
  const repairRuntime = createRuntime({ getConfigDir: () => CONFIG_DIR });
  assert.equal((await repairRuntime.initialize()).mode, "v3");
  assert.equal(files.snapshot()[orphanPath], undefined);
  assert.equal(fileCalls.some((call) => call.operation === "deleteFile" && call.path === orphanPath), true);
});

test("production runtime composes legacy field behavior with v3 rules in one committed transaction", async () => {
  const legacy = legacyDatasetFixture();
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  legacy.fields[0].bindingIds = ["T"];
  legacy.fields[0].initialValue = 10;
  legacy.fields[0].naturalChange = { enabled: true, unitMs: HOUR, amount: 2 };
  legacy.fields[0].perTurnChange = {
    enabled: true, intervalTurns: 1, amount: 3, countMode: "character",
  };
  legacy.fields[0].ai = { enabled: true, minConfidence: 0.5, maxDelta: 10, prompt: "Track affinity." };
  legacy.fields[1].bindingIds = ["T"];
  legacy.fields[1].initialValue = 0;
  legacy.rules = [{
    id: "link_affinity_excite",
    sourceFieldId: "field_affinity",
    operator: ">=",
    sourceThreshold: 0,
    targetFieldId: "field_excite",
    effect: { kind: "delta", value: 5 },
    enabled: true,
  }];
  legacy.stateValues = {
    "character:T": { field_affinity: 10, field_excite: 0 },
  };
  legacy.lastSettled = {
    "character:T": { field_affinity: NOW - HOUR },
  };
  const { files } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();
  const configured = await store.readV3();
  const next = structuredClone(configured.dataset);
  const createdAt = new Date(NOW).toISOString();
  next.conditions = [{
    id: "condition_character",
    name: "Character turn",
    description: "",
    enabled: true,
    expression: { kind: "predicate", predicate: { kind: "sender", senders: ["character"] } },
    createdAt,
    updatedAt: createdAt,
  }];
  next.effectGroups = [{
    id: "effect_group_focus",
    name: "Focus",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_focus",
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [
        { kind: "immediate_delta", value: -1 },
        { kind: "positive_multiplier", value: 0.5, sources: ["rule"] },
      ],
    }],
    defaultDuration: { expiresAt: null, remainingTurns: 2 },
    createdAt,
    updatedAt: createdAt,
  }];
  next.rules = [
    {
      id: "rule_activate_focus",
      name: "Activate focus",
      description: "",
      enabled: true,
      triggerActorSelector: { kind: "current_actor" },
      conditionId: "condition_character",
      actions: [{ kind: "activate_effect_group", effectGroupId: "effect_group_focus" }],
      cooldownHours: 0,
      executionOrder: 0,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "rule_focus_gain",
      name: "Focused gain",
      description: "",
      enabled: true,
      triggerActorSelector: { kind: "current_actor" },
      conditionId: "condition_character",
      actions: [{
        kind: "change_field",
        fieldId: "field_affinity",
        target: { kind: "trigger_actor" },
        delta: 10,
        effectGroupIds: ["effect_group_focus"],
      }],
      cooldownHours: 0,
      executionOrder: 1,
      createdAt,
      updatedAt: createdAt,
    },
  ];
  next.activeEffects = [];
  await store.transactV3(configured.revision, next, []);
  const runtime = createRuntime({ store, initialActors: [{ characterId: "T", name: "T", enabled: true }] });
  const beforeMessage = await store.readV3();

  const result = await runtime.processPersistedMessage({
    context: { chatId: "chat_main", actorId: "T", groupId: "group_main", actorName: "T" },
    currentActorId: "T",
    actorNamesById: { T: "T" },
    messageId: "message_production",
    variantId: null,
    content: "A composed production turn",
    role: "character",
    occurredAt: NOW,
    signals: {
      recentPositiveCount: null,
      userCareDetected: null,
      lastInteractionAt: null,
      messageCountInLast24Hours: null,
      specialDayDetected: null,
    },
    aiChanges: [{
      fieldId: "field_affinity",
      delta: 4,
      reason: "state AI",
      confidence: 0.9,
    }],
    aiRuleJudgements: [],
  });

  const committed = await store.readV3();
  assert.equal(committed.revision, beforeMessage.revision + 1);
  assert.equal(committed.dataset.stateValues["character:T"].field_affinity, 23);
  assert.equal(committed.dataset.stateValues["character:T"].field_excite, 10);
  assert.deepEqual(result.matchedRuleIds, ["rule_activate_focus", "rule_focus_gain"]);
  assert.equal(result.records.length, 7);
  assert.equal(result.records.some((record) => record.source === "natural"), true);
  assert.equal(result.records.some((record) => record.source === "per_turn"), true);
  assert.equal(result.records.some((record) => record.source === "ai" && record.reason.includes("state AI")), true);
  assert.equal(result.records.filter((record) => record.ruleIds.includes("link_affinity_excite")).length, 2);
  assert.equal(committed.dataset.activeEffects.length, 1);
  assert.equal(committed.dataset.activeEffects[0].triggerActorId, "T");
  assert.equal(committed.dataset.activeEffects[0].duration.remainingTurns, 1);
  assert.equal(committed.dataset.processedMessageIds.length, 1);
  assert.equal(Object.values(committed.dataset.messageFacts).flat().length, 1);
  assert.equal(Object.values(committed.dataset.hourlyMessageBuckets).flat()
    .reduce((sum, bucket) => sum + bucket.messageCount, 0), 1);
  assert.equal(committed.dataset.recordManifest.recordCount, 7);

  const persistedRecords = await store.queryRecords({ offset: 0, limit: 10, direction: "asc" });
  assert.deepEqual(persistedRecords.items.map((record) => record.id), result.records.map((record) => record.id));
  const storedLines = Object.entries(files.snapshot())
    .filter(([path]) => path.startsWith(`${RECORD_DIRECTORY}/segment-`))
    .flatMap(([, content]) => content.trim().split("\n").filter(Boolean).map(JSON.parse));
  assert.equal(storedLines.length, 7);
  assert.equal(storedLines.every((line) => line.commitRevision === committed.revision), true);

  const compatibility = await runtime.snapshot({
    chatId: "chat_main", actorId: "T", groupId: "group_main", actorName: "T",
  });
  assert.equal(compatibility.fields.find((field) => field.definition.id === "field_affinity").currentValue, 23);
  assert.equal(compatibility.records.length, 7);
});

test("hourly cleanup derives its horizon from every enabled condition window", async () => {
  const legacy = legacyDatasetFixture();
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  legacy.fields[0].bindingIds = ["T"];
  const { files } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();
  const before = await store.readV3();
  const next = structuredClone(before.dataset);
  const createdAt = new Date(NOW).toISOString();
  next.conditions = [
    {
      id: "condition_long_window",
      name: "Long window",
      description: "",
      enabled: true,
      expression: {
        kind: "not",
        child: {
          kind: "predicate",
          predicate: { kind: "high_frequency", messages: 999, windowHours: 10_000, bucketHours: 1 },
        },
      },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "condition_disabled_larger_window",
      name: "Disabled larger window",
      description: "",
      enabled: false,
      expression: {
        kind: "predicate",
        predicate: { kind: "high_frequency", messages: 999, windowHours: 20_000, bucketHours: 1 },
      },
      createdAt,
      updatedAt: createdAt,
    },
  ];
  next.rules = [];
  const eventKey = automationScopeKey({
    chatId: "chat_main", actorId: "T", groupId: "group_main", actorName: "T",
  });
  const currentHour = Math.floor(NOW / HOUR) * HOUR;
  next.hourlyMessageBuckets[eventKey] = [
    { startedAt: currentHour - 15_000 * HOUR, messageCount: 1 },
    { startedAt: currentHour - 9_000 * HOUR, messageCount: 2 },
  ];
  await store.transactV3(before.revision, next, []);
  const runtime = createRuntime({ store });

  await runtime.processPersistedMessage({
    context: { chatId: "chat_main", actorId: "T", groupId: "group_main", actorName: "T" },
    currentActorId: "T",
    messageId: "message_retention",
    variantId: null,
    content: "retention event",
    role: "user",
    occurredAt: NOW,
    signals: {
      recentPositiveCount: null,
      userCareDetected: null,
      lastInteractionAt: null,
      messageCountInLast24Hours: null,
      specialDayDetected: null,
    },
    aiChanges: [],
    aiRuleJudgements: [],
  });

  assert.deepEqual((await store.readV3()).dataset.hourlyMessageBuckets[eventKey], [
    { startedAt: currentHour - 9_000 * HOUR, messageCount: 2 },
    { startedAt: currentHour, messageCount: 1 },
  ]);
});

test("production IPC export pages every committed record while ordinary snapshots stay bounded", async (t) => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 1_001 }, (_, index) => changeRecord(index));
  const { files, serialized } = filesWithV2(legacy);
  const registrations = {};
  installProductionHost(t, files, {
    chatId: "chat_main",
    activePrompt: null,
    activeCharacter: null,
    activeGroup: null,
    characters: [],
    groups: [],
    members: [],
    currentCharacter: null,
  }, [], registrations, []);
  const runtime = createRuntime({ getConfigDir: () => CONFIG_DIR });
  assert.equal((await runtime.initialize()).mode, "v3");
  const uninstall = installMvuIpc(runtime, {
    async snapshot() { throw new Error("UNEXPECTED_EXPORT_SNAPSHOT"); },
    systemModel: {},
  });
  t.after(uninstall);

  assert.equal((await runtime.dataset()).records.length, 500);
  const response = await registrations.ipc["operit_mvu:export_dataset"]({});
  const exported = JSON.parse(files.snapshot()[response.savedPath]);
  const ids = exported.records.map((record) => record.id);

  assert.equal(exported.formatVersion, 2);
  assert.deepEqual(Object.keys(exported).sort(), Object.keys(legacy).sort());
  assert.equal(exported.records.length, 1_001);
  assert.equal(ids[0], "record_0");
  assert.equal(ids.at(-1), "record_1000");
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, Array.from({ length: 1_001 }, (_, index) => `record_${index}`));
  assert.equal(files.snapshot()[V2_PATH], serialized);
});

test("runtime import and repeated clear journal exact old paths and clean only superseded segments", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const { files } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();
  const runtime = createRuntime({ store });
  const before = await runtime.dataset();
  const replacement = structuredClone(before);
  replacement.records = Array.from({ length: 501 }, (_, index) => changeRecord(index + 1_000));
  const publication = files.pauseNext(
    "replaceAtomically",
    ({ destination }) => destination === V3_PATH,
  );

  const transaction = runtime.service.replaceDataset(replacement);
  await publication.entered;
  const duringPublication = files.snapshot();
  publication.release();
  await transaction;
  const journal = JSON.parse(duringPublication[V3_CLEANUP_PATH]);

  assert.equal(journal.expectedRevision, before.revision + 1);
  assert.deepEqual(journal.supersededPaths, [
    `${RECORD_DIRECTORY}/segment-000001.jsonl`,
    `${RECORD_DIRECTORY}/segment-000002.jsonl`,
  ]);
  assert.deepEqual(journal.expectedRecordManifest.segments.map(({ fileName }) => fileName), [
    "segment-000003.jsonl",
    "segment-000004.jsonl",
  ]);
  assert.equal(JSON.parse(duringPublication[V3_PATH]).revision, before.revision);
  assert.equal(typeof duringPublication[`${RECORD_DIRECTORY}/segment-000001.jsonl`], "string");
  assert.equal(typeof duringPublication[`${RECORD_DIRECTORY}/segment-000003.jsonl`], "string");
  assert.equal((await runtime.dataset()).records.length, 500);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], undefined);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], undefined);
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000003.jsonl`], "string");
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000004.jsonl`], "string");
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
  assert.deepEqual(
    (await store.queryRecords({ offset: 0, limit: 501, direction: "asc" })).items.map(({ id }) => id),
    Array.from({ length: 501 }, (_, index) => `record_${index + 1_000}`),
  );

  await runtime.clearRecords();
  await runtime.clearRecords();
  assert.equal((await store.queryRecords({ offset: 0, limit: 1 })).totalCount, 0);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000003.jsonl`], undefined);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000004.jsonl`], undefined);
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
});

test("post-commit partial cleanup resolves with pending status and resumes safely after restart", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const { files, serialized } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();
  const before = await store.read();
  const cleared = structuredClone(before.dataset);
  cleared.records = [];
  files.failNext(
    "deleteFile",
    ({ path }) => path === `${RECORD_DIRECTORY}/segment-000002.jsonl`,
  );

  const committed = await store.transact(before.revision, cleared);

  assert.equal(committed.revision, before.revision + 1);
  assert.equal(committed.dataset.records.length, 0);
  assert.equal(JSON.parse(files.snapshot()[V3_PATH]).recordManifest.recordCount, 0);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], undefined);
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], "string");
  assert.equal(typeof files.snapshot()[V3_CLEANUP_PATH], "string");
  const pending = await store.migrationStatus();
  assert.equal(pending.mode, "v3");
  assert.equal(pending.cleanup?.state, "pending");
  assert.match(pending.cleanup?.error.message ?? "", /FAKE_DELETEFILE_FAILED/);
  assert.equal(files.snapshot()[V2_PATH], serialized);
  assert.equal(JSON.parse(files.snapshot()[V2_PATH]).revision, legacy.revision);
  const restarted = v3Store(files, legacy);
  assert.equal((await restarted.initialize()).mode, "v3");
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], undefined);
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
  assert.equal((await restarted.queryRecords({ offset: 0, limit: 1 })).totalCount, 0);
  assert.equal(files.snapshot()[V2_PATH], serialized);
});

test("a cleanup journal whose config publication failed is discarded on restart without deleting committed paths", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const { files } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();
  const before = await store.read();
  const cleared = structuredClone(before.dataset);
  cleared.records = [];
  files.failNext("replaceAtomically", ({ destination }) => destination === V3_PATH);

  await assert.rejects(store.transact(before.revision, cleared), /FAKE_REPLACEATOMICALLY_FAILED/);

  assert.equal(JSON.parse(files.snapshot()[V3_PATH]).revision, before.revision);
  assert.equal(typeof files.snapshot()[V3_CLEANUP_PATH], "string");
  assert.equal(Object.keys(files.snapshot()).some((path) => path.startsWith(`${V3_PATH}.tmp.`)), false);
  const restarted = v3Store(files, legacy);
  assert.equal((await restarted.initialize()).mode, "v3");
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], "string");
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], "string");
  assert.equal((await restarted.queryRecords({ offset: 0, limit: 501 })).totalCount, 501);
});

test("valid v3 stays authoritative through cleanup failure, descendant append, and later recovery", async () => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const { files, serialized } = filesWithV2(legacy);
  const store = v3Store(files, legacy);
  await store.initialize();
  const before = await store.read();
  const cleared = structuredClone(before.dataset);
  cleared.records = [];
  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));
  await store.transact(before.revision, cleared);
  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));
  const restarted = v3Store(files, legacy);

  const pending = await restarted.initialize();
  assert.equal(pending.mode, "v3");
  assert.equal(pending.cleanup?.state, "pending");
  assert.match(pending.cleanup?.error.message ?? "", /FAKE_DELETEFILE_FAILED/);
  assert.equal((await restarted.readV3()).dataset.recordManifest.recordCount, 0);
  await assert.rejects(restarted.retryMigration(), /MVU_V3_MIGRATION_RETRY_NOT_ALLOWED/);

  const beforeAppend = await restarted.readV3();
  const next = structuredClone(beforeAppend.dataset);
  next.settings.aiEnabled = false;
  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));
  const committed = await restarted.transactV3(beforeAppend.revision, next, [changeRecord(9_000)]);
  const retainedJournal = JSON.parse(files.snapshot()[V3_CLEANUP_PATH]);

  assert.equal(committed.revision, beforeAppend.revision + 1);
  assert.equal(committed.dataset.settings.aiEnabled, false);
  assert.equal(committed.dataset.recordManifest.recordCount, 1);
  assert.equal(retainedJournal.expectedRevision, beforeAppend.revision);
  assert.equal(retainedJournal.expectedRevision < committed.revision, true);
  assert.equal((await restarted.migrationStatus()).mode, "v3");
  assert.equal((await restarted.migrationStatus()).cleanup?.state, "pending");
  assert.equal(files.snapshot()[V2_PATH], serialized);
  assert.equal(JSON.parse(files.snapshot()[V2_PATH]).revision, legacy.revision);

  const recovered = v3Store(files, legacy);
  const recoveredStatus = await recovered.initialize();
  assert.equal(recoveredStatus.mode, "v3");
  assert.equal(recoveredStatus.cleanup, undefined);
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], undefined);
  assert.equal((await recovered.readV3()).dataset.settings.aiEnabled, false);
  assert.deepEqual(
    (await recovered.queryRecords({ offset: 0, limit: 10, direction: "asc" })).items.map(({ id }) => id),
    ["record_9000"],
  );
  assert.equal(files.snapshot()[V2_PATH], serialized);
});

test("production runtime keeps valid v3 authoritative while cleanup is pending across a mutation", async (t) => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const { files, serialized } = filesWithV2(legacy);
  const seed = v3Store(files, legacy);
  await seed.initialize();
  const before = await seed.read();
  const cleared = structuredClone(before.dataset);
  cleared.records = [];
  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));
  await seed.transact(before.revision, cleared);

  installProductionHost(t, files, {
    chatId: "chat_main",
    activePrompt: null,
    activeCharacter: null,
    activeGroup: null,
    characters: [],
    groups: [],
    members: [],
    currentCharacter: null,
  }, [], {}, []);
  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));
  const runtime = createRuntime({ getConfigDir: () => CONFIG_DIR });

  const pending = await runtime.initialize();
  assert.equal(pending.mode, "v3");
  assert.equal(pending.cleanup?.state, "pending");
  assert.equal((await runtime.dataset()).records.length, 0);
  const beforeMutationRevision = (await runtime.dataset()).revision;
  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));
  await runtime.updateSettings({ aiEnabled: false });

  const committedV3 = JSON.parse(files.snapshot()[V3_PATH]);
  const retainedJournal = JSON.parse(files.snapshot()[V3_CLEANUP_PATH]);
  assert.equal(committedV3.revision, beforeMutationRevision + 1);
  assert.equal(committedV3.settings.aiEnabled, false);
  assert.equal(committedV3.recordManifest.recordCount, 0);
  assert.equal(retainedJournal.expectedRevision, beforeMutationRevision);
  assert.equal((await runtime.migrationStatus()).mode, "v3");
  assert.equal((await runtime.migrationStatus()).cleanup?.state, "pending");
  assert.equal(files.snapshot()[V2_PATH], serialized);
  assert.equal(JSON.parse(files.snapshot()[V2_PATH]).revision, legacy.revision);

  const recoveredRuntime = createRuntime({ getConfigDir: () => CONFIG_DIR });
  const recoveredStatus = await recoveredRuntime.initialize();
  assert.equal(recoveredStatus.mode, "v3");
  assert.equal(recoveredStatus.cleanup, undefined);
  assert.equal((await recoveredRuntime.dataset()).settings.aiEnabled, false);
  assert.equal((await recoveredRuntime.dataset()).records.length, 0);
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], undefined);
  assert.equal(files.snapshot()[V2_PATH], serialized);
});

test("production IPC import resolves after publication and reports pending cleanup until restart", async (t) => {
  const legacy = legacyDatasetFixture();
  legacy.records = Array.from({ length: 501 }, (_, index) => changeRecord(index));
  const { files, serialized } = filesWithV2(legacy);
  const registrations = {};
  installProductionHost(t, files, {
    chatId: "chat_main",
    activePrompt: null,
    activeCharacter: null,
    activeGroup: null,
    characters: [],
    groups: [],
    members: [],
    currentCharacter: null,
  }, [], registrations, []);
  const runtime = createRuntime({ getConfigDir: () => CONFIG_DIR });
  assert.equal((await runtime.initialize()).mode, "v3");
  const uninstall = installMvuIpc(runtime, {
    async snapshot() { throw new Error("UNEXPECTED_IMPORT_SNAPSHOT"); },
    systemModel: {},
  });
  t.after(uninstall);
  const before = await runtime.dataset();
  const replacement = structuredClone(before);
  replacement.records = [changeRecord(7_000)];
  const request = { json: JSON.stringify(replacement) };
  files.failNext("replaceAtomically", ({ destination }) => destination === V3_PATH);

  await assert.rejects(
    registrations.ipc["operit_mvu:import_dataset"](request),
    /FAKE_REPLACEATOMICALLY_FAILED/,
  );

  const unpublished = JSON.parse(files.snapshot()[V3_PATH]);
  assert.equal(unpublished.revision, before.revision);
  assert.equal(unpublished.recordManifest.recordCount, 501);
  assert.deepEqual(unpublished.recordManifest.segments.map(({ fileName }) => fileName), [
    "segment-000001.jsonl",
    "segment-000002.jsonl",
  ]);
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], "string");
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], "string");
  assert.equal(files.snapshot()[V2_PATH], serialized);

  files.failNext("deleteFile", ({ path }) => path.endsWith("segment-000002.jsonl"));

  const result = await registrations.ipc["operit_mvu:import_dataset"](request);

  assert.equal(result, undefined);
  const committed = JSON.parse(files.snapshot()[V3_PATH]);
  assert.equal(committed.revision, before.revision + 1);
  assert.equal(committed.recordManifest.recordCount, 1);
  assert.deepEqual(committed.recordManifest.segments.map(({ fileName }) => fileName), [
    "segment-000003.jsonl",
  ]);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], undefined);
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], "string");
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000003.jsonl`], "string");
  assert.equal(typeof files.snapshot()[V3_CLEANUP_PATH], "string");
  const pending = await runtime.migrationStatus();
  assert.equal(pending.mode, "v3");
  assert.equal(pending.cleanup?.state, "pending");
  assert.match(pending.cleanup?.error.message ?? "", /FAKE_DELETEFILE_FAILED/);
  assert.equal(files.snapshot()[V2_PATH], serialized);
  assert.equal(JSON.parse(files.snapshot()[V2_PATH]).revision, legacy.revision);

  const recoveredRuntime = createRuntime({ getConfigDir: () => CONFIG_DIR });
  const recoveredStatus = await recoveredRuntime.initialize();
  assert.equal(recoveredStatus.mode, "v3");
  assert.equal(recoveredStatus.cleanup, undefined);
  assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
  assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000002.jsonl`], undefined);
  assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000003.jsonl`], "string");
  assert.deepEqual((await recoveredRuntime.dataset()).records.map(({ id }) => id), ["record_7000"]);
  assert.equal(files.snapshot()[V2_PATH], serialized);
  assert.equal(JSON.parse(files.snapshot()[V2_PATH]).revision, legacy.revision);
});

test("owned record, repair, legacy config, and cleanup-journal temps are removed after ordinary rejection", async () => {
  {
    const files = createFakeMvuFileApi();
    const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });
    files.failNext("writeTextAfterWrite", ({ path }) => path.includes(".jsonl.stage."));
    await assert.rejects(records.stageAppend(createEmptyRecordManifest(), [changeRecord(1)], 1),
      /FAKE_WRITETEXTAFTERWRITE_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) => path.includes(".jsonl.stage.")), false);
    assert.equal(files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], undefined);
  }
  {
    const files = createFakeMvuFileApi();
    const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });
    files.failNext("replaceAtomically", ({ destination }) =>
      destination === `${RECORD_DIRECTORY}/segment-000001.jsonl`);
    await assert.rejects(records.stageAppend(createEmptyRecordManifest(), [changeRecord(1)], 1),
      /FAKE_REPLACEATOMICALLY_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) => path.includes(".jsonl.stage.")), false);
  }
  {
    const files = createFakeMvuFileApi();
    const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });
    const staged = await records.stageAppend(createEmptyRecordManifest(), [changeRecord(1)], 1);
    const segmentPath = `${RECORD_DIRECTORY}/segment-000001.jsonl`;
    await files.appendText(segmentPath, "orphan tail\n");
    files.failNext("writeTextAfterWrite", ({ path }) => path.includes(".repair.tmp."));
    await assert.rejects(records.validateAndRepair(staged.manifest, 1),
      /FAKE_WRITETEXTAFTERWRITE_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) => path.includes(".repair.tmp.")), false);
    assert.equal(lineCount(files.snapshot()[segmentPath]), 2);
    files.failNext("replaceAtomically", ({ destination }) => destination === segmentPath);
    await assert.rejects(records.validateAndRepair(staged.manifest, 1),
      /FAKE_REPLACEATOMICALLY_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) => path.includes(".repair.tmp.")), false);
    assert.equal(lineCount(files.snapshot()[segmentPath]), 2);
  }
  {
    const { files, serialized } = filesWithV2();
    const store = legacyStore(files);
    const before = await store.read();
    const next = structuredClone(before.dataset);
    next.settings.aiEnabled = false;
    files.failNext("writeTextAfterWrite", ({ path }) => path.startsWith(`${V2_PATH}.tmp.`));
    await assert.rejects(store.transact(before.revision, next), /FAKE_WRITETEXTAFTERWRITE_FAILED/);
    assert.equal(files.snapshot()[V2_PATH], serialized);
    assert.equal(Object.keys(files.snapshot()).some((path) => path.startsWith(`${V2_PATH}.tmp.`)), false);
    files.failNext("replaceAtomically", ({ destination }) => destination === V2_PATH);
    await assert.rejects(store.transact(before.revision, next), /FAKE_REPLACEATOMICALLY_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) => path.startsWith(`${V2_PATH}.tmp.`)), false);
  }
  {
    const legacy = legacyDatasetFixture();
    legacy.records = [changeRecord(1)];
    const { files } = filesWithV2(legacy);
    const store = v3Store(files, legacy);
    await store.initialize();
    const before = await store.read();
    const cleared = structuredClone(before.dataset);
    cleared.records = [];
    files.failNext("writeTextAfterWrite", ({ path }) => path.startsWith(`${V3_CLEANUP_PATH}.tmp.`));
    await assert.rejects(store.transact(before.revision, cleared), /FAKE_WRITETEXTAFTERWRITE_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) =>
      path.startsWith(`${V3_CLEANUP_PATH}.tmp.`)), false);
    assert.equal(JSON.parse(files.snapshot()[V3_PATH]).revision, before.revision);
    assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], "string");
    files.failNext("replaceAtomically", ({ destination }) => destination === V3_CLEANUP_PATH);
    await assert.rejects(store.transact(before.revision, cleared), /FAKE_REPLACEATOMICALLY_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) =>
      path.startsWith(`${V3_CLEANUP_PATH}.tmp.`)), false);
    assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
    files.failNext("writeTextAfterWrite", ({ path }) => path.startsWith(`${V3_PATH}.tmp.`));
    await assert.rejects(store.transact(before.revision, cleared), /FAKE_WRITETEXTAFTERWRITE_FAILED/);
    assert.equal(Object.keys(files.snapshot()).some((path) => path.startsWith(`${V3_PATH}.tmp.`)), false);
    assert.equal(typeof files.snapshot()[V3_CLEANUP_PATH], "string");
    const restarted = v3Store(files, legacy);
    assert.equal((await restarted.initialize()).mode, "v3");
    assert.equal(files.snapshot()[V3_CLEANUP_PATH], undefined);
    assert.equal(typeof files.snapshot()[`${RECORD_DIRECTORY}/segment-000001.jsonl`], "string");
  }
});
