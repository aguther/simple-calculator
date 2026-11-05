const { test, expect } = require("@playwright/test");

async function seed(page, count, entry = "", extra = {}) {
  await page.addInitScript(({ count, entry, extra }) => {
    const empty = { entry: "", steps: [], lastEntryWasResult: false, pendingOp: null, error: null };
    localStorage.setItem("zeitrechner-state-v5", JSON.stringify({ version: 5, mode: "num", saved: {
      time: empty, num: { ...empty, entry, steps: Array.from({length: count}, (_, i) => ({op: i ? "+" : null, value: 1})), pendingOp: "+", ...extra }
    }}));
  }, {count, entry, extra});
  await page.goto("/");
}
const digit = (page, value) => page.getByRole("button", {name: value, exact: true});

test.describe("input stability", () => {
  test("allows exactly 1000 rows and rejects a closing parenthesis atomically", async ({page}) => {
    await seed(page, 999, "2");
    await page.getByLabel("Addieren", {exact:true}).click();
    await expect(page.locator("#tape .row")).toHaveCount(1000);
    await expect(page.locator("#inputNotice")).toBeEmpty();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("zeitrechner-state-v5")).saved.num.steps.length)).toBe(1000);
  });

  test("rejects closing a group when the entry and close would exceed capacity", async ({page}) => {
    await seed(page, 998, "2", {steps:[{type:"paren",value:"("}, ...Array.from({length:998},(_,i)=>({op:i ? "+" : null,value:1}))]});
    await page.getByLabel("Klammer zu", {exact:true}).click();
    await expect(page.locator("#inputNotice")).toContainText("1.000");
    await expect(page.locator("#tape .row")).toHaveCount(999);
    await expect(page.locator("#current")).toHaveText("2");
  });

  test("keeps both modes in memory before the pending write", async ({page}) => {
    await page.goto("/");
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+1000));
    await digit(page,"3").click();
    await page.getByRole("button",{name:"Rechner",exact:true}).click();
    await digit(page,"4").click();
    await page.getByRole("button",{name:"Zeit",exact:true}).click();
    await expect(page.locator("#current")).toHaveText("0:03");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    expect(await page.evaluate(() => {const {saved}=JSON.parse(localStorage.getItem("zeitrechner-state-v5")); return [saved.time.entry,saved.num.entry];})).toEqual(["3","4"]);
  });

  test("continues calculating when writes fail with a quota error", async ({page}) => {
    const problems=[];
    page.on("pageerror", error => problems.push(error.message));
    await page.addInitScript(() => { Storage.prototype.setItem=function(){throw new DOMException("full","QuotaExceededError");}; });
    await page.goto("/");
    await digit(page,"3").click();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await digit(page,"4").click();
    await expect(page.locator("#current")).toHaveText("0:34");
    expect(problems).toEqual([]);
  });

  for (const count of [100, 500, 1000]) {
    test(`preserves ${count} tape nodes during digit entry`, async ({ page }) => {
      await seed(page, count);
      await page.evaluate(() => { window.firstRow = document.getElementById("tape").firstChild; });
      await digit(page, "2").click();
      expect(await page.evaluate(() => window.firstRow === document.getElementById("tape").firstChild)).toBe(true);
      await expect(page.locator("#current")).toHaveText("2");
    });
  }

  test("keeps grouped tape and its evaluation unchanged during entry", async ({page}) => {
    await page.goto("/");
    await page.getByLabel("Klammer auf", {exact:true}).click();
    await digit(page,"1").click();
    await page.getByLabel("Klammer zu", {exact:true}).click();
    await page.getByLabel("Addieren", {exact:true}).click();
    await page.evaluate(() => { window.lastRow = document.getElementById("tape").lastChild; window.originalEvaluate = CalculatorCore.evaluateSteps; window.evaluations = 0; CalculatorCore.evaluateSteps = (...args) => { window.evaluations++; return window.originalEvaluate(...args); }; });
    await digit(page,"2").click();
    expect(await page.evaluate(() => ({same: window.lastRow === document.getElementById("tape").lastChild, evaluations: window.evaluations}))).toEqual({same:true,evaluations:0});
  });

  test("batches writes for 150ms and flushes lifecycle events", async ({page}) => {
    await page.goto("/");
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.evaluate(() => {
      window.writes = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if(key === "zeitrechner-state-v5") window.writes++; return original.call(this,key,value); };
      for (const n of ["1","2","3"]) document.querySelector(`#pad button[aria-label="${n}"]`).click();
    });
    expect(await page.evaluate(() => window.writes)).toBe(0);
    await page.clock.runFor(149);
    expect(await page.evaluate(() => window.writes)).toBe(0);
    await page.clock.runFor(1);
    expect(await page.evaluate(() => window.writes)).toBe(1);
    for (const type of ["pagehide", "visibilitychange"]) {
      await page.evaluate(type => {
        document.querySelector('#pad button[aria-label="4"]').click();
        if(type === "visibilitychange") { Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"}); document.dispatchEvent(new Event(type)); }
        else window.dispatchEvent(new Event(type));
      }, type);
    }
    expect(await page.evaluate(() => ({writes:window.writes, entry:JSON.parse(localStorage.getItem("zeitrechner-state-v5")).saved.time.entry}))).toEqual({writes:3, entry:"12344"});
  });

  test("survives unavailable storage including a throwing getter", async ({page}) => {
    const problems = [];
    page.on("pageerror", error => problems.push(error.message));
    await page.addInitScript(() => Object.defineProperty(window,"localStorage",{get() {throw new DOMException("blocked","SecurityError");}}));
    await page.goto("/");
    await digit(page,"7").click();
    await page.getByLabel("Addieren",{exact:true}).click();
    await digit(page,"2").click();
    await page.getByLabel("Ergebnis",{exact:true}).click();
    await expect(page.locator("#current")).toHaveText("0:09");
    expect(problems).toEqual([]);
  });

  test("rejects entry overflow without losing the existing calculation", async ({page}) => {
    await seed(page, 1, "1".repeat(64));
    await digit(page,"2").click();
    await expect(page.locator("#inputNotice")).toContainText("64");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("zeitrechner-state-v5")).saved.num.entry)).toBe("1".repeat(64));
    await expect(page.locator("#tape .row")).toHaveCount(1);
  });

  for(const action of ["Addieren", "Ergebnis", "Klammer auf"]) {
    test(`rejects history overflow atomically for ${action}`, async ({page}) => {
      await seed(page, 1000, "2");
      await page.getByLabel(action,{exact:true}).click();
      await expect(page.locator("#inputNotice")).toContainText("1.000");
      await expect(page.locator("#current")).toHaveText("2");
      await expect(page.locator("#tape .row")).toHaveCount(1000);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("zeitrechner-state-v5")).saved.num.steps.length)).toBe(1000);
    });
  }
});

