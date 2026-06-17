const assert = require("node:assert/strict");
const core = require("../src/calculator-core.js");

function step(op, value, unit) {
  return unit ? { op, value, unit } : { op, value };
}

assert.equal(core.entryToSeconds("145"), 6300);
assert.equal(core.entryToSeconds("123"), 4980);
assert.equal(core.entryToSeconds("1:45"), 6300);
assert.equal(core.entryToSeconds("1:23"), 4980);
assert.equal(core.entryToSeconds("1:2"), 3720);
assert.equal(core.entryToSeconds("1:1"), 3660);
assert.equal(core.entryToSeconds("1::1"), 3601);
assert.equal(core.entryToSeconds("1::12"), 3612);
assert.equal(core.entryToSeconds("1::15"), 3615);
assert.equal(core.fmtTimeEntry("123"), "1:23");
assert.equal(core.fmtTimeEntry("145"), "1:45");
assert.equal(core.fmtTimeEntry("1:23"), "1:23");
assert.equal(core.fmtTimeEntry("1:2"), "1:02");
assert.equal(core.fmtTimeEntry("1:1"), "1:01");
assert.equal(core.fmtTimeEntry("1::1"), "1:00:01");
assert.equal(core.fmtTimeEntry("1::12"), "1:00:12");
assert.equal(core.fmtSeconds(1500), "0:25");
assert.equal(core.fmtSeconds(-90), "−0:01:30");
assert.equal(core.fmtMinutes(3600), "60 min");

assert.equal(core.numberEntryValue("1 234,5"), 1234.5);
assert.equal(core.fmtNum(1234567.1234567), "1 234 567.123457");
assert.equal(core.fmtNumEntry("1234567."), "1 234 567.");

assert.equal(core.evaluateSteps([
  step(null, 2),
  step("+", 3),
  step("*", 4)
]), 14);

assert.equal(core.evaluateSteps([
  { type: "paren", value: "(" },
  step(null, 2),
  step("+", 3),
  { type: "paren", value: ")" },
  step("*", 4)
]), 20);

assert.equal(core.evaluateSteps([
  step(null, 3600),
  step("+", 1800),
  { type: "sum", value: 5400 },
  step("+", 900)
]), 6300);

assert.ok(Number.isNaN(core.evaluateSteps([step(null, 1), step("/", 0)])));
assert.equal(core.valueToEntry(3661, "time"), "1:01:01");
assert.equal(core.valueLabel(3600, undefined, "time"), "1:00");
assert.equal(core.valueLabel(2, "scalar", "time"), "2");

console.log("calculator-core tests passed");
