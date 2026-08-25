import { klona } from "../port/util";
import {
  FULL_BACKUP_MAX_RECORDS,
  FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  createDatasetImportPreview,
  parseDatasetImport,
  type DatasetImportPreview,
  type DatasetImportRestoreRequest,
  type DatasetImportRestoreResult,
  type FullBackupSourceSnapshot,
} from "./full-backup";
import { migrateDatasetV2ToV3 } from "./migration-v3";
import { hydrateLegacyActiveEffectSnapshots } from "./effect-engine";
import type {
  AutoRuleCondition,
  DataAutoRule,
  DataChangeRecord,
  DataTemporaryEffect,
  MvuDataset,
} from "./model";
import type {
  ConditionPredicate,
  EffectGroupDefinition,
  EffectReasonConfig,
  MigrationResult,
  MvuDatasetV3,
  RecordManifest,
  RuleActionV3,
  RuleDefinitionV3,
} from "./model-v3";
import {
  EFFECT_REASON_SOURCE_MAX_LENGTH,
  V3_EFFECT_REASON_TEMPLATES,
} from "./model-v3";
import {
  assertRecordManifest,
  createEmptyRecordManifest,
  RECORDS_PER_SEGMENT,
  SegmentedRecordStore,
  type LatestFieldChange,
  type LatestFieldChangeTarget,
  type RecordQueryRequest,
  type RecordQueryResult,
} from "./record-store";
import type { MvuFileApi, MvuStore, MvuStoreSnapshot } from "./store";
import { publishOwnedTemporaryFile, StaleRevisionError } from "./store";
import {
  assertMvuDataset,
  assertMvuDatasetV3,
  normalizeLegacyV3EffectReasonData,
} from "./validation";

const V2_FILE_NAME = "operit_mvu.dataset.v2.json";
const V3_FILE_NAME = "operit_mvu.dataset.v3.json";
const V3_CLEANUP_FILE_NAME = "operit_mvu.records.v3.cleanup.json";
const COMPATIBILITY_RECORD_LIMIT = 500;
const MAX_SEGMENT_CLEANUP_COUNT = 1_024;
const runtimePathTails = new Map<string, Promise<void>>();
const runtimeRecoveryRequired = new Set<string>();

function isMvuDatasetV3Candidate(value: unknown): value is Pick<MvuDatasetV3, "effectGroups" | "activeEffects"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<MvuDatasetV3>;
  return candidate.formatVersion === 3 && Array.isArray(candidate.effectGroups) &&
    Array.isArray(candidate.activeEffects);
}

export interface V3MvuStoreSnapshot {
  revision: number;
  dataset: MvuDatasetV3;
}

export interface MigrationError {
  code: string;
  message: string;
}

export interface CleanupPendingStatus {
  state: "pending";
  error: MigrationError;
}

export type MigrationStatus =
  | {
      mode: "v3";
      source: "existing" | "migrated" | "initialized";
      report?: MigrationResult["report"];
      cleanup?: CleanupPendingStatus;
      indexing?: CleanupPendingStatus;
    }
  | { mode: "v2_compat"; error: MigrationError };

export interface V3MvuStoreOptions {
  getConfigDir: () => string;
  files: MvuFileApi;
  legacyStore: MvuStore;
  createInitialDataset: () => MvuDataset;
  now?: () => number;
}

type RecordMutation =
  | { kind: "append"; records: readonly DataChangeRecord[] }
  | { kind: "replace"; records: readonly DataChangeRecord[] };

interface SegmentCleanupJournal {
  formatVersion: 1;
  expectedRevision: number;
  expectedRecordManifest: RecordManifest;
  supersededPaths: string[];
}

export class V3UnavailableError extends Error {
  constructor(status: Extract<MigrationStatus, { mode: "v2_compat" }>) {
    super(`MVU_V3_UNAVAILABLE:${status.error.code}:${status.error.message}`);
    this.name = "V3UnavailableError";
  }
}

/**
 * Crash-safe v3 configuration store for one persistent ToolPkg main runtime.
 * The module path queue serializes store instances in that runtime and every
 * transaction rereads the durable revision before staging records. Atomic host
 * replacement is the publication boundary. This is deliberately not a
 * cross-process or external-writer CAS guarantee; production relies on the
 * host's unique `toolpkg_main:<container>` engine and owner-isolated storage.
 *
 * It also implements the v2 MvuStore shape as a temporary UI/service adapter
 * until the bounded v3 query APIs own every screen in Tasks 6-9.
 */
export class V3MvuStore implements MvuStore {
  private readonly getConfigDir: () => string;
  private readonly files: MvuFileApi;
  private readonly legacyStore: MvuStore;
  private readonly createInitialDataset: () => MvuDataset;
  private readonly now: () => number;
  private readonly records: SegmentedRecordStore;
  private initialization: Promise<MigrationStatus> | undefined;
  private retryInFlight: Promise<MigrationStatus> | undefined;
  private cleanupError: MigrationError | undefined;
  private indexingError: MigrationError | undefined;

  constructor(options: V3MvuStoreOptions) {
    this.getConfigDir = options.getConfigDir;
    this.files = options.files;
    this.legacyStore = options.legacyStore;
    this.createInitialDataset = options.createInitialDataset;
    this.now = options.now ?? Date.now;
    this.records = new SegmentedRecordStore({
      getConfigDir: options.getConfigDir,
      files: options.files,
    });
  }

  initialize(): Promise<MigrationStatus> {
    if (this.initialization === undefined) {
      this.initialization = this.enqueuePath(() => this.initializeAttempt(false));
    }
    return this.initialization;
  }

  async migrationStatus(): Promise<MigrationStatus> {
    const status = await this.initialize();
    return status.mode === "v3" ? this.withCleanupStatus(status) : status;
  }

  async retryMigration(): Promise<MigrationStatus> {
    if (this.retryInFlight !== undefined) return this.retryInFlight;
    const status = await this.initialize();
    if (this.retryInFlight !== undefined) return this.retryInFlight;
    if (status.mode !== "v2_compat") {
      throw new Error("MVU_V3_MIGRATION_RETRY_NOT_ALLOWED");
    }
    if (this.retryInFlight !== undefined) return this.retryInFlight;
    const retry = this.enqueuePath(() => this.initializeAttempt(true));
    this.retryInFlight = retry;
    this.initialization = retry;
    try {
      return await retry;
    } finally {
      if (this.retryInFlight === retry) this.retryInFlight = undefined;
    }
  }

