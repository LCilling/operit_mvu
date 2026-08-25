import type { DataChangeRecord } from "./model";
import type { RecordManifest, RecordSegmentMetadata } from "./model-v3";
import type { MvuFileApi } from "./store";
import { assertDataChangeRecord } from "./validation";

export const RECORDS_PER_SEGMENT = 500;

export interface SegmentedRecordStoreOptions {
  getConfigDir: () => string;
  files: MvuFileApi;
  directoryName?: string;
}

export interface RecordQueryRequest {
  offset?: number;
  limit: number;
  direction?: "asc" | "desc";
}

export interface RecordQueryResult {
  items: DataChangeRecord[];
  loadedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface StagedRecordWrite {
  manifest: RecordManifest;
  touchedSegmentPaths: string[];
}

interface StoredRecordLine {
  commitRevision: number;
  record: DataChangeRecord;
}

export function createEmptyRecordManifest(nextSegmentIndex = 1): RecordManifest {
  if (!Number.isSafeInteger(nextSegmentIndex) || nextSegmentIndex < 1) {
    throw new Error("MVU_V3_RECORD_NEXT_SEGMENT_INVALID");
  }
  return { segments: [], recordCount: 0, nextSegmentIndex };
}

export class SegmentedRecordStore {
  private readonly getConfigDir: () => string;
  private readonly files: MvuFileApi;
  private readonly directoryName: string;

  constructor(options: SegmentedRecordStoreOptions) {
    this.getConfigDir = options.getConfigDir;
    this.files = options.files;
    this.directoryName = options.directoryName ?? "operit_mvu.records.v3";
  }

  async stageAppend(
    currentManifest: RecordManifest,
    records: readonly DataChangeRecord[],
    commitRevision: number,
  ): Promise<StagedRecordWrite> {
    assertRecordManifest(currentManifest);
    requireRevision(commitRevision);
    for (const record of records) assertDataChangeRecord(record);
    if (records.length === 0) {
      return { manifest: cloneManifest(currentManifest), touchedSegmentPaths: [] };
    }

    await this.ensureDirectory();
    const manifest = cloneManifest(currentManifest);
    const touchedSegmentPaths: string[] = [];
    let recordIndex = 0;
    while (recordIndex < records.length) {
      let segment = manifest.segments.at(-1);
      if (segment === undefined || segment.committedLineCount === RECORDS_PER_SEGMENT) {
        segment = await this.createSegment(manifest, commitRevision, records[recordIndex]);
      }
      const available = RECORDS_PER_SEGMENT - segment.committedLineCount;
      const chunk = records.slice(recordIndex, recordIndex + available);
      const path = this.segmentPath(segment.fileName);
      const content = chunk.map((record) => JSON.stringify({
        commitRevision,
        record,
      } satisfies StoredRecordLine)).join("\n") + "\n";
      if (!Number.isSafeInteger(manifest.recordCount + chunk.length)) {
        throw new Error("MVU_V3_RECORD_COUNT_OVERFLOW");
      }
      await this.files.appendText(path, content);
      if (!touchedSegmentPaths.includes(path)) touchedSegmentPaths.push(path);
      updateSegmentMetadata(segment, chunk, commitRevision);
      manifest.recordCount += chunk.length;
      recordIndex += chunk.length;
    }
    assertRecordManifest(manifest);
    return { manifest, touchedSegmentPaths };
  }

  async stageReplace(
    currentManifest: RecordManifest,
    records: readonly DataChangeRecord[],
    commitRevision: number,
  ): Promise<StagedRecordWrite> {
    assertRecordManifest(currentManifest);
    for (const record of records) assertDataChangeRecord(record);
    requireRevision(commitRevision);
    const requiredSegments = Math.ceil(records.length / RECORDS_PER_SEGMENT);
    let nextSegmentIndex = currentManifest.nextSegmentIndex;
    while (requiredSegments > 0 && await this.segmentRunExists(nextSegmentIndex, requiredSegments)) {
      if (!Number.isSafeInteger(nextSegmentIndex + 1)) {
        throw new Error("MVU_V3_RECORD_NEXT_SEGMENT_OVERFLOW");
      }
      nextSegmentIndex += 1;
    }
    return this.stageAppend(
      createEmptyRecordManifest(nextSegmentIndex),
      records,
      commitRevision,
    );
  }

