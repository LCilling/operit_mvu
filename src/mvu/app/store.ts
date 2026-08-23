/**
 * app/store.ts — MVU 数据集存储（单文档事务）
 *
 * InMemoryMvuStore 只供显式注入的测试使用；FileMvuStore 是 ToolPkg main runtime
 * 的持久化实现。两者都以不可变快照 + revision compare-and-swap 提交，调用方
 * 无法通过修改 read/transact 的返回对象绕开事务。
 */
import { klona } from "../port/util";
import type { MvuDataset } from "./model";
import { assertMvuDataset } from "./validation";

export interface MvuStoreSnapshot {
  revision: number;
  dataset: MvuDataset;
}

export interface MvuStore {
  read(): Promise<MvuStoreSnapshot>;
  transact(expectedRevision: number, next: MvuDataset): Promise<MvuStoreSnapshot>;
}

/** FileMvuStore 所需的最小文件能力；生产环境由 Tools.Files 适配。 */
export interface MvuFileApi {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  move(source: string, destination: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface FileMvuStoreOptions {
  getConfigDir: () => string;
  files: MvuFileApi;
  createInitialDataset: () => MvuDataset;
  fileName?: string;
}

export class StaleRevisionError extends Error {
  constructor(expectedRevision: number, actualRevision: number) {
    super(`STALE_REVISION expected=${expectedRevision} actual=${actualRevision}`);
    this.name = "StaleRevisionError";
  }
}

export function emptyDataset(createdAt: number = Date.now()): MvuDataset {
  return {
    formatVersion: 2,
    createdAt,
    revision: 0,
    settings: { aiEnabled: true },
    fields: [],
    pendingBootstrapFieldIds: [],
    rules: [],
    autoRules: [],
    temporaryEffects: [],
    stateValues: {},
    records: [],
    lastSettled: {},
    turnCounters: {},
    processedMessageIds: [],
    ruleLastTriggered: {},
    messageFacts: {},
  };
}

function cloneSnapshot(snapshot: MvuStoreSnapshot): MvuStoreSnapshot {
  return {
    revision: snapshot.revision,
    dataset: klona(snapshot.dataset),
  };
}

function snapshotOf(dataset: MvuDataset): MvuStoreSnapshot {
  return {
    revision: dataset.revision,
    dataset: klona(dataset),
  };
}

export class InMemoryMvuStore implements MvuStore {
  private snapshot: MvuStoreSnapshot;

  constructor(initial: MvuDataset = emptyDataset()) {
    const dataset = klona(initial);
    this.snapshot = snapshotOf(dataset);
  }

  async read(): Promise<MvuStoreSnapshot> {
    return cloneSnapshot(this.snapshot);
  }

  async transact(expectedRevision: number, next: MvuDataset): Promise<MvuStoreSnapshot> {
    if (expectedRevision !== this.snapshot.revision) {
      throw new StaleRevisionError(expectedRevision, this.snapshot.revision);
    }
    const committed = klona(next);
    committed.revision = this.snapshot.revision + 1;
    this.snapshot = snapshotOf(committed);
    return cloneSnapshot(this.snapshot);
  }
}

/**
 * ToolPkg 文件存储。首次 read 发现目标文件不存在时会立即写入初始化数据；
 * 解析、校验、读取或提交失败都会记录错误并向调用方抛出，绝不退回内存数据。
 */
export class FileMvuStore implements MvuStore {
  private readonly getConfigDir: () => string;
  private readonly files: MvuFileApi;
  private readonly createInitialDataset: () => MvuDataset;
  private readonly fileName: string;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: FileMvuStoreOptions) {
    this.getConfigDir = options.getConfigDir;
    this.files = options.files;
    this.createInitialDataset = options.createInitialDataset;
    this.fileName = options.fileName ?? "operit_mvu.dataset.v2.json";
  }

  private configDir(): string {
    const value = this.getConfigDir().replace(/[\\/]+$/, "");
    if (value.length === 0) {
      throw new Error("MVU_CONFIG_DIR_EMPTY");
    }
    return value;
  }

  private filePath(configDir: string): string {
    return `${configDir}/${this.fileName}`;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensureConfigDirectory(configDir: string): Promise<void> {
    if (!(await this.files.exists(configDir))) {
      await this.files.mkdir(configDir);
    }
  }

  private async persist(filePath: string, dataset: MvuDataset): Promise<void> {
    const temporaryPath = `${filePath}.tmp`;
    await this.files.writeText(temporaryPath, JSON.stringify(dataset, null, 2));
    await this.files.move(temporaryPath, filePath);
  }

  private async loadFromDisk(configDir: string, filePath: string): Promise<MvuStoreSnapshot> {
    if (!(await this.files.exists(filePath))) {
      await this.ensureConfigDirectory(configDir);
      const initial = klona(this.createInitialDataset());
      initial.revision = 0;
      assertMvuDataset(initial);
      await this.persist(filePath, initial);
      return snapshotOf(initial);
    }

    const raw = await this.files.readText(filePath);
    const parsed: unknown = JSON.parse(raw);
    assertMvuDataset(parsed);
    return snapshotOf(parsed);
  }

  async read(): Promise<MvuStoreSnapshot> {
    return this.enqueue(async () => {
      let filePath = this.fileName;
      try {
        const configDir = this.configDir();
        filePath = this.filePath(configDir);
        return cloneSnapshot(await this.loadFromDisk(configDir, filePath));
      } catch (error) {
        console.error("MVU dataset read failed", filePath, error);
        throw error;
      }
    });
  }

  async transact(expectedRevision: number, next: MvuDataset): Promise<MvuStoreSnapshot> {
    return this.enqueue(async () => {
      let filePath = this.fileName;
      try {
        const configDir = this.configDir();
        filePath = this.filePath(configDir);
        const current = await this.loadFromDisk(configDir, filePath);
        if (expectedRevision !== current.revision) {
          throw new StaleRevisionError(expectedRevision, current.revision);
        }

        const committed = klona(next);
        committed.revision = current.revision + 1;
        assertMvuDataset(committed);
        await this.persist(filePath, committed);
        return snapshotOf(committed);
      } catch (error) {
        // CAS 冲突由 MvuService 基于最新快照重试；这里只记录真实持久化/校验故障。
        if (!(error instanceof StaleRevisionError)) {
          console.error("MVU dataset transaction failed", filePath, error);
        }
        throw error;
      }
    });
  }
}