  async readV3(): Promise<V3MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(() => this.loadV3Config());
  }

  async transactV3(
    expectedRevision: number,
    next: MvuDatasetV3,
    newRecords: readonly DataChangeRecord[],
  ): Promise<V3MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      await this.recoverIfRequired(current);
      return this.commitLoaded(current, expectedRevision, next, {
        kind: "append",
        records: newRecords,
      });
    });
  }

  async queryRecords(request: RecordQueryRequest): Promise<RecordQueryResult> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    if (request.fieldId !== undefined && status.indexing !== undefined) {
      throw new Error("MVU_V3_RECORD_INDEX_UNAVAILABLE");
    }
    return this.enqueuePath(async () => {
      const snapshot = await this.loadV3Config();
      return this.records.queryRecords(snapshot.dataset.recordManifest, request);
    });
  }

  async queryLatestFieldChanges(
    targets: readonly LatestFieldChangeTarget[],
  ): Promise<LatestFieldChange[]> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(async () => {
      const snapshot = await this.loadV3Config();
      return this.records.queryLatestFieldChanges(snapshot.dataset.recordManifest, targets);
    });
  }

  /**
   * Explicit complete read for full-dataset backup. The path queue is held from
   * config read through the final committed record page, so config and history
   * always describe one revision. This path deliberately has no compatibility
   * record cap.
   */
  async readFullBackup(): Promise<FullBackupSourceSnapshot> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      await this.recoverIfRequired(current);
      if (current.dataset.recordManifest.recordCount > FULL_BACKUP_MAX_RECORDS) {
        throw new Error("MVU_FULL_BACKUP_RECORD_LIMIT");
      }
      const committedRecords = await this.readAllCommittedRecords(current.dataset);
      return {
        revision: current.revision,
        dataset: klona(current.dataset),
        records: klona(committedRecords),
      };
    });
  }

  async previewDatasetImport(json: string): Promise<DatasetImportPreview> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      return createDatasetImportPreview(json, current.revision, this.now());
    });
  }

  /** Reparse, validate, stage, and publish one exact replacement under the path queue. */
  async restoreDatasetImport(request: DatasetImportRestoreRequest): Promise<DatasetImportRestoreResult> {
    if (request.confirmation !== FULL_BACKUP_REPLACEMENT_CONFIRMATION) {
      throw new Error("MVU_FULL_BACKUP_CONFIRMATION_INVALID");
    }
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(async () => {
      // The restore endpoint never trusts a prior preview object. The exact JSON
      // supplied for this call is parsed and checksummed again while serialized.
      const parsed = parseDatasetImport(request.json, this.now());
      const current = await this.loadV3Config();
      if (request.expectedRevision !== current.revision) {
        throw new StaleRevisionError(request.expectedRevision, current.revision);
      }
      await this.recoverIfRequired(current);
      const next: MvuDatasetV3 = {
        ...klona(parsed.config),
        revision: current.revision,
        recordManifest: klona(current.dataset.recordManifest),
      };
      assertMvuDatasetV3(next);
      const committed = await this.commitLoaded(current, request.expectedRevision, next, {
        kind: "replace",
        records: parsed.records,
      });
      return {
        revision: committed.revision,
        kind: parsed.kind,
        sourceFormatVersion: parsed.sourceFormatVersion,
        sourceRevision: parsed.sourceRevision,
        recordCount: parsed.records.length,
        migrationWarnings: {
          items: [...parsed.warnings],
          totalCount: parsed.warningCount,
          truncated: parsed.warningCount > parsed.warnings.length,
        },
      };
    });
  }

  async read(): Promise<MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode === "v2_compat") return this.legacyStore.read();
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      const committedRecords = await this.readCompatibilityRecords(current.dataset);
      return compatibilitySnapshot(current.dataset, committedRecords);
    });
  }

  async transact(expectedRevision: number, next: MvuDataset): Promise<MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode === "v2_compat") return this.legacyStore.transact(expectedRevision, next);
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      await this.recoverIfRequired(current);
      if (current.revision !== expectedRevision) {
        throw new StaleRevisionError(expectedRevision, current.revision);
      }
      const currentRecords = await this.readCompatibilityRecords(current.dataset);
      const projected = compatibilityDataset(current.dataset, currentRecords);
      assertMvuDataset(next);
      assertCompatibilityEffectReasonEdits(projected.temporaryEffects, next.temporaryEffects);
      const merged = mergeCompatibilityDataset(current.dataset, projected, next, this.now());
      const recordMutation = compatibilityRecordMutation(currentRecords, next.records);
      const committed = await this.commitLoaded(
        current,
        expectedRevision,
        merged,
        recordMutation,
      );
      return compatibilitySnapshot(committed.dataset, next.records.slice(-COMPATIBILITY_RECORD_LIMIT));
    });
  }

  private async initializeAttempt(forceRebuild: boolean): Promise<MigrationStatus> {
    try {
      const configDir = this.configDir();
      const v3Path = this.v3Path(configDir);
      if (await this.files.exists(v3Path)) {
        let existing: V3MvuStoreSnapshot | undefined;
        let normalizationWarnings: string[] = [];
        try {
          const loaded = await this.loadV3ConfigWithWarnings();
          const candidate = loaded.snapshot;
          normalizationWarnings = loaded.warnings;
          const validation = await this.records.validateAndRepair(
            candidate.dataset.recordManifest,
            candidate.revision,
          );
          if (validation.indexBackfilled) {
            try {
              await this.persistRecordIndexBackfill(v3Path, candidate, validation.manifest);
              candidate.dataset.recordManifest = validation.manifest;
              this.indexingError = undefined;
            } catch (error) {
              // A fully validated v3 config remains authoritative even when
              // its maintenance-only index publication is interrupted.
              this.indexingError = structuredMigrationError(error);
            }
          } else {
            this.indexingError = undefined;
          }
          existing = candidate;
        } catch (error) {
          if (!forceRebuild) throw error;
        }
        if (existing !== undefined) {
          // Once config and committed records validate, v3 is authoritative.
          // Superseded-file deletion is resumable maintenance, not migration.
          runtimeRecoveryRequired.delete(v3Path);
          await this.tryResumeSegmentCleanup(existing.dataset);
          return this.withCleanupStatus({
            mode: "v3",
            source: "existing",
            ...(normalizationWarnings.length === 0
              ? {}
              : { report: normalizationReport(existing.dataset, normalizationWarnings) }),
          });
        }
      }

      // With no valid published v3 config, a cleanup journal cannot match a
      // committed replacement. Remove only the journal, never its listed data.
      await this.discardCleanupJournal();

      const v2Path = `${configDir}/${V2_FILE_NAME}`;
      const hasV2 = await this.files.exists(v2Path);
      const legacySnapshot = hasV2
        ? await this.legacyStore.read()
        : { revision: 0, dataset: klona(this.createInitialDataset()) };
      assertMvuDataset(legacySnapshot.dataset);
      const migration = migrateDatasetV2ToV3(legacySnapshot.dataset, this.now());
      validateMigrationResult(legacySnapshot.dataset, migration);
      if (!Number.isSafeInteger(migration.dataset.revision + 1)) {
        throw new Error("MVU_V3_REVISION_OVERFLOW");
      }
      const commitRevision = migration.dataset.revision + 1;
      runtimeRecoveryRequired.add(v3Path);
      const staged = await this.records.stageReplace(
        createEmptyRecordManifest(),
        migration.records,
        commitRevision,
      );
      const committed = klona(migration.dataset);
      committed.revision = commitRevision;
      committed.recordManifest = staged.manifest;
      assertMvuDatasetV3(committed);
      await this.records.validateAndRepair(committed.recordManifest, committed.revision);
      await this.persistConfig(v3Path, committed);
      runtimeRecoveryRequired.delete(v3Path);
      this.cleanupError = undefined;
      this.indexingError = undefined;
      return {
        mode: "v3",
        source: hasV2 ? "migrated" : "initialized",
        report: migration.report,
      };
    } catch (error) {
      return {
        mode: "v2_compat",
        error: structuredMigrationError(error),
      };
    }
  }

  private async loadV3Config(): Promise<V3MvuStoreSnapshot> {
    return (await this.loadV3ConfigWithWarnings()).snapshot;
  }

  private async loadV3ConfigWithWarnings(): Promise<{
    snapshot: V3MvuStoreSnapshot;
    warnings: string[];
  }> {
    const path = this.v3Path(this.configDir());
    if (!(await this.files.exists(path))) throw new Error("MVU_V3_CONFIG_MISSING");
    const raw = await this.files.readText(path);
    const parsed = klona(JSON.parse(raw) as unknown);
    let warnings: string[] = [];
    if (isMvuDatasetV3Candidate(parsed)) {
      warnings = normalizeLegacyV3EffectReasonData(parsed);
      hydrateLegacyActiveEffectSnapshots(parsed);
    }
    assertMvuDatasetV3(parsed);
    return {
      snapshot: { revision: parsed.revision, dataset: klona(parsed) },
      warnings,
    };
  }

  private async commitLoaded(
    current: V3MvuStoreSnapshot,
    expectedRevision: number,
    next: MvuDatasetV3,
    recordMutation: RecordMutation,
  ): Promise<V3MvuStoreSnapshot> {
    if (expectedRevision !== current.revision) {
      throw new StaleRevisionError(expectedRevision, current.revision);
    }
    if (JSON.stringify(next.recordManifest) !== JSON.stringify(current.dataset.recordManifest)) {
      throw new Error("MVU_V3_RECORD_MANIFEST_IS_STORE_OWNED");
    }
    if (!Number.isSafeInteger(current.revision + 1)) {
      throw new Error("MVU_V3_REVISION_OVERFLOW");
    }
    assertMvuDatasetV3(next);
    const commitRevision = current.revision + 1;
    const configPath = this.v3Path(this.configDir());
    let supersededPaths: string[] = [];
    if (recordMutation.kind === "replace") {
      if (current.dataset.recordManifest.segments.length > MAX_SEGMENT_CLEANUP_COUNT) {
        throw new Error("MVU_V3_SEGMENT_CLEANUP_LIMIT");
      }
      supersededPaths = current.dataset.recordManifest.segments.map((segment) =>
        `${this.records.directoryPath()}/${segment.fileName}`);
    }
    runtimeRecoveryRequired.add(configPath);
    const staged = recordMutation.kind === "append"
      ? await this.records.stageAppend(current.dataset.recordManifest, recordMutation.records, commitRevision)
      : await this.records.stageReplace(current.dataset.recordManifest, recordMutation.records, commitRevision);
    const committed = klona(next);
    committed.revision = commitRevision;
    committed.recordManifest = staged.manifest;
    hydrateLegacyActiveEffectSnapshots(committed);
    assertMvuDatasetV3(committed);
    if (supersededPaths.length > 0) {
      const publishedPaths = new Set(committed.recordManifest.segments.map((segment) =>
        `${this.records.directoryPath()}/${segment.fileName}`));
      supersededPaths = supersededPaths.filter((path) => !publishedPaths.has(path));
      const journal: SegmentCleanupJournal = {
        formatVersion: 1,
        expectedRevision: committed.revision,
        expectedRecordManifest: klona(committed.recordManifest),
        supersededPaths,
      };
      assertSegmentCleanupJournal(journal, this.records.directoryPath());
      await this.persistCleanupJournal(journal);
    }
    await this.persistConfig(configPath, committed);
    runtimeRecoveryRequired.delete(configPath);
    if (supersededPaths.length > 0) await this.tryResumeSegmentCleanup(committed);
    return { revision: committed.revision, dataset: klona(committed) };
  }

  private async readCompatibilityRecords(dataset: MvuDatasetV3): Promise<DataChangeRecord[]> {
    if (dataset.recordManifest.recordCount === 0) return [];
    const records = (await this.records.queryRecords(dataset.recordManifest, {
      offset: 0,
      limit: Math.min(COMPATIBILITY_RECORD_LIMIT, dataset.recordManifest.recordCount),
      direction: "desc",
    })).items;
    records.reverse();
    return records;
  }

  private async readAllCommittedRecords(dataset: MvuDatasetV3): Promise<DataChangeRecord[]> {
    const records: DataChangeRecord[] = [];
    let offset = 0;
    while (offset < dataset.recordManifest.recordCount) {
      const page = await this.records.queryRecords(dataset.recordManifest, {
        offset,
        limit: COMPATIBILITY_RECORD_LIMIT,
        direction: "asc",
      });
      if (page.loadedCount === 0 || page.nextOffset === offset) {
        throw new Error("MVU_V3_RECORD_EXPORT_STALLED");
      }
      records.push(...page.items);
      offset += page.loadedCount;
    }
    if (records.length !== dataset.recordManifest.recordCount) {
      throw new Error("MVU_V3_RECORD_EXPORT_COUNT_MISMATCH");
    }
    return records;
  }

  private async persistConfig(path: string, dataset: MvuDatasetV3): Promise<void> {
    const configDir = this.configDir();
    if (!(await this.files.exists(configDir))) await this.files.mkdir(configDir);
    const temporaryPath = `${path}.tmp.${nextTransactionId()}`;
    await publishOwnedTemporaryFile(
      this.files,
      temporaryPath,
      path,
      JSON.stringify(dataset, null, 2),
    );
  }

  private async persistRecordIndexBackfill(
    path: string,
    candidate: V3MvuStoreSnapshot,
    indexedManifest: RecordManifest,
  ): Promise<void> {
    const durable = await this.loadV3Config();
    if (durable.revision !== candidate.revision ||
      JSON.stringify(durable.dataset) !== JSON.stringify(candidate.dataset)) {
      throw new Error("MVU_V3_RECORD_INDEX_BACKFILL_STALE");
    }
    const indexed = klona(candidate.dataset);
    indexed.recordManifest = klona(indexedManifest);
    assertMvuDatasetV3(indexed);
    await this.persistConfig(path, indexed);
  }

  private async persistCleanupJournal(journal: SegmentCleanupJournal): Promise<void> {
    const path = this.cleanupPath(this.configDir());
    const temporaryPath = `${path}.tmp.${nextTransactionId()}`;
    await publishOwnedTemporaryFile(
      this.files,
      temporaryPath,
      path,
      JSON.stringify(journal, null, 2),
    );
  }

  private async resumeSegmentCleanup(committed: MvuDatasetV3): Promise<void> {
    const journalPath = this.cleanupPath(this.configDir());
    if (!(await this.files.exists(journalPath))) return;
    const parsed = JSON.parse(await this.files.readText(journalPath)) as unknown;
    assertSegmentCleanupJournal(parsed, this.records.directoryPath());
    const exactPublication = parsed.expectedRevision === committed.revision &&
      recordManifestsMatchWithIndexBackfill(parsed.expectedRecordManifest, committed.recordManifest);
    const descendantPublication = committed.revision > parsed.expectedRevision &&
      isRecordManifestDescendant(parsed.expectedRecordManifest, committed.recordManifest);
    if (!exactPublication && !descendantPublication) {
      if (committed.revision > parsed.expectedRevision) {
        throw new Error("MVU_V3_SEGMENT_CLEANUP_DESCENDANT_UNPROVEN");
      }
      await this.files.deleteFile(journalPath);
      return;
    }

    const publishedPaths = new Set(committed.recordManifest.segments.map((segment) =>
      `${this.records.directoryPath()}/${segment.fileName}`));
    for (const path of parsed.supersededPaths) {
      if (publishedPaths.has(path)) {
        throw new Error("MVU_V3_SEGMENT_CLEANUP_PROTECTED_PATH");
      }
    }
    for (const path of parsed.supersededPaths) {
      if (await this.files.exists(path)) await this.files.deleteFile(path);
    }
    await this.files.deleteFile(journalPath);
  }

  private async tryResumeSegmentCleanup(committed: MvuDatasetV3): Promise<void> {
    try {
      await this.resumeSegmentCleanup(committed);
      this.cleanupError = undefined;
    } catch (error) {
      this.cleanupError = structuredMigrationError(error);
    }
  }

  private withCleanupStatus(
    status: Extract<MigrationStatus, { mode: "v3" }>,
  ): Extract<MigrationStatus, { mode: "v3" }> {
    const decorated: Extract<MigrationStatus, { mode: "v3" }> = {
      mode: "v3",
      source: status.source,
    };
    if (status.report !== undefined) decorated.report = status.report;
    if (this.cleanupError !== undefined) {
      decorated.cleanup = { state: "pending", error: { ...this.cleanupError } };
    }
    if (this.indexingError !== undefined) {
      decorated.indexing = { state: "pending", error: { ...this.indexingError } };
    }
    return decorated;
  }

  private async discardCleanupJournal(): Promise<void> {
    const path = this.cleanupPath(this.configDir());
    if (await this.files.exists(path)) await this.files.deleteFile(path);
  }

  private async recoverIfRequired(current: V3MvuStoreSnapshot): Promise<void> {
    const path = this.v3Path(this.configDir());
    if (runtimeRecoveryRequired.has(path)) {
      await this.records.validateAndRepair(current.dataset.recordManifest, current.revision);
      runtimeRecoveryRequired.delete(path);
    }
    await this.tryResumeSegmentCleanup(current.dataset);
  }

  private enqueuePath<T>(operation: () => Promise<T>): Promise<T> {
    return enqueueRuntimePath(this.v3Path(this.configDir()), operation);
  }

  private configDir(): string {
    const value = this.getConfigDir().replace(/[\\/]+$/, "");
    if (value.length === 0) throw new Error("MVU_CONFIG_DIR_EMPTY");
    return value;
  }

  private v3Path(configDir: string): string {
    return `${configDir}/${V3_FILE_NAME}`;
  }

  private cleanupPath(configDir: string): string {
    return `${configDir}/${V3_CLEANUP_FILE_NAME}`;
  }
}

