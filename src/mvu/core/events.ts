/**
 * core/events.ts
 *
 * MVU 事件总线（对齐 MagVarUpdate 上游事件语义）。
 *
 * 事件名以锁定 MagVarUpdate 源码为准（见 variable-def.variable_events）。
 * 监听器按注册顺序同步执行；允许像上游一样在 COMMAND_PARSED / VARIABLE_UPDATE_ENDED
 * 等阶段就地修改传入的引用（commands / variables），以保留上游事件时序行为。
 *
 * 该总线不依赖 TavernHelper：由 core 自行持有，供 facade 与宿主 Adapter 使用。
 */

import type { CommandInfo, MvuCommand, MvuData, UpdateContext } from './variable-def';
import { variable_events } from './variable-def';

export type EventArgs =
  | { kind: 'variables'; payload: MvuData; swipeId?: number }
  | { kind: 'commands'; variables: MvuData; commands: MvuCommand[]; messageContent: string }
  | {
      kind: 'variables_pair';
      variables: MvuData;
      variablesBeforeUpdate: MvuData;
    }
  | { kind: 'context'; context: UpdateContext }
  | {
      kind: 'single_variable';
      statData: Record<string, unknown>;
      path: string;
      oldValue: unknown;
      newValue: unknown;
    };

export type MvuListener = (event: string, args: EventArgs) => unknown;

/** 事件名称 → 参数构造器，供核心把调用转成统一 EventArgs。 */
export interface MvuEventBus {
  on(event: string, listener: MvuListener): () => void;
  off(event: string, listener: MvuListener): void;
  /** 触发事件并返回 listeners 是否全部正常完成（用于事件阶段的可中断性）。 */
  emit(event: string, args: EventArgs): void;
  clear(): void;
}

export function createEventBus(): MvuEventBus {
  const listeners = new Map<string, MvuListener[]>();
  return {
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => {
        const current = listeners.get(event);
        if (current) {
          const idx = current.indexOf(listener);
          if (idx >= 0) current.splice(idx, 1);
        }
      };
    },
    off(event, listener) {
      const current = listeners.get(event);
      if (current) {
        const idx = current.indexOf(listener);
        if (idx >= 0) current.splice(idx, 1);
      }
    },
    emit(event, args) {
      const list = listeners.get(event);
      if (!list) return;
      // 拷贝一份，避免监听器增删影响本次遍历
      for (const listener of [...list]) {
        listener(event, args);
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

/**
 * 便捷包装：把 `variable_events` 的监听注册到 bus，参数与上游 `eventOn` 对齐。
 * 返回取消函数。
 */
export function eventOn(
  bus: MvuEventBus,
  event: string,
  listener: (event: string, args: EventArgs) => unknown
): () => void {
  return bus.on(event, listener);
}

// 导出事件常量，便于宿主引用；保持与上游同名对象不同语义（宿主面向 core 的 bus）。
export { variable_events };
export type { CommandInfo };
