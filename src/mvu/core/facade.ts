/**
 * core/facade.ts
 *
 * Mvu facade：对齐 JS-Slash-Runner 的 `Mvu` 调用语义（getMvuData / replaceMvuData /
 * parseMessage / isDuringExtraAnalysis），并内置 Operit 的 MvuData 读写。
 *
 * 说明：
 *   - parseMessage 始终返回新的 MvuData（上游当前源码总是返回克隆结果，变化与否由 stat_data diff 表达）。
 *   - getMvuData / replaceMvuData 经由宿主 ScopeAdapter 提供，此处以函数注入。
 */

import type { CommandExecutorHooks } from './command-executor';
import { updateVariablesWithSecurity } from './command-executor';
import type { MvuData } from './variable-def';
import { klona } from '../port/util';

/** 变量作用域选项（对齐 JS-Slash-Runner 的 VariableOption子集，覆盖 Operit 的作用域）。 */
export type MvuVariableOption =
  | { type: 'global'; key: string }
  | { type: 'character'; actorId: string }
  | { type: 'chat'; chatId: string; partitionKey: string }
  | { type: 'message'; chatId: string; messageId: string; variantId: string };

export type MvuReadFunction = (options: MvuVariableOption) => Promise<MvuData> | MvuData;
export type MvuWriteFunction = (data: MvuData, options: MvuVariableOption) => Promise<void> | void;
export type MvuAnalysisFlagFunction = () => boolean;

export interface FacadeDependencies {
  hooks: CommandExecutorHooks;
  read: MvuReadFunction;
  write: MvuWriteFunction;
  /** 是否处于额外模型分析轮次（默认 false）。 */
  isDuringExtraAnalysis?: MvuAnalysisFlagFunction;
}

export interface MvuFacade {
  /** 事件总线（供注册监听器，与上游 eventOn 对齐）。 */
  getMvuData(options: MvuVariableOption): Promise<MvuData>;
  replaceMvuData(data: MvuData, options: MvuVariableOption): Promise<void>;
  parseMessage(message: string, oldData: MvuData): Promise<MvuData>;
  isDuringExtraAnalysis(): boolean;
}

export function createMvuFacade(deps: FacadeDependencies): MvuFacade {
  return {
    async getMvuData(options) {
      return deps.read(options);
    },
    async replaceMvuData(data, options) {
      await deps.write(data, options);
    },
    async parseMessage(message, oldData) {
      const result = klona(oldData);
      await updateVariablesWithSecurity(message, result, deps.hooks);
      return result;
    },
    isDuringExtraAnalysis() {
      return deps.isDuringExtraAnalysis ? deps.isDuringExtraAnalysis() : false;
    },
  };
}