export function isV3MvuStore(store: MvuStore): store is V3MvuStore {
  return store instanceof V3MvuStore;
}

function assertSegmentCleanupJournal(
  value: unknown,
  recordsDirectory: string,
): asserts value is SegmentCleanupJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("MVU_V3_SEGMENT_CLEANUP_JOURNAL_INVALID");
  }
  const candidate = value as Partial<SegmentCleanupJournal>;
  if (Object.keys(candidate).sort().join(",") !==
      "expectedRecordManifest,expectedRevision,formatVersion,supersededPaths" ||
    candidate.formatVersion !== 1 ||
    !Number.isSafeInteger(candidate.expectedRevision) ||
    (candidate.expectedRevision ?? -1) < 0 ||
    !Array.isArray(candidate.supersededPaths) ||
    candidate.supersededPaths.length < 1 ||
    candidate.supersededPaths.length > MAX_SEGMENT_CLEANUP_COUNT) {
    throw new Error("MVU_V3_SEGMENT_CLEANUP_JOURNAL_INVALID");
  }
  assertRecordManifest(candidate.expectedRecordManifest);
  const expectedManifest = candidate.expectedRecordManifest as RecordManifest;
  const protectedPaths = new Set(expectedManifest.segments.map((segment) =>
    `${recordsDirectory}/${segment.fileName}`));
  const seen = new Set<string>();
  for (const path of candidate.supersededPaths) {
    if (typeof path !== "string" || seen.has(path) || protectedPaths.has(path)) {
      throw new Error("MVU_V3_SEGMENT_CLEANUP_JOURNAL_INVALID");
    }
    const prefix = `${recordsDirectory}/`;
    const fileName = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    const match = /^segment-(\d+)\.jsonl$/.exec(fileName);
    const index = match === null ? Number.NaN : Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 1 ||
      fileName !== `segment-${String(index).padStart(6, "0")}.jsonl`) {
      throw new Error("MVU_V3_SEGMENT_CLEANUP_JOURNAL_INVALID");
    }
    seen.add(path);
  }
}

