/**
 * tests/mvu-command-parser.test.ts
 *
 * 针对 core/command-parser 与 port/util、port/structured-parser 的字符化测试。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { extractCommands, parseParameters, pathFix, isJsonPatch } from "../src/mvu/core/command-parser";
import { parseCommandValue, parseString } from "../src/mvu/port/structured-parser";
import { toPath, get, set, has, unset, klona, isEqual } from "../src/mvu/port/util";
import { correctlyMerge } from "../src/mvu/port/merge";

test("extractCommands sorts set commands by position and strips reason", () => {
  const content = "先 _.set('a', 1);//first\n然后 _.set('b', 2);//second";
  const commands = extractCommands(content);
  assert.equal(commands.length, 2);
  // 与上游一致：extractCommands 保留参数原文（含引号），去引号发生在 executor 的 pathFixPass
  assert.deepEqual(commands.map((c) => c.args[0]), ["'a'", "'b'"]);
  assert.deepEqual(commands.map((c) => c.reason), ["first", "second"]);
  assert.deepEqual(commands.map((c) => c.type), ["set", "set"]);
});

test("extractCommands handles nested parens and brackets", () => {
  const content = "_.set('p', [\"a ) b\", { x: 1 }]);//note";
  const commands = extractCommands(content);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].args, ["'p'", '["a ) b", { x: 1 }]']);
  assert.equal(commands[0].reason, "note");
});

test("extractCommands parses json_patch blocks into commands", () => {
  const content = "<json_patch>[{\"op\":\"replace\",\"path\":\"/a\",\"value\":5}]</json_patch>";
  const commands = extractCommands(content);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "set");
  assert.equal(commands[0].reason, "json_patch");
});

test("isJsonPatch validates arrays", () => {
  assert.equal(isJsonPatch([]), true);
  assert.equal(isJsonPatch([{ op: "replace", path: "/a", value: 1 }]), true);
  assert.equal(isJsonPatch([{ op: "bogus" }]), false);
  assert.equal(isJsonPatch({}), false);
});

test("pathFix keeps simple fields and rewrites complex ones", () => {
  assert.equal(pathFix("a.b"), "a.b");
  assert.equal(pathFix('foo."a b".c'), 'foo["a b"].c');
  assert.equal(pathFix('root.\'字段 名\'.子'), 'root["字段 名"].子');
});

test("parseParameters splits top-level commas only", () => {
  assert.deepEqual(parseParameters("a, b"), ["a", "b"]);
  assert.deepEqual(parseParameters("a, [1,2], {x:1}"), ["a", "[1,2]", "{x:1}"]);
});

test("toPath and get/set/has/unset behave like lodash on common shapes", () => {
  assert.deepEqual(toPath("a.b[0].c"), ["a", "b", "0", "c"]);
  const obj: Record<string, any> = { a: { b: [{ c: "x" }] } };
  assert.equal(get(obj, "a.b[0].c"), "x");
  set(obj, "a.b[0].c", "y");
  assert.equal(get(obj, "a.b[0].c"), "y");
  assert.equal(has(obj, "a.b"), true);
  // 对象键删除（与 lodash unset 语义一致，数组索引删除会留空洞，故此处用例用对象键）
  unset(obj, "a.b");
  assert.equal(has(obj, "a.b"), false);
  assert.ok(obj.a);
});

test("klona deep-clones arrays and nested objects", () => {
  const value = { a: [1, { b: "z" }] };
  const copy = klona(value);
  assert.notEqual(copy, value);
  assert.notEqual(copy.a, value.a);
  assert.deepEqual(copy, value);
});

test("isEqual deep-compares nested structures", () => {
  assert.equal(isEqual({ a: [1, 2] }, { a: [1, 2] }), true);
  assert.equal(isEqual({ a: [1, 2] }, { a: [1, 3] }), false);
});

test("correctlyMerge overrides arrays like upstream", () => {
  const result = correctlyMerge({ list: [1, 2, 3] }, { list: [4, 5] });
  assert.deepEqual(result.list, [4, 5]);
});

test("parseCommandValue handles scalars and math without new Function", () => {
  assert.equal(parseCommandValue("true"), true);
  assert.equal(parseCommandValue("null"), null);
  assert.equal(parseCommandValue("42"), 42);
  assert.equal(parseCommandValue("10 + 2"), 12);
  assert.equal(parseCommandValue("sqrt(16)"), 4);
  assert.equal(parseCommandValue("hello_world"), "hello_world");
  assert.deepEqual(parseCommandValue('{"a": 1}'), { a: 1 });
  assert.deepEqual(parseCommandValue("[1, 2, { a: 3 }]"), [1, 2, { a: 3 }]);
  // plain object literal without quotes（JSON5 容忍）
  assert.deepEqual(parseCommandValue("{ a: 1, b: 'x' }"), { a: 1, b: "x" });
});

test("parseString parses json / json5 / block scalar", () => {
  assert.deepEqual(parseString('{"a": 1}'), { a: 1 });
  assert.deepEqual(parseString("[1, 2]"), [1, 2]);
  // 单引号 + 未加引号键（JSON5）
  assert.deepEqual(parseString("{ a: 'x', b: [1] }"), { a: "x", b: [1] });
});