  async validateAndRepair(manifest: RecordManifest, committedRevision: number): Promise<void> {
    assertRecordManifest(manifest);
    requireRevision(committedRevision);
    for (const segment of manifest.segments) {
      const path = this.segmentPath(segment.fileName);
      if (!(await this.files.exists(path))) {
        throw new Error(`MVU_V3_RECORD_SEGMENT_MISSING:${segment.fileName}`);
      }
      const raw = await this.files.readText(path);
      const lines = splitLines(raw);
      if (lines.length < segment.committedLineCount) {
        throw new Error(`MVU_V3_RECORD_SEGMENT_SHORT:${segment.fileName}`);
      }
      const committedLines = lines.slice(0, segment.committedLineCount);
      const parsed = committedLines.map((line, index) =>
        parseStoredLine(line, segment.fileName, index + 1, committedRevision));
      validateSegmentMetadata(segment, parsed);
      if (lines.length > segment.committedLineCount) {
        const temporaryPath = `${path}.repair.tmp.${nextRecordOperationId()}`;
        await this.files.writeText(
          temporaryPath,
          committedLines.length === 0 ? "" : `${committedLines.join("\n")}\n`,
        );
        await this.files.replaceAtomically(temporaryPath, path);
      }
    }
    // New segments are allocated contiguously from nextSegmentIndex. If a
    // config move was interrupted, none of these files are committed; remove
    // the complete contiguous orphan run before any later append can reuse it.
    let orphanIndex = manifest.nextSegmentIndex;
    while (true) {
      const orphanName = `segment-${String(orphanIndex).padStart(6, "0")}.jsonl`;
      const orphanPath = this.segmentPath(orphanName);
      if (!(await this.files.exists(orphanPath))) break;
      await this.files.deleteFile(orphanPath);
      if (!Number.isSafeInteger(orphanIndex + 1)) {
        throw new Error("MVU_V3_RECORD_NEXT_SEGMENT_OVERFLOW");
      }
      orphanIndex += 1;
    }
  }

  async queryRecords(manifest: RecordManifest, request: RecordQueryRequest): Promise<RecordQueryResult> {
    assertRecordManifest(manifest);
    const offset = request.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("MVU_V3_RECORD_QUERY_INVALID");
    }
    const direction = request.direction ?? "desc";
    if (direction !== "asc" && direction !== "desc") {
      throw new Error("MVU_V3_RECORD_QUERY_INVALID");
    }
    const available = Math.max(0, manifest.recordCount - offset);
    const take = Math.min(request.limit, available);
    if (take === 0) {
      return {
        items: [],
        loadedCount: 0,
        totalCount: manifest.recordCount,
        hasMore: false,
        nextOffset: null,
      };
    }

    const ascendingStart = direction === "asc"
      ? offset
      : manifest.recordCount - offset - take;
    const ascendingEnd = ascendingStart + take;
    const items = await this.readAscendingRange(manifest, ascendingStart, ascendingEnd);
    if (direction === "desc") items.reverse();
    const hasMore = offset + items.length < manifest.recordCount;
    return {
      items,
      loadedCount: items.length,
      totalCount: manifest.recordCount,
      hasMore,
      nextOffset: hasMore ? offset + items.length : null,
    };
  }

  async deleteSegments(manifest: RecordManifest): Promise<void> {
    assertRecordManifest(manifest);
    for (const segment of manifest.segments) {
      const path = this.segmentPath(segment.fileName);
      if (await this.files.exists(path)) await this.files.deleteFile(path);
    }
  }

  directoryPath(): string {
    return `${this.configDir()}/${this.directoryName}`;
  }