function isRecordManifestDescendant(
  expected: RecordManifest,
  current: RecordManifest,
): boolean {
  if (current.recordCount < expected.recordCount ||
    current.nextSegmentIndex < expected.nextSegmentIndex ||
    current.segments.length < expected.segments.length) {
    return false;
  }
  if (expected.segments.length === 0) {
    return current.segments.length === 0 ||
      current.segments[0].index >= expected.nextSegmentIndex;
  }

  const lastExpectedPosition = expected.segments.length - 1;
  for (let position = 0; position < expected.segments.length; position += 1) {
    const ancestor = expected.segments[position];
    const descendant = current.segments[position];
    if (ancestor.index !== descendant.index || ancestor.fileName !== descendant.fileName) return false;
    if (position < lastExpectedPosition ||
      ancestor.committedLineCount === RECORDS_PER_SEGMENT ||
      ancestor.committedLineCount === descendant.committedLineCount) {
      if (!recordSegmentsMatchWithIndexBackfill(ancestor, descendant)) return false;
      continue;
    }
    if (descendant.committedLineCount < ancestor.committedLineCount ||
      descendant.firstRevision !== ancestor.firstRevision ||
      descendant.lastRevision < ancestor.lastRevision ||
      descendant.firstOccurredAt > ancestor.firstOccurredAt ||
      descendant.lastOccurredAt < ancestor.lastOccurredAt) {
      return false;
    }
  }
  if (current.segments.length > expected.segments.length &&
    current.segments[expected.segments.length].index < expected.nextSegmentIndex) {
    return false;
  }
  return true;
}

function recordManifestsMatchWithIndexBackfill(
  expected: RecordManifest,
  current: RecordManifest,
): boolean {
  return expected.recordCount === current.recordCount &&
    expected.nextSegmentIndex === current.nextSegmentIndex &&
    expected.segments.length === current.segments.length &&
    expected.segments.every((segment, index) =>
      recordSegmentsMatchWithIndexBackfill(segment, current.segments[index]));
}

function recordSegmentsMatchWithIndexBackfill(
  expected: RecordManifest["segments"][number],
  current: RecordManifest["segments"][number],
): boolean {
  if (expected.filterCounts !== undefined) return JSON.stringify(expected) === JSON.stringify(current);
  const { filterCounts: _currentIndex, ...currentWithoutIndex } = current;
  return JSON.stringify(expected) === JSON.stringify(currentWithoutIndex);
}

function compatibilitySnapshot(dataset: MvuDatasetV3, records: readonly DataChangeRecord[]): MvuStoreSnapshot {
  const compatibility = compatibilityDataset(dataset, records);
  return { revision: dataset.revision, dataset: klona(compatibility) };
}

