const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const core = require("../src/calculator-core.js");

function step(op, value, unit) {
  return unit ? { op, value, unit } : { op, value };
}

describe("time entry and formatting", () => {
  test("supports shorthand and explicit time fields", () => {
    assert.equal(core.entryToSeconds("145"), 6300);
    assert.equal(core.entryToSeconds("123"), 4980);
    assert.equal(core.entryToSeconds("1:45"), 6300);
    assert.equal(core.entryToSeconds("1:2"), 3720);
    assert.equal(core.entryToSeconds("1::15"), 3615);
    assert.equal(core.fmtTimeEntry("123"), "1:23");
    assert.equal(core.fmtTimeEntry("1:2"), "1:02");
    assert.equal(core.fmtTimeEntry("1::1"), "1:00:01");
  });

  test("preserves negative calculated time values", () => {
    assert.equal(core.entryToSeconds("-0:45"), -2700);
    assert.equal(core.entryToSeconds("-1:02:03"), -3723);
    assert.equal(core.fmtTimeEntry("-0:45"), "−0:45");
    assert.equal(core.valueToEntry(-2700, "time"), "-0:45");
    assert.equal(core.valueToEntry(-3723, "time"), "-1:02:03");
  });

  test("formats normalized values and minute totals", () => {
    assert.equal(core.fmtSeconds(1500), "0:25");
    assert.equal(core.fmtSeconds(-90), "−0:01:30");
    assert.equal(core.fmtMinutes(3600), "60 min");
  });
});

describe("number entry and formatting", () => {
  test("parses localized input and groups output", () => {
    assert.equal(core.numberEntryValue("1 234,5"), 1234.5);
    assert.equal(core.fmtNum(1234567.1234567), "1 234 567.123457");
    assert.equal(core.fmtNumEntry("1234567."), "1 234 567.");
  });

  test("keeps finite precision for large values", () => {
    assert.equal(core.fmtNum(999999999.12345678), "999 999 999.123457");
    assert.equal(core.valueToEntry(1 / 3, "num"), "0.333333");
  });
});

describe("expression evaluation", () => {
  test("applies operator precedence", () => {
    assert.equal(core.evaluateSteps([
      step(null, 2),
      step("+", 3),
      step("*", 4)
    ]), 14);
  });

  test("evaluates parentheses", () => {
    assert.equal(core.evaluateSteps([
      { type: "paren", value: "(" },
      step(null, 2),
      step("+", 3),
      { type: "paren", value: ")" },
      step("*", 4)
    ]), 20);
  });

  test("continues from intermediate sums", () => {
    assert.equal(core.evaluateSteps([
      step(null, 3600),
      step("+", 1800),
      { type: "sum", value: 5400 },
      step("+", 900)
    ]), 6300);
  });

  test("reports division by zero as non-finite", () => {
    assert.ok(Number.isNaN(core.evaluateSteps([step(null, 1), step("/", 0)])));
  });
});
