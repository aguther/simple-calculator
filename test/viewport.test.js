const assert = require("node:assert/strict");
const { test } = require("node:test");
const viewport = require("../src/viewport.js");

function measure(values) {
  const win = {
    innerHeight: values.innerHeight,
    visualViewport: values.visualViewport || null
  };
  const doc = { documentElement: { clientHeight: values.clientHeight } };
  return viewport.measureViewport(win, doc);
}

test("uses the smallest reliable unzoomed viewport measurement", () => {
  const result = measure({
    innerHeight: 812,
    clientHeight: 812,
    visualViewport: { height: 812, offsetTop: 0, scale: 1 }
  });
  assert.equal(result.height, 812);
});

test("avoids oversized legacy viewport measurements", () => {
  const result = measure({
    innerHeight: 812,
    clientHeight: 874,
    visualViewport: { height: 812, offsetTop: 0, scale: 1 }
  });
  assert.equal(result.height, 812);
});

test("ignores the visual viewport while the page is zoomed", () => {
  const result = measure({
    innerHeight: 812,
    clientHeight: 812,
    visualViewport: { height: 406, offsetTop: 0, scale: 2 }
  });
  assert.equal(result.height, 812);
  assert.equal(result.candidates.visualHeight, null);
});