function compatibilityDataset(
  dataset: MvuDatasetV3,
  records: readonly DataChangeRecord[],
): MvuDataset {
  const effects = compatibilityEffects(dataset);
  const effectIds = new Set(effects.map((effect) => effect.id));
  const autoRules = compatibilityRules(dataset, effectIds);
  const compatibility: MvuDataset = {
    formatVersion: 2,
    createdAt: Date.parse(dataset.createdAt),
    revision: dataset.revision,
    settings: klona(dataset.settings),
    fields: klona(dataset.fields),
    pendingBootstrapFieldIds: [...dataset.pendingBootstrapFieldIds],
    rules: klona(dataset.linkRules),
    autoRules,
    temporaryEffects: effects,
    stateValues: klona(dataset.stateValues),
    records: records.map((record) => klona(record)),
    lastSettled: klona(dataset.lastSettled),
    turnCounters: klona(dataset.turnCounters),
    processedMessageIds: [...dataset.processedMessageIds],
    ruleLastTriggered: klona(dataset.ruleLastTriggered),
    messageFacts: klona(dataset.messageFacts),
  };
  assertMvuDataset(compatibility);
  return compatibility;
}

function compatibilityEffects(dataset: MvuDatasetV3): DataTemporaryEffect[] {
  const effects: DataTemporaryEffect[] = [];
  for (const definition of dataset.effectGroups) {
    const operation = compatibleEffectOperation(definition);
    if (operation === null) continue;
    const instances = dataset.activeEffects.filter((instance) => instance.definitionId === definition.id);
    const targets = instances.flatMap((instance) => instance.resolvedTargets).map((target) => ({
      fieldId: target.fieldId,
      scope: target.scope,
      scopeKey: target.scopeKey,
    }));
    if (targets.length === 0) continue;
    const duration = compatibilityInstanceDuration(instances);
    const reason = compatibilityReason(definition.defaultReason);
    effects.push({
      id: legacyEffectId(definition.id),
      targets: uniqueTargets(targets),
      mode: operation.mode,
      value: operation.value,
      enabled: definition.enabled && instances.length > 0,
      expiresAt: duration.expiresAt === null ? null : Date.parse(duration.expiresAt),
      remainingTurns: duration.remainingTurns,
      reasonMode: reason.reasonMode,
      reasonTemplate: reason.reasonTemplate,
      reason: reason.reason,
      createdAt: Date.parse(definition.createdAt),
    });
  }
  return effects;
}

function compatibilityReason(reason: EffectReasonConfig): Pick<
  DataTemporaryEffect,
  "reasonMode" | "reasonTemplate" | "reason"
> {
  if (reason.mode === "custom") {
    return { reasonMode: "custom", reasonTemplate: "general", reason: reason.text };
  }
  if (reason.template === "general") {
    return { reasonMode: "template", reasonTemplate: "general", reason: reason.text };
  }
  return {
    reasonMode: "custom",
    reasonTemplate: "general",
    reason: V3_EFFECT_REASON_TEMPLATES[reason.template],
  };
}

function compatibleEffectOperation(
  definition: EffectGroupDefinition,
): { mode: DataTemporaryEffect["mode"]; value: number } | null {
  const operations = definition.fieldEffects.flatMap((effect) => effect.operations);
  if (operations.length === 0 || operations.some((operation) =>
    operation.kind !== "fixed_adjustment" && operation.kind !== "all_multiplier")) return null;
  const first = operations[0];
  if (operations.some((operation) => operation.kind !== first.kind || operation.value !== first.value)) return null;
  return {
    mode: first.kind === "fixed_adjustment" ? "additive" : "multiplier",
    value: first.value,
  };
}

function compatibilityRules(dataset: MvuDatasetV3, effectIds: ReadonlySet<string>): DataAutoRule[] {
  const conditions = new Map(dataset.conditions.map((condition) => [condition.id, condition]));
  const rules: DataAutoRule[] = [];
  for (const rule of dataset.rules) {
    const conditionDefinition = conditions.get(rule.conditionId);
    if (conditionDefinition === undefined || conditionDefinition.expression.kind !== "predicate") continue;
    const condition = compatibilityCondition(conditionDefinition.expression.predicate);
    if (condition === null || rule.actions.some((action) => action.kind !== "change_field")) continue;
    const effects = rule.actions.map((action) => {
      if (action.kind !== "change_field") throw new Error("MVU_V3_COMPAT_RULE_ACTION_INVALID");
      return {
        fieldId: action.fieldId,
        delta: action.delta,
        temporaryEffectIds: action.effectGroupIds
          .map(legacyEffectId)
          .filter((id) => effectIds.has(id)),
      };
    });
    if (effects.length === 0) continue;
    rules.push({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      condition,
      effects,
      cooldownMs: rule.cooldownHours * 3_600_000,
      order: rule.executionOrder,
    });
  }
  return rules;
}

function compatibilityCondition(predicate: ConditionPredicate): AutoRuleCondition | null {
  switch (predicate.kind) {
    case "recent_positive": return { kind: "recentPositive", count: predicate.count };
    case "long_inactive": return { kind: "longInactive", hours: predicate.hours };
    case "user_care": return { kind: "userCare" };
    case "special_day": return { kind: "specialDay" };
    case "high_frequency": return { kind: "highFreq", messages: predicate.messages };
    case "field_comparison": {
      if (predicate.operator === "==") return null;
      return {
        kind: "stateThreshold",
        fieldId: predicate.fieldId,
        operator: predicate.operator,
        threshold: predicate.value,
      };
    }
    case "ai_semantic": return {
      kind: "aiJudgement",
      triggerType: predicate.triggerType,
      requirement: predicate.requirement,
      minimumConfidence: predicate.minimumConfidence,
    };
    default: return null;
  }
}

function mergeCompatibilityDataset(
  current: MvuDatasetV3,
  projected: MvuDataset,
  next: MvuDataset,
  now: number,
): MvuDatasetV3 {
  const merged = klona(current);
  merged.settings = klona(next.settings);
  merged.fields = klona(next.fields);
  merged.pendingBootstrapFieldIds = [...next.pendingBootstrapFieldIds];
  merged.linkRules = klona(next.rules);
  merged.stateValues = klona(next.stateValues);
  merged.lastSettled = klona(next.lastSettled);
  merged.turnCounters = klona(next.turnCounters);
  merged.processedMessageIds = [...next.processedMessageIds];
  merged.ruleLastTriggered = klona(next.ruleLastTriggered);
  merged.messageFacts = klona(next.messageFacts);
  const autoRulesChanged = JSON.stringify(next.autoRules) !== JSON.stringify(projected.autoRules);
  const temporaryEffectsChanged = JSON.stringify(next.temporaryEffects) !==
    JSON.stringify(projected.temporaryEffects);
  if (autoRulesChanged || temporaryEffectsChanged) {
    const migrated = migrateDatasetV2ToV3({ ...klona(next), records: [] }, now).dataset;
    if (autoRulesChanged) {
      const reconciled = reconcileCompatibilityRules(current, projected, next, migrated);
      merged.conditions = reconciled.conditions;
      merged.rules = reconciled.rules;
    }
    if (temporaryEffectsChanged) {
      const reconciled = reconcileCompatibilityEffects(current, projected, next, migrated, now);
      merged.effectGroups = reconciled.effectGroups;
      merged.activeEffects = reconciled.activeEffects;
    }
  }
  merged.revision = current.revision;
  merged.recordManifest = klona(current.recordManifest);
  assertMvuDatasetV3(merged);
  return merged;
}

