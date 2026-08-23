/**
 * port/context.ts
 *
 * MvuPortContext：核心与宿主环境之间的唯一接口（PATCHES core-09）。
 *
 * 核心不访问 window / SillyTavern / toastr / Vue，只通过本接口读写环境能力，
 * 便于在 Node 单测中提供实现，并在 ToolPkg 运行时接入 Operit Host Adapter。
 */

import type { MvuEventName, MvuEventPayload } from '../core/variable-def';

export interface MvuPortContext {
  /** 结构化解析（YAML/JSON5/JSON repair），由实现注入解析器闭包。 */
  parseStructured?: (content: string) => unknown;
  /** 宏替换（默认直接返回原文）。 */
  substituteMacros?: (content: string, values: Readonly<Record<string, string>>) => string;
  /** MVU 事件分发。 */
  emit?: <TEvent extends MvuEventName>(
    event: TEvent,
    payload: MvuEventPayload<TEvent>
  ) => Promise<void> | void;
  /** 日志。 */
  log: (level: 'debug' | 'info' | 'warn' | 'error', code: string, detail: Record<string, unknown>) => void;
  /** 当前时间（毫秒）。 */
  now: () => number;
}

/** 供单测使用的默认 Context 实现。 */
export function createDefaultPortContext(): MvuPortContext {
  return {
    parseStructured: undefined,
    substituteMacros: (content) => content,
    emit: async () => {},
    log: (_level, _code, _detail) => {},
    now: () => Date.now(),
  };
}

/** 包装一层，把 `emit` 事件统一改写为 `{ event, payload }` 分发对象并转发 listener。 */
export type MvuEventListener<TEvent extends MvuEventName = MvuEventName> = (
  event: TEvent,
  payload: MvuEventPayload<TEvent>
) => void;
