/**
 * tests/mvu-executor.test.ts
 *
 * 针对 core/command-executor（updateVariablesWithSecurity）的字符化测试，
 * 覆盖 set/insert/delete/add、VWD、模板、display_data/delta_data、schema 调和与事件时序。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { updateVariablesWithSecurity } from "../src/mvu/core/command-executor";
import { variable_events } from "../src/mvu/core/variable-def";
import { get, set, has } from "../src/mvu/port/util";
import { createBaseMvuData, createHooks } from "./mvu/helpers";

test("set updates a plain value and records display/delta", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ hp: 30 });
  const result = await updateVariablesWithSecurity("_.set('hp', 20);//受伤", data, hooks);
  assert.equal(result.modified, true);
  assert.equal(get(data.stat_data, "hp"), 20);
  assert.match(String(get(data.delta_data, "hp")), /30->20/);
  assert.match(String(get(data.display_data, "hp")), /30->20/);
});

test("set with ValueWithDescription updates first element only", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ affinity: [62, "0-100"] });
  const result = await updateVariablesWithSecurity("_.add('affinity', 3);//互动", data, hooks);
  assert.equal(result.modified, true);
  assert.deepEqual(get(data.stat_data, "affinity"), [65, "0-100"]);
});

test("insert appends to an array", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ bag: ["sword"] });
  const result = await updateVariablesWithSecurity("_.insert('bag', 'potion');//拾取", data, hooks);
  assert.equal(result.modified, true);
  assert.deepEqual(get(data.stat_data, "bag"), ["sword", "potion"]);
});

test("insert appends at tail via 3-arg dash", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ bag: ["a"] });
  await updateVariablesWithSecurity('_.insert("bag", "-", "b");', data, hooks);
  assert.deepEqual(get(data.stat_data, "bag"), ["a", "b"]);
});

test("insert merges object when no key given", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ player: { name: "p", level: 1 } });
  const result = await updateVariablesWithSecurity(
    "_.assign('player', { level: 2 });//升级",
    data,
    hooks
  );
  assert.equal(result.modified, true);
  assert.deepEqual(get(data.stat_data, "player"), { name: "p", level: 2 });
});

test("delete removes a path", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ gone: 1, keep: 2 });
  await updateVariablesWithSecurity("_.delete('gone');", data, hooks);
  assert.equal(has(data.stat_data, "gone"), false);
  assert.equal(get(data.stat_data, "keep"), 2);
});

test("delete removes an array element by index", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ list: ["a", "b", "c"] });
  await updateVariablesWithSecurity("_.delete('list[1]');", data, hooks);
  assert.deepEqual(get(data.stat_data, "list"), ["a", "c"]);
});

test("schema is reconciled after a modification", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ hp: 30, name: "p" });
  await updateVariablesWithSecurity("_.set('hp', 25);", data, hooks);
  assert.equal(data.schema.type, "object");
  assert.ok(data.schema.properties.hp);
  assert.equal(data.schema.properties.hp.type, "number");
  assert.equal(data.schema.properties.name.type, "string");
});

test("VARIABLE_UPDATE_ENDED listener can clamp final value", async () => {
  const { hooks, bus } = createHooks();
  const data = createBaseMvuData({ hp: 10 });
  bus.on(variable_events.VARIABLE_UPDATE_ENDED, () => {
    const value = get(data.stat_data, "hp") as number;
    if (value < 0) set(data.stat_data, "hp", 0);
  });
  await updateVariablesWithSecurity("_.set('hp', -5);", data, hooks);
  assert.equal(get(data.stat_data, "hp"), 0);
});

test("COMMAND_PARSED listener can adjust commands before execution", async () => {
  const { hooks, bus } = createHooks();
  let seenCommandCount = -1;
  bus.on(variable_events.COMMAND_PARSED, (_event, args) => {
    if (args.kind === "commands") {
      seenCommandCount = args.commands.length;
    }
  });
  const data = createBaseMvuData({ hp: 10 });
  await updateVariablesWithSecurity("_.set('hp', 3);", data, hooks);
  assert.equal(seenCommandCount, 1);
  assert.equal(get(data.stat_data, "hp"), 3);
});

test("move command returns MVU_MOVE_UNSUPPORTED rather than executing", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({ a: 1, b: 2 });
  // _.move(...) 不会被 extractCommands 捕获（与上游一致）；move 只能经 JSON Patch 块产生
  const result = await updateVariablesWithSecurity(
    '<json_patch>[{"op":"move","from":"/a","path":"/b"}]</json_patch>',
    data,
    hooks
  );
  assert.equal(result.modified, false);
  assert.ok(result.errors.some((e) => e.code === "MVU_MOVE_UNSUPPORTED"));
});

test("set path guard rejects __proto__", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({});
  const result = await updateVariablesWithSecurity("_.set('__proto__.polluted', 1);", data, hooks);
  assert.equal(result.modified, false);
  assert.ok(result.errors.some((e) => e.code === "MVU_PATH_DANGEROUS_KEY"));
  assert.equal(({} as any).polluted, undefined);
});

test("set path guard rejects reserved $internal", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({});
  const result = await updateVariablesWithSecurity("_.set('$internal', 1);", data, hooks);
  assert.equal(result.modified, false);
  assert.ok(result.errors.some((e) => e.code === "MVU_PATH_RESERVED_FIELD"));
});

test("too many commands hits the input budget", async () => {
  const { hooks } = createHooks();
  const data = createBaseMvuData({});
  const content = Array.from({ length: 200 }, (_, i) => `_.set('v${i}', ${i});`).join("\n");
  const result = await updateVariablesWithSecurity(content, data, hooks);
  assert.equal(result.modified, false);
  assert.ok(result.errors.some((e) => e.code === "MVU_TOO_MANY_COMMANDS"));
});