function reconcileCompatibilityRules(
  current: MvuDatasetV3,
  projected: MvuDataset,
  next: MvuDataset,
  migrated: MvuDatasetV3,
): Pick<MvuDatasetV3, "conditions" | "rules"> {
  const projectedById = new Map(projected.autoRules.map((rule) => [rule.id, rule]));
  const nextById = new Map(next.autoRules.map((rule) => [rule.id, rule]));
  const migratedRulesById = new Map(migrated.rules.map((rule) => [rule.id, rule]));
  const migratedConditionsById = new Map(migrated.conditions.map((condition) => [condition.id, condition]));
  const currentRulesById = new Map(current.rules.map((rule) => [rule.id, rule]));
  const touchedRuleIds = new Set<string>();

  for (const [id, rule] of projectedById) {
    const replacement = nextById.get(id);
    if (replacement === undefined || JSON.stringify(replacement) !== JSON.stringify(rule)) {
      touchedRuleIds.add(id);
    }
  }
  for (const id of nextById.keys()) {
    if (!projectedById.has(id)) touchedRuleIds.add(id);
  }

  const rules = current.rules.map((rule) => klona(rule));
  const conditions = current.conditions.map((condition) => klona(condition));
  const projectedEffectIds = new Set(projected.temporaryEffects.map((effect) => effect.id));
  for (const id of touchedRuleIds) {
    const currentRule = currentRulesById.get(id);
    const projectedRule = projectedById.get(id);
    if (currentRule !== undefined && projectedRule === undefined) {
      throw new Error(`MVU_V3_COMPAT_RULE_ID_CONFLICT:${id}`);
    }
    const nextRule = nextById.get(id);
    if (nextRule === undefined) {
      const index = rules.findIndex((rule) => rule.id === id);
      if (index >= 0) rules.splice(index, 1);
      continue;
    }
    const migratedRule = migratedRulesById.get(id);
    if (migratedRule === undefined) throw new Error(`MVU_V3_COMPAT_RULE_MIGRATION_MISSING:${id}`);
    const migratedCondition = migratedConditionsById.get(migratedRule.conditionId);
    if (migratedCondition === undefined) {
      throw new Error(`MVU_V3_COMPAT_CONDITION_MIGRATION_MISSING:${migratedRule.conditionId}`);
    }
    if (currentRule === undefined || projectedRule === undefined) {
      const conditionId = uniqueConditionId(migratedRule.conditionId, conditions);
      rules.push({ ...klona(migratedRule), conditionId });
      conditions.push({ ...klona(migratedCondition), id: conditionId });
      continue;
    }

    const patched = klona(currentRule);
    patched.name = nextRule.name;
    patched.description = nextRule.description;
    patched.enabled = nextRule.enabled;
    patched.cooldownHours = nextRule.cooldownMs / 3_600_000;
    patched.executionOrder = nextRule.order;
    patched.updatedAt = migratedRule.updatedAt;
    patched.actions = reconcileCompatibilityRuleActions(
      id,
      currentRule,
      projectedRule,
      nextRule,
      migratedRule,
      projectedEffectIds,
    );

    if (JSON.stringify(projectedRule.condition) !== JSON.stringify(nextRule.condition)) {
      const currentConditionIndex = conditions.findIndex((condition) =>
        condition.id === currentRule.conditionId);
      if (currentConditionIndex < 0) {
        throw new Error(`MVU_V3_COMPAT_CONDITION_NOT_FOUND:${currentRule.conditionId}`);
      }
      const shared = current.rules.some((rule) =>
        rule.id !== currentRule.id && rule.conditionId === currentRule.conditionId);
      const updatedCondition = klona(conditions[currentConditionIndex]);
      updatedCondition.expression = klona(migratedCondition.expression);
      updatedCondition.updatedAt = migratedCondition.updatedAt;
      if (shared) {
        updatedCondition.id = uniqueConditionId(
          `${currentRule.conditionId}_${currentRule.id}`,
          conditions,
        );
        conditions.push(updatedCondition);
        patched.conditionId = updatedCondition.id;
      } else {
        conditions[currentConditionIndex] = updatedCondition;
      }
    }

    const currentRuleIndex = rules.findIndex((rule) => rule.id === id);
    if (currentRuleIndex < 0) throw new Error(`MVU_V3_COMPAT_RULE_NOT_FOUND:${id}`);
    rules[currentRuleIndex] = patched;
  }
  return { conditions, rules };
}