  private async readAscendingRange(
    manifest: RecordManifest,
    start: number,
    end: number,
  ): Promise<DataChangeRecord[]> {
    const records: DataChangeRecord[] = [];
    let segmentStart = 0;
    for (const segment of manifest.segments) {
      const segmentEnd = segmentStart + segment.committedLineCount;
      const overlapStart = Math.max(start, segmentStart);
      const overlapEnd = Math.min(end, segmentEnd);
      if (overlapStart < overlapEnd) {
        const firstLine = overlapStart - segmentStart + 1;
        const lastLine = overlapEnd - segmentStart;
        const content = await this.files.readText(this.segmentPath(segment.fileName));
        const physicalLines = splitLines(content);
        if (physicalLines.length < segment.committedLineCount) {
          throw new Error(`MVU_V3_RECORD_SEGMENT_SHORT:${segment.fileName}`);
        }
        const lines = physicalLines.slice(firstLine - 1, lastLine);
        records.push(...lines.map((line, index) =>
          parseStoredLine(line, segment.fileName, firstLine + index, segment.lastRevision).record));
      }
      segmentStart = segmentEnd;
      if (segmentStart >= end) break;
    }
    if (records.length !== end - start) throw new Error("MVU_V3_RECORD_MANIFEST_COUNT_MISMATCH");
    return records;
  }

  private async createSegment(
    manifest: RecordManifest,
    commitRevision: number,
    firstRecord: DataChangeRecord,
  ): Promise<RecordSegmentMetadata> {
    const index = manifest.nextSegmentIndex;
    const fileName = `segment-${String(index).padStart(6, "0")}.jsonl`;
    const path = this.segmentPath(fileName);
    if (await this.files.exists(path)) {
      throw new Error(`MVU_V3_RECORD_SEGMENT_COLLISION:${fileName}`);
    }
    if (!Number.isSafeInteger(manifest.nextSegmentIndex + 1)) {
      throw new Error("MVU_V3_RECORD_NEXT_SEGMENT_OVERFLOW");
    }
    const segment: RecordSegmentMetadata = {
      index,
      fileName,
      committedLineCount: 0,
      firstOccurredAt: firstRecord.occurredAt,
      lastOccurredAt: firstRecord.occurredAt,
      firstRevision: commitRevision,
      lastRevision: commitRevision,
    };
    manifest.segments.push(segment);
    manifest.nextSegmentIndex += 1;
    return segment;
  }

  private async ensureDirectory(): Promise<void> {
    const configDir = this.configDir();
    if (!(await this.files.exists(configDir))) await this.files.mkdir(configDir);
    const directory = this.directoryPath();
    if (!(await this.files.exists(directory))) await this.files.mkdir(directory);
  }

  private configDir(): string {
    const value = this.getConfigDir().replace(/[\\/]+$/, "");
    if (value.length === 0) throw new Error("MVU_CONFIG_DIR_EMPTY");
    return value;
  }

  private segmentPath(fileName: string): string {
    return `${this.directoryPath()}/${fileName}`;
  }

  private async segmentRunExists(startIndex: number, count: number): Promise<boolean> {
    for (let offset = 0; offset < count; offset += 1) {
      const index = startIndex + offset;
      if (!Number.isSafeInteger(index)) throw new Error("MVU_V3_RECORD_NEXT_SEGMENT_OVERFLOW");
      const fileName = `segment-${String(index).padStart(6, "0")}.jsonl`;
      if (await this.files.exists(this.segmentPath(fileName))) return true;
    }
    return false;
  }
}

export function assertRecordManifest(value: unknown): asserts value is RecordManifest {
  if (typeof value !== "object" || value === null) failManifest();
  const manifest = value as Partial<RecordManifest>;
  if (!Array.isArray(manifest.segments) || !Number.isSafeInteger(manifest.recordCount) ||
    (manifest.recordCount ?? -1) < 0 || !Number.isSafeInteger(manifest.nextSegmentIndex) ||
    (manifest.nextSegmentIndex ?? 0) < 1) failManifest();
  let total = 0;
  let previousIndex = 0;
  for (let position = 0; position < manifest.segments.length; position += 1) {
    const segment = manifest.segments[position] as Partial<RecordSegmentMetadata>;
    if (typeof segment !== "object" || segment === null || !Number.isSafeInteger(segment.index) ||
      (segment.index ?? 0) <= previousIndex ||
      segment.fileName !== `segment-${String(segment.index).padStart(6, "0")}.jsonl` ||
      !Number.isSafeInteger(segment.committedLineCount) || (segment.committedLineCount ?? 0) < 1 ||
      (segment.committedLineCount ?? 0) > RECORDS_PER_SEGMENT ||
      (position < manifest.segments.length - 1 && segment.committedLineCount !== RECORDS_PER_SEGMENT) ||
      !isFiniteNumber(segment.firstOccurredAt) || !isFiniteNumber(segment.lastOccurredAt) ||
      (segment.firstOccurredAt ?? 0) > (segment.lastOccurredAt ?? 0) ||
      !isRevision(segment.firstRevision) || !isRevision(segment.lastRevision) ||
      (segment.firstRevision ?? 0) > (segment.lastRevision ?? 0)) {
      failManifest();
    }
    const validatedSegment = segment as RecordSegmentMetadata;
    previousIndex = validatedSegment.index;
    if (!Number.isSafeInteger(total + validatedSegment.committedLineCount)) failManifest();
    total += validatedSegment.committedLineCount;
  }
  const validatedManifest = manifest as RecordManifest;
  if (total !== validatedManifest.recordCount ||
    validatedManifest.nextSegmentIndex <= previousIndex) failManifest();
}

