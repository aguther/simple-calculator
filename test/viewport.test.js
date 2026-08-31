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

test("resets every document scroll source after an iOS rotation", () => {
  const scrollingElement = { scrollTop: 62, scrollLeft: 4 };
  const documentElement = { scrollTop: 62, scrollLeft: 4 };
  const body = { scrollTop: 62, scrollLeft: 4 };
  let scrollCall = null;
  viewport.resetScroll({ scrollTo: (x, y) => { scrollCall = [x, y]; } }, { scrollingElement, documentElement, body });
  assert.deepEqual(scrollCall, [0, 0]);
  for (const element of [scrollingElement, documentElement, body]) {
    assert.equal(element.scrollTop, 0);
    assert.equal(element.scrollLeft, 0);
  }
});

test("classifies portrait and landscape from the current layout viewport", () => {
  assert.equal(viewport.orientationKey({ innerWidth: 402, innerHeight: 874 }), "portrait");
  assert.equal(viewport.orientationKey({ innerWidth: 874, innerHeight: 402 }), "landscape");
});