function reconcileCompatibilityEffects(
  current: MvuDatasetV3,
  projected: MvuDataset,
  next: MvuDataset,
  migrated: MvuDatasetV3,
  now: number,
): Pick<MvuDatasetV3, "effectGroups" | "activeEffects"> {
  const projectedById = new Map(projected.temporaryEffects.map((effect) => [effect.id, effect]));
  const nextById = new Map(next.temporaryEffects.map((effect) => [effect.id, effect]));
  const currentGroupsByLegacyId = new Map(
    current.effectGroups.map((group) => [legacyEffectId(group.id), group]),
  );
  const migratedGroupsByLegacyId = new Map(
    migrated.effectGroups.map((group) => [legacyEffectId(group.id), group]),
  );
  const touchedEffectIds = new Set<string>();

  for (const [id, effect] of projectedById) {
    const replacement = nextById.get(id);
    if (replacement === undefined || JSON.stringify(replacement) !== JSON.stringify(effect)) {
      touchedEffectIds.add(id);
    }
  }
  for (const id of nextById.keys()) {
    if (!projectedById.has(id)) touchedEffectIds.add(id);
  }

  const effectGroups = current.effectGroups.map((group) => klona(group));
  let activeEffects = current.activeEffects.map((instance) => klona(instance));
  for (const id of touchedEffectIds) {
    const projectedEffect = projectedById.get(id);
    const currentGroup = projectedEffect === undefined ? undefined : currentGroupsByLegacyId.get(id);
    if (currentGroup === undefined && currentGroupsByLegacyId.has(id)) {
      throw new Error(`MVU_V3_COMPAT_EFFECT_ID_CONFLICT:${id}`);
    }

    const nextEffect = nextById.get(id);
    if (nextEffect === undefined) {
      if (currentGroup !== undefined && current.rules.some((rule) => rule.actions.some((action) =>
        action.kind === "activate_effect_group"
          ? action.effectGroupId === currentGroup.id
          : action.effectGroupIds.includes(currentGroup.id)))) {
        throw new Error(`MVU_V3_COMPAT_EFFECT_IN_USE:${id}`);
      }
      if (currentGroup !== undefined) {
        const groupIndex = effectGroups.findIndex((group) => group.id === currentGroup.id);
        if (groupIndex >= 0) effectGroups.splice(groupIndex, 1);
        activeEffects = activeEffects.filter((instance) => instance.definitionId !== currentGroup.id);
      }
      continue;
    }

    const migratedGroup = migratedGroupsByLegacyId.get(id);
    if (migratedGroup === undefined) throw new Error(`MVU_V3_COMPAT_EFFECT_MIGRATION_MISSING:${id}`);
    const migratedInstances = migrated.activeEffects.filter((instance) =>
      instance.definitionId === migratedGroup.id);
    if (currentGroup === undefined || projectedEffect === undefined) {
      if (effectGroups.some((group) => group.id === migratedGroup.id)) {
        throw new Error(`MVU_V3_COMPAT_EFFECT_ID_CONFLICT:${id}`);
      }
      effectGroups.push(klona(migratedGroup));
      for (const instance of migratedInstances) {
        if (activeEffects.some((candidate) => candidate.id === instance.id)) {
          throw new Error(`MVU_V3_COMPAT_ACTIVE_EFFECT_ID_CONFLICT:${instance.id}`);
        }
        activeEffects.push(klona(instance));
      }
      continue;
    }

    const groupIndex = effectGroups.findIndex((group) => group.id === currentGroup.id);
    if (groupIndex < 0) throw new Error(`MVU_V3_COMPAT_EFFECT_NOT_FOUND:${id}`);
    const patchedGroup = klona(currentGroup);
    if (!sameEffectReasonTuple(projectedEffect, nextEffect)) {
      patchedGroup.defaultReason = klona(migratedGroup.defaultReason);
    }
    patchedGroup.fieldEffects = patchedGroup.fieldEffects.map((fieldEffect) => ({
      ...fieldEffect,
      operations: fieldEffect.operations.map((operation) => {
        if (operation.kind !== "fixed_adjustment" && operation.kind !== "all_multiplier") {
          return operation;
        }
        return {
          ...operation,
          kind: nextEffect.mode === "additive" ? "fixed_adjustment" as const : "all_multiplier" as const,
          value: nextEffect.value,
        };
      }),
    }));
    const representedFieldIds = new Set(
      patchedGroup.fieldEffects.map((fieldEffect) => fieldEffect.fieldId),
    );
    for (const target of nextEffect.targets) {
      if (representedFieldIds.has(target.fieldId)) continue;
      const migratedFieldEffect = migratedGroup.fieldEffects.find((fieldEffect) =>
        fieldEffect.fieldId === target.fieldId);
      if (migratedFieldEffect === undefined || patchedGroup.fieldEffects.some((fieldEffect) =>
        fieldEffect.id === migratedFieldEffect.id)) {
        throw new Error(`MVU_V3_COMPAT_EFFECT_TARGET_DEFINITION_MISSING:${id}:${target.fieldId}`);
      }
      patchedGroup.fieldEffects.push(klona(migratedFieldEffect));
      representedFieldIds.add(target.fieldId);
    }
    patchedGroup.updatedAt = migratedGroup.updatedAt;

    const expirySettlement = projectedEffect.enabled && !nextEffect.enabled &&
      projectedEffect.expiresAt !== null && projectedEffect.expiresAt <= now &&
      sameEffectExceptEnabled(projectedEffect, nextEffect);
    if (expirySettlement) {
      activeEffects = activeEffects.filter((instance) =>
        instance.definitionId !== currentGroup.id || instance.duration.expiresAt === null ||
        Date.parse(instance.duration.expiresAt) > now);
    } else {
      const directSettlement = projectedEffect.enabled && !nextEffect.enabled &&
        sameEffectInstanceProjection(projectedEffect, nextEffect);
      if (directSettlement) {
        activeEffects = activeEffects.filter((instance) =>
          instance.definitionId !== currentGroup.id);
      } else if (!sameEffectInstanceProjection(projectedEffect, nextEffect)) {
        const currentInstances = activeEffects.filter((instance) =>
          instance.definitionId === currentGroup.id);
        if (currentInstances.length !== 1 || migratedInstances.length !== 1) {
          throw new Error(`MVU_V3_COMPAT_EFFECT_INSTANCES_AMBIGUOUS:${id}`);
        }
        const currentInstance = currentInstances[0];
        const migratedInstance = migratedInstances[0];
        const targetsChanged = JSON.stringify(projectedEffect.targets) !==
          JSON.stringify(nextEffect.targets);
        const durationChanged = projectedEffect.expiresAt !== nextEffect.expiresAt ||
          projectedEffect.remainingTurns !== nextEffect.remainingTurns;
        const replacement = {
          ...klona(currentInstance),
          resolvedTargets: targetsChanged
            ? klona(migratedInstance.resolvedTargets)
            : klona(currentInstance.resolvedTargets),
          duration: durationChanged
            ? klona(migratedInstance.duration)
            : klona(currentInstance.duration),
          reason: klona(currentInstance.reason),
        };
        const instanceIndex = activeEffects.findIndex((instance) => instance.id === currentInstance.id);
        if (!nextEffect.enabled && replacement.duration.remainingTurns === 0) {
          activeEffects.splice(instanceIndex, 1);
        } else {
          activeEffects[instanceIndex] = replacement;
        }
      } else if (projectedEffect.enabled !== nextEffect.enabled) {
        throw new Error(`MVU_V3_COMPAT_EFFECT_ACTIVATION_AMBIGUOUS:${id}`);
      }
    }
    effectGroups[groupIndex] = patchedGroup;
  }
  return { effectGroups, activeEffects };
}

function compatibilityRecordMutation(
  current: readonly DataChangeRecord[],
  next: readonly DataChangeRecord[],
): RecordMutation {
  const prefixMatches = next.length >= current.length && current.every((record, index) =>
    JSON.stringify(record) === JSON.stringify(next[index]));
  if (prefixMatches) return { kind: "append", records: next.slice(current.length) };
  return { kind: "replace", records: next };
}

function reconcileCompatibilityRuleActions(
  ruleId: string,
  currentRule: RuleDefinitionV3,
  projectedRule: DataAutoRule,
  nextRule: DataAutoRule,
  migratedRule: RuleDefinitionV3,
  projectedEffectIds: ReadonlySet<string>,
): RuleActionV3[] {
  if (currentRule.actions.length !== projectedRule.effects.length ||
    migratedRule.actions.length !== nextRule.effects.length ||
    currentRule.actions.some((action) => action.kind !== "change_field") ||
    migratedRule.actions.some((action) => action.kind !== "change_field")) {
    throw new Error(`MVU_V3_COMPAT_RULE_ACTIONS_AMBIGUOUS:${ruleId}`);
  }
  const oldEntries = projectedRule.effects.map((effect, index) => ({
    index,
    effect,
    action: currentRule.actions[index] as Extract<RuleActionV3, { kind: "change_field" }>,
  }));
  const nextEntries = nextRule.effects.map((effect, index) => ({
    index,
    effect,
    action: migratedRule.actions[index] as Extract<RuleActionV3, { kind: "change_field" }>,
  }));
  const oldMatch = new Map<number, number>();
  const unmatchedOld = new Set(oldEntries.map(({ index }) => index));
  const unmatchedNext = new Set(nextEntries.map(({ index }) => index));
  const exactKeys = new Set([
    ...oldEntries.map(({ effect }) => JSON.stringify(effect)),
    ...nextEntries.map(({ effect }) => JSON.stringify(effect)),
  ]);

  for (const key of exactKeys) {
    const oldIndices = oldEntries.filter(({ effect }) => JSON.stringify(effect) === key)
      .map(({ index }) => index);
    const nextIndices = nextEntries.filter(({ effect }) => JSON.stringify(effect) === key)
      .map(({ index }) => index);
    const pairCount = Math.min(oldIndices.length, nextIndices.length);
    for (let position = 0; position < pairCount; position += 1) {
      oldMatch.set(nextIndices[position], oldIndices[position]);
      unmatchedOld.delete(oldIndices[position]);
      unmatchedNext.delete(nextIndices[position]);
    }
  }

  const remainingFieldIds = new Set(
    [...unmatchedOld].map((index) => oldEntries[index].effect.fieldId)
      .concat([...unmatchedNext].map((index) => nextEntries[index].effect.fieldId)),
  );
  for (const fieldId of remainingFieldIds) {
    const oldIndices = [...unmatchedOld].filter((index) =>
      oldEntries[index].effect.fieldId === fieldId);
    const nextIndices = [...unmatchedNext].filter((index) =>
      nextEntries[index].effect.fieldId === fieldId);
    if (oldIndices.length === 0 || nextIndices.length === 0) continue;
    if (oldIndices.length !== 1 || nextIndices.length !== 1) {
      throw new Error(`MVU_V3_COMPAT_RULE_ACTIONS_AMBIGUOUS:${ruleId}`);
    }
    oldMatch.set(nextIndices[0], oldIndices[0]);
    unmatchedOld.delete(oldIndices[0]);
    unmatchedNext.delete(nextIndices[0]);
  }

  if (unmatchedOld.size === 1 && unmatchedNext.size === 1) {
    const oldIndex = [...unmatchedOld][0];
    const nextIndex = [...unmatchedNext][0];
    oldMatch.set(nextIndex, oldIndex);
    unmatchedOld.delete(oldIndex);
    unmatchedNext.delete(nextIndex);
  } else if (unmatchedOld.size > 0 && unmatchedNext.size > 0) {
    throw new Error(`MVU_V3_COMPAT_RULE_ACTIONS_AMBIGUOUS:${ruleId}`);
  }

  for (const oldIndex of unmatchedOld) {
    if (hasHiddenRuleActionSemantics(oldEntries[oldIndex].action, projectedEffectIds)) {
      throw new Error(`MVU_V3_COMPAT_RULE_ACTIONS_AMBIGUOUS:${ruleId}`);
    }
  }

  return nextEntries.map(({ index, action: migratedAction }) => {
    const oldIndex = oldMatch.get(index);
    if (oldIndex === undefined) return klona(migratedAction);
    const currentAction = oldEntries[oldIndex].action;
    const hiddenEffectGroupIds = currentAction.effectGroupIds.filter((effectGroupId) =>
      !projectedEffectIds.has(legacyEffectId(effectGroupId)));
    return {
      ...klona(currentAction),
      fieldId: migratedAction.fieldId,
      delta: migratedAction.delta,
      effectGroupIds: uniqueStrings([
        ...hiddenEffectGroupIds,
        ...migratedAction.effectGroupIds,
      ]),
    };
  });
}

