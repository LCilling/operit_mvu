/**
 * tests/mvu/helpers.ts
 *
 * MVU 移植测试的公共夹具与执行依赖构造。
 */
import type { MvuData } from "../../src/mvu/core/variable-def";
import { createEventBus, type MvuEventBus } from "../../src/mvu/core/events";
import type { CommandExecutorHooks } from "../../src/mvu/core/command-executor";
import { createDefaultPortContext } from "../../src/mvu/port/context";

export function createBaseMvuData(statData: Record<string, unknown> = {}): MvuData {
  return {
    initialized_lorebooks: {},
    stat_data: statData as MvuData["stat_data"],
    schema: {
      type: "object",
      properties: {},
    },
    display_data: {},
    delta_data: {},
  };
}

export interface TestHarness {
  bus: MvuEventBus;
  hooks: CommandExecutorHooks;
}

export function createHooks(): TestHarness {
  const bus = createEventBus();
  const port = createDefaultPortContext();
  const hooks: CommandExecutorHooks = { bus, port };
  return { bus, hooks };
}
