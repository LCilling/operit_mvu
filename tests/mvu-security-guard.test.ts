/**
 * tests/mvu-security-guard.test.ts
 *
 * 验证 QuickJS 可执行的 UTF-8 字节预算，覆盖 UTF-16 中的单单元、成对与孤立代理项。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { byteLength, guardMessageSize, INPUT_LIMITS } from "../src/mvu/port/security-guard";

test("byteLength counts ASCII, Chinese, and BMP code points", () => {
  assert.equal(byteLength("Operit"), 6);
  assert.equal(byteLength("中文"), 6);
  assert.equal(byteLength("\u00e9\u20ac"), 5);
});

test("byteLength counts supplementary code points from surrogate pairs", () => {
  assert.equal(byteLength("\ud83d\ude3a"), 4);
  assert.equal(byteLength("A\ud83d\ude3a中"), 8);
});

test("byteLength counts isolated surrogates as replacement characters", () => {
  assert.equal(byteLength("\ud83d"), 3);
  assert.equal(byteLength("\udc00"), 3);
  assert.equal(byteLength("\ud83dA\udc00"), 7);
  assert.equal(byteLength("\ud83d\ud83d\ude3a"), 7);
});

test("guardMessageSize applies exact UTF-8 byte limits", () => {
  const withinLimit = "中".repeat(Math.floor(INPUT_LIMITS.maxMessageBytes / 3));
  const overLimit = `${withinLimit}😺`;

  assert.deepEqual(guardMessageSize(withinLimit), { ok: true });
  assert.deepEqual(guardMessageSize(overLimit), { ok: false, code: "MVU_INPUT_TOO_LARGE" });
});