function cloneManifest(manifest: RecordManifest): RecordManifest {
  return {
    segments: manifest.segments.map((segment) => ({ ...segment })),
    recordCount: manifest.recordCount,
    nextSegmentIndex: manifest.nextSegmentIndex,
  };
}

function updateSegmentMetadata(
  segment: RecordSegmentMetadata,
  records: readonly DataChangeRecord[],
  revision: number,
): void {
  for (const record of records) {
    segment.firstOccurredAt = Math.min(segment.firstOccurredAt, record.occurredAt);
    segment.lastOccurredAt = Math.max(segment.lastOccurredAt, record.occurredAt);
  }
  if (!Number.isSafeInteger(segment.committedLineCount + records.length)) {
    throw new Error("MVU_V3_RECORD_COUNT_OVERFLOW");
  }
  segment.committedLineCount += records.length;
  segment.lastRevision = revision;
}

function validateSegmentMetadata(
  metadata: RecordSegmentMetadata,
  lines: readonly StoredRecordLine[],
): void {
  const occurredAt = lines.map((line) => line.record.occurredAt);
  const revisions = lines.map((line) => line.commitRevision);
  if (lines.length !== metadata.committedLineCount ||
    Math.min(...occurredAt) !== metadata.firstOccurredAt ||
    Math.max(...occurredAt) !== metadata.lastOccurredAt ||
    revisions[0] !== metadata.firstRevision ||
    revisions.at(-1) !== metadata.lastRevision) {
    throw new Error(`MVU_V3_RECORD_SEGMENT_METADATA_MISMATCH:${metadata.fileName}`);
  }
  for (let index = 1; index < revisions.length; index += 1) {
    if (revisions[index] < revisions[index - 1]) {
      throw new Error(`MVU_V3_RECORD_SEGMENT_REVISION_ORDER:${metadata.fileName}`);
    }
  }
}

function parseStoredLine(
  line: string,
  fileName: string,
  lineNumber: number,
  maximumRevision: number,
): StoredRecordLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`MVU_V3_RECORD_LINE_INVALID:${fileName}:${lineNumber}`);
  }
  if (typeof parsed !== "object" || parsed === null ||
    !Object.prototype.hasOwnProperty.call(parsed, "commitRevision") ||
    !Object.prototype.hasOwnProperty.call(parsed, "record") ||
    Object.keys(parsed).length !== 2) {
    throw new Error(`MVU_V3_RECORD_LINE_INVALID:${fileName}:${lineNumber}`);
  }
  const candidate = parsed as Partial<StoredRecordLine>;
  if (!isRevision(candidate.commitRevision) || candidate.commitRevision > maximumRevision) {
    throw new Error(`MVU_V3_RECORD_REVISION_INVALID:${fileName}:${lineNumber}`);
  }
  assertDataChangeRecord(candidate.record);
  return candidate as StoredRecordLine;
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function requireRevision(value: number): void {
  if (!isRevision(value)) throw new Error("MVU_V3_RECORD_REVISION_INVALID");
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function failManifest(): never {
  throw new Error("MVU_V3_RECORD_MANIFEST_INVALID");
}

let recordOperationSequence = 0;

function nextRecordOperationId(): string {
  recordOperationSequence += 1;
  if (!Number.isSafeInteger(recordOperationSequence)) recordOperationSequence = 1;
  return `${Date.now().toString(36)}_${recordOperationSequence.toString(36)}`;
}