for(const viewport of [{width:390,height:844},{width:820,height:1180}]) {
  test.describe(`touch ${viewport.width}`, () => {
    test.use({hasTouch:true, viewport});
    test.beforeEach(async ({page,browserName}) => {
      test.skip(browserName === "firefox", "Touch coverage runs in Chromium and WebKit.");
      await page.goto("/");
      await page.getByRole("button",{name:"Rechner",exact:true}).tap();
    });
    test("accepts rapid repeated and alternating edge taps exactly once", async ({page}) => {
      for(const n of "112233121") {
        const box = await digit(page,n).boundingBox();
        await page.touchscreen.tap(box.x+2, box.y+box.height/2);
      }
      await expect(page.locator("#current")).toHaveText("112 233 121");
    });
    test("keeps button hit geometry fixed while pressed and ignores canceled gestures", async ({page}) => {
      const button = digit(page,"7");
      const before = await button.boundingBox();
      await button.dispatchEvent("pointerdown",{pointerId:1,pointerType:"touch"});
      await page.waitForTimeout(100);
      expect(await button.boundingBox()).toEqual(before);
      await button.dispatchEvent("pointercancel",{pointerId:1,pointerType:"touch"});
      await expect(page.locator("#current")).toHaveText("0");
      await button.tap();
      await expect(page.locator("#current")).toHaveText("7");
      await page.screenshot({path:test.info().outputPath("touch-layout.png")});
    });
    test("accepts taps after rotation and return from background", async ({page}) => {
      await page.setViewportSize({width:viewport.height,height:viewport.width});
      await digit(page,"3").tap();
      await page.evaluate(() => { window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true})); });
      await page.setViewportSize(viewport);
      await digit(page,"4").tap();
      await expect(page.locator("#current")).toHaveText("34");
    });
  });
}