function hasHiddenRuleActionSemantics(
  action: Extract<RuleActionV3, { kind: "change_field" }>,
  projectedEffectIds: ReadonlySet<string>,
): boolean {
  return action.target.kind !== "trigger_actor" || action.effectGroupIds.some((effectGroupId) =>
    !projectedEffectIds.has(legacyEffectId(effectGroupId)));
}

function validateMigrationResult(v2: MvuDataset, result: MigrationResult): void {
  assertMvuDatasetV3(result.dataset);
  if (result.dataset.fields.length !== v2.fields.length ||
    result.dataset.rules.length !== v2.autoRules.length ||
    result.dataset.conditions.length !== v2.autoRules.length ||
    result.dataset.effectGroups.length !== v2.temporaryEffects.length ||
    result.records.length !== v2.records.length ||
    result.report.migratedFields !== v2.fields.length ||
    result.report.migratedRules !== v2.autoRules.length ||
    result.report.migratedConditions !== v2.autoRules.length ||
    result.report.migratedEffectGroups !== v2.temporaryEffects.length) {
    throw new Error("MVU_V3_MIGRATION_COUNT_MISMATCH");
  }
}

function normalizationReport(
  dataset: MvuDatasetV3,
  warnings: string[],
): MigrationResult["report"] {
  return {
    migratedFields: dataset.fields.length,
    migratedRules: dataset.rules.length,
    migratedConditions: dataset.conditions.length,
    migratedEffectGroups: dataset.effectGroups.length,
    warnings: [...warnings],
  };
}

function legacyEffectId(effectGroupId: string): string {
  return effectGroupId.startsWith("effect_group_")
    ? effectGroupId.slice("effect_group_".length)
    : effectGroupId;
}

function compatibilityInstanceDuration(
  instances: MvuDatasetV3["activeEffects"],
): { expiresAt: string | null; remainingTurns: number | null } {
  const expiring = instances
    .filter((instance) => instance.duration.expiresAt !== null)
    .sort((left, right) =>
      Date.parse(left.duration.expiresAt as string) - Date.parse(right.duration.expiresAt as string));
  const turnLimited = instances
    .map((instance) => instance.duration.remainingTurns)
    .filter((remainingTurns): remainingTurns is number => remainingTurns !== null);
  return {
    expiresAt: expiring[0]?.duration.expiresAt ?? null,
    remainingTurns: turnLimited.length === 0 ? null : Math.min(...turnLimited),
  };
}

function uniqueTargets(targets: DataTemporaryEffect["targets"]): DataTemporaryEffect["targets"] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.fieldId}\u0000${target.scope}\u0000${target.scopeKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueConditionId(
  preferred: string,
  conditions: readonly MvuDatasetV3["conditions"][number][],
): string {
  const ids = new Set(conditions.map((condition) => condition.id));
  if (!ids.has(preferred)) return preferred;
  let suffix = 2;
  while (ids.has(`${preferred}_${suffix}`)) suffix += 1;
  return `${preferred}_${suffix}`;
}

function sameEffectExceptEnabled(left: DataTemporaryEffect, right: DataTemporaryEffect): boolean {
  const leftComparable = { ...left, enabled: true };
  const rightComparable = { ...right, enabled: true };
  return JSON.stringify(leftComparable) === JSON.stringify(rightComparable);
}

function sameEffectReasonTuple(left: DataTemporaryEffect, right: DataTemporaryEffect): boolean {
  return left.reasonMode === right.reasonMode &&
    left.reasonTemplate === right.reasonTemplate &&
    left.reason === right.reason;
}

function assertCompatibilityEffectReasonEdits(
  authoritative: readonly DataTemporaryEffect[],
  next: readonly DataTemporaryEffect[],
): void {
  const authoritativeById = new Map(authoritative.map((effect) => [effect.id, effect]));
  for (const effect of next) {
    const existing = authoritativeById.get(effect.id);
    if ((existing === undefined || !sameEffectReasonTuple(existing, effect)) &&
      effect.reason.length > EFFECT_REASON_SOURCE_MAX_LENGTH) {
      throw new Error("MVU_EFFECT_REASON_TOO_LONG");
    }
  }
}

function sameEffectInstanceProjection(left: DataTemporaryEffect, right: DataTemporaryEffect): boolean {
  return JSON.stringify({
    targets: left.targets,
    expiresAt: left.expiresAt,
    remainingTurns: left.remainingTurns,
    createdAt: left.createdAt,
  }) === JSON.stringify({
    targets: right.targets,
    expiresAt: right.expiresAt,
    remainingTurns: right.remainingTurns,
    createdAt: right.createdAt,
  });
}

function structuredMigrationError(error: unknown): MigrationError {
  const message = error instanceof Error ? error.message : String(error);
  const separator = message.indexOf(":");
  return {
    code: (separator < 0 ? message : message.slice(0, separator)) || "MVU_V3_MIGRATION_FAILED",
    message,
  };
}

function enqueueRuntimePath<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = runtimePathTails.get(path) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  runtimePathTails.set(path, tail);
  void tail.finally(() => {
    if (runtimePathTails.get(path) === tail) runtimePathTails.delete(path);
  });
  return run;
}

let transactionSequence = 0;

function nextTransactionId(): string {
  transactionSequence += 1;
  if (!Number.isSafeInteger(transactionSequence)) transactionSequence = 1;
  return `${Date.now().toString(36)}_${transactionSequence.toString(36)}`;
}
