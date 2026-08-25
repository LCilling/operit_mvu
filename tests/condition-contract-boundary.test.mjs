import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createFullBackupExport,
  parseDatasetImport,
} from "../dist/mvu/app/full-backup.js";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { assertMvuDatasetV3 } from "../dist/mvu/app/validation.js";
import { MVU_REQUEST_PARSERS } from "../dist/shared/ipc.js";
import { legacyDatasetFixture } from "./helpers.mjs";

const NOW = Date.parse("2033-05-18T03:33:20.000Z");

function datasetFixture(predicate = { kind: "user_care" }) {
  const dataset = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW).dataset;
  dataset.conditions[0].expression = { kind: "predicate", predicate };
  return dataset;
}

function conditionRequest(predicate) {
  return {
    expectedRevision: 1,
    condition: {
      name: "Boundary condition",
      description: "Production contract fixture",
      enabled: true,
      expression: { kind: "predicate", predicate },
    },
  };
}

function parsePredicate(predicate) {
  return MVU_REQUEST_PARSERS.createCondition(conditionRequest(predicate))
    .condition.expression.predicate;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function resign(document) {
  const unsigned = {
    format: document.format,
    schemaVersion: document.schemaVersion,
    exportedAt: document.exportedAt,
    sourceFormatVersion: document.sourceFormatVersion,
    payload: document.payload,
  };
  document.checksum.value = createHash("sha256").update(canonicalJson(unsigned), "utf8").digest("hex");
  return document;
}

test("condition IPC applies strict Gregorian concrete and repeating dates", () => {
  assert.deepEqual(parsePredicate({ kind: "concrete_date", dates: ["2000-02-29"] }), {
    kind: "concrete_date",
    dates: ["2000-02-29"],
  });
  assert.deepEqual(parsePredicate({ kind: "repeating_date", month: 2, day: 29 }), {
    kind: "repeating_date",
    month: 2,
    day: 29,
  });

  for (const invalidDate of ["2026-02-31", "1900-02-29", "2026-2-03", "2026-00-01"]) {
    assert.throws(
      () => parsePredicate({ kind: "concrete_date", dates: [invalidDate] }),
      /MVU_CONDITION_PREDICATE_INVALID/,
      invalidDate,
    );
  }
  for (const day of [30, 31]) {
    assert.throws(
      () => parsePredicate({ kind: "repeating_date", month: 2, day }),
      /MVU_CONDITION_PREDICATE_INVALID/,
      `02-${day}`,
    );
  }
});

test("dataset validation applies the same Gregorian date contract", () => {
  assert.doesNotThrow(() => assertMvuDatasetV3(datasetFixture({
    kind: "concrete_date",
    dates: ["2000-02-29"],
  })));
  assert.doesNotThrow(() => assertMvuDatasetV3(datasetFixture({
    kind: "repeating_date",
    month: 2,
    day: 29,
  })));

  for (const invalidDate of ["2026-02-31", "1900-02-29"]) {
    assert.throws(
      () => assertMvuDatasetV3(datasetFixture({ kind: "concrete_date", dates: [invalidDate] })),
      /MVU_V3_CONDITION_CONCRETE_DATE_INVALID/,
      invalidDate,
    );
  }
  for (const day of [30, 31]) {
    assert.throws(
      () => assertMvuDatasetV3(datasetFixture({ kind: "repeating_date", month: 2, day })),
      /MVU_V3_CONDITION_REPEATING_DATE_INVALID/,
      `02-${day}`,
    );
  }
});

test("actor group and concrete-date arrays share production item and count bounds", () => {
  const cases = [
    ["actor", "actorIds", "MVU_V3_CONDITION_ACTOR_INVALID", (index) => `actor_${index}`],
    ["group", "groupIds", "MVU_V3_CONDITION_GROUP_INVALID", (index) => `group_${index}`],
    ["concrete_date", "dates", "MVU_V3_CONDITION_CONCRETE_DATE_INVALID",
      (index) => `2000-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`],
  ];

  for (const [kind, key, datasetCode, makeItem] of cases) {
    const hundred = Array.from({ length: 100 }, (_, index) => makeItem(index));
    const ipcPredicate = { kind, [key]: hundred };
    assert.equal(parsePredicate(ipcPredicate)[key].length, 100, `${kind} IPC accepts 100`);
    assert.doesNotThrow(
      () => assertMvuDatasetV3(datasetFixture(ipcPredicate)),
      `${kind} dataset accepts 100`,
    );

    const hundredOne = [...hundred, makeItem(100)];
    assert.throws(
      () => parsePredicate({ kind, [key]: hundredOne }),
      /MVU_CONDITION_PREDICATE_INVALID/,
      `${kind} IPC rejects 101`,
    );
    assert.throws(
      () => assertMvuDatasetV3(datasetFixture({ kind, [key]: hundredOne })),
      new RegExp(datasetCode),
      `${kind} dataset rejects 101`,
    );

    for (const invalidItem of ["", "x".repeat(257)]) {
      assert.throws(
        () => parsePredicate({ kind, [key]: [invalidItem] }),
        /MVU_CONDITION_PREDICATE_INVALID/,
        `${kind} IPC rejects invalid item`,
      );
      assert.throws(
        () => assertMvuDatasetV3(datasetFixture({ kind, [key]: [invalidItem] })),
        new RegExp(datasetCode),
        `${kind} dataset rejects invalid item`,
      );
    }

    const duplicate = makeItem(0);
    assert.deepEqual(parsePredicate({ kind, [key]: [duplicate, duplicate] })[key], [duplicate, duplicate]);
    assert.doesNotThrow(() => assertMvuDatasetV3(datasetFixture({ kind, [key]: [duplicate, duplicate] })));
  }
});

test("actor group and concrete-date selections require one through one hundred items at every boundary", () => {
  const cases = [
    ["actor", "actorIds", "actor_one", "MVU_V3_CONDITION_ACTOR_INVALID"],
    ["group", "groupIds", "group_one", "MVU_V3_CONDITION_GROUP_INVALID"],
    ["concrete_date", "dates", "2000-02-29", "MVU_V3_CONDITION_CONCRETE_DATE_INVALID"],
  ];

  for (const [kind, key, oneItem, datasetCode] of cases) {
    const one = { kind, [key]: [oneItem] };
    const empty = { kind, [key]: [] };

    assert.deepEqual(parsePredicate(one)[key], [oneItem], `${kind} IPC accepts one selection`);
    assert.throws(
      () => parsePredicate(empty),
      /MVU_CONDITION_PREDICATE_INVALID/,
      `${kind} IPC rejects zero selections`,
    );
    assert.doesNotThrow(
      () => assertMvuDatasetV3(datasetFixture(one)),
      `${kind} dataset accepts one selection`,
    );
    assert.throws(
      () => assertMvuDatasetV3(datasetFixture(empty)),
      new RegExp(datasetCode),
      `${kind} dataset rejects zero selections`,
    );

    const validDataset = datasetFixture(one);
    const exported = createFullBackupExport({
      revision: validDataset.revision,
      dataset: validDataset,
      records: [],
    }, NOW);
    assert.equal(parseDatasetImport(exported.json, NOW).config.conditions[0].expression.predicate[key].length, 1,
      `${kind} full import accepts one selection`);
    const emptyImport = JSON.parse(exported.json);
    emptyImport.payload.config.conditions[0].expression.predicate[key] = [];
    assert.throws(
      () => parseDatasetImport(JSON.stringify(resign(emptyImport)), NOW),
      new RegExp(datasetCode),
      `${kind} full import rejects zero selections`,
    );
  }
});

test("full-v3 import cannot bypass condition calendar or array bounds", () => {
  const validDataset = datasetFixture({ kind: "concrete_date", dates: ["2000-02-29"] });
  const exported = createFullBackupExport({
    revision: validDataset.revision,
    dataset: validDataset,
    records: [],
  }, NOW);

  const invalidDate = JSON.parse(exported.json);
  invalidDate.payload.config.conditions[0].expression.predicate.dates = ["2026-02-31"];
  assert.throws(
    () => parseDatasetImport(JSON.stringify(resign(invalidDate)), NOW),
    /MVU_V3_CONDITION_CONCRETE_DATE_INVALID/,
  );

  const tooManyActors = JSON.parse(exported.json);
  tooManyActors.payload.config.conditions[0].expression.predicate = {
    kind: "actor",
    actorIds: Array.from({ length: 101 }, (_, index) => `actor_${index}`),
  };
  assert.throws(
    () => parseDatasetImport(JSON.stringify(resign(tooManyActors)), NOW),
    /MVU_V3_CONDITION_ACTOR_INVALID/,
  );
});
