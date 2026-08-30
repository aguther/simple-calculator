const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const store = require("../src/state-store.js");

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function validMode(entry = "") {
  return { entry, steps: [], lastEntryWasResult: false, pendingOp: null };
}

describe("calculator state persistence", () => {
  test("loads a valid v5 state", () => {
    const storage = new MemoryStorage({
      [store.STORE_KEY]: JSON.stringify({
        version: 5,
        mode: "num",
        saved: {
          time: validMode("1:30"),
          num: { entry: "12.5", steps: [{ op: null, value: 12.5 }], lastEntryWasResult: false, pendingOp: "+" }
        }
      })
    });
    const state = store.load(storage);
    assert.equal(state.mode, "num");
    assert.equal(state.saved.time.entry, "1:30");
    assert.equal(state.saved.num.pendingOp, "+");
  });

  test("migrates v4 once and removes the legacy key", () => {
    const legacy = JSON.stringify({
      mode: "time",
      saved: { time: validMode("45"), num: validMode("2") }
    });
    const storage = new MemoryStorage({ [store.LEGACY_STORE_KEY]: legacy });
    const state = store.load(storage);
    assert.equal(state.saved.time.entry, "45");
    assert.ok(storage.getItem(store.STORE_KEY));
    assert.equal(storage.getItem(store.LEGACY_STORE_KEY), null);
  });

  test("resets only a mode with malformed content", () => {
    const state = store.parse(JSON.stringify({
      version: 5,
      mode: "num",
      saved: {
        time: { entry: "1:30", steps: [{ op: "INVALID", value: 1 }], lastEntryWasResult: false, pendingOp: null },
        num: { entry: "42", steps: [{ op: null, value: 42 }], lastEntryWasResult: false, pendingOp: null }
      }
    }));
    assert.equal(state.mode, "num");
    assert.deepEqual(state.saved.time, store.emptyModeState());
    assert.equal(state.saved.num.entry, "42");
  });

  test("rejects corrupt JSON and non-finite values", () => {
    assert.deepEqual(store.parse("{broken"), store.emptyState());
    assert.deepEqual(store.parse(JSON.stringify({ version: 999, saved: {} })), store.emptyState());
    const state = store.parse(JSON.stringify({
      mode: "time",
      saved: {
        time: { entry: "", steps: [{ op: null, value: null }], lastEntryWasResult: false, pendingOp: null },
        num: validMode()
      }
    }));
    assert.deepEqual(state.saved.time, store.emptyModeState());
  });

  test("rejects unknown persisted step types", () => {
    const state = store.parse(JSON.stringify({
      version: 5,
      mode: "time",
      saved: {
        time: { entry: "", steps: [{ type: "future-step", op: null, value: 1 }], lastEntryWasResult: false, pendingOp: null },
        num: { entry: "8", steps: [], lastEntryWasResult: false, pendingOp: null }
      }
    }));
    assert.deepEqual(state.saved.time, store.emptyModeState());
    assert.equal(state.saved.num.entry, "8");
  });

  test("normalizes settings", () => {
    const storage = new MemoryStorage({
      [store.SETTINGS_KEY]: JSON.stringify({ clickSoundEnabled: 1, historySide: "unexpected" })
    });
    assert.deepEqual(store.loadSettings(storage), { clickSoundEnabled: true, historySide: "left" });
    assert.deepEqual(store.saveSettings(storage, { clickSoundEnabled: false, historySide: "right" }), {
      clickSoundEnabled: false,
      historySide: "right"
    });
  });
});
