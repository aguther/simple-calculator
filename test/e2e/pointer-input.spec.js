const { test, expect } = require("@playwright/test");

const digit = (page, n) => page.getByRole("button", {name:n, exact:true});
async function pointer(page, n, type, id=1, dx=0, dy=0, extra={}) {
  const box = await digit(page,n).boundingBox();
  await digit(page,n).dispatchEvent(type, {
    pointerId:id, pointerType:"touch", isPrimary:id===1,
    clientX:box.x+box.width/2+dx, clientY:box.y+box.height/2+dy,
    button:0, buttons:type==="pointerup" ? 0 : 1, ...extra
  });
}
async function report(page) {
  await page.getByRole("button",{name:"Informationen und Einstellungen"}).click();
  await page.getByRole("button",{name:"Diagnose anzeigen"}).click();
  const output=page.locator("#diagnosticsOutput");
  await expect(output).not.toBeEmpty();
  return JSON.parse(await output.textContent()).input;
}

test.describe("pointer input", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/");
    await page.getByRole("button",{name:"Rechner",exact:true}).click();
  });

  test("suppresses the diagnosed equals click retargeted to an operator", async ({page}) => {
    await digit(page,"7").click();
    const equals=page.locator('[data-action="eq"]');
    const box=await equals.boundingBox();
    const event={pointerType:"touch",pointerId:8311,isPrimary:true,clientX:box.x+box.width/2,clientY:box.y+box.height/2};
    await equals.dispatchEvent("pointerdown",event);
    await equals.dispatchEvent("pointerup",event);
    await page.locator('[data-op="+"]').evaluate(button => button.dispatchEvent(new PointerEvent("click",{bubbles:true,pointerType:"mouse",pointerId:8311,isPrimary:true,detail:1})));
    await expect(page.locator("#pending")).toBeEmpty();
    await digit(page,"2").click();
    await expect(page.locator("#current")).toHaveText("2");
    const input=await report(page);
    expect(input.events).toContainEqual(expect.objectContaining({type:"click",control:"operator",pointerId:8311,accepted:false,reason:"duplicate-click"}));
  });

  test("suppresses a canceled contact click retargeted to another key", async ({page}) => {
    await pointer(page,"7","pointerdown",8312);
    await pointer(page,"7","pointercancel",8312);
    await digit(page,"8").evaluate(button => button.dispatchEvent(new PointerEvent("click",{bubbles:true,pointerType:"mouse",pointerId:8312,detail:1})));
    await expect(page.locator("#current")).toHaveText("0");
    await digit(page,"8").click();
    await expect(page.locator("#current")).toHaveText("8");
  });

  test("accepts movement beyond twelve pixels inside the original key and reports distance", async ({page}) => {
    await pointer(page,"7","pointerdown");
    await pointer(page,"7","pointermove",1,25,0);
    await pointer(page,"7","pointerup",1,20,0);
    await expect(page.locator("#current")).toHaveText("7");
    const input=await report(page);
    expect(input.events).toContainEqual(expect.objectContaining({type:"pointerup",control:"digit",accepted:true,maxDistance:25}));
    for(const event of input.events) {
      expect(event).not.toHaveProperty("clientX");
      expect(event).not.toHaveProperty("clientY");
    }
  });

  test("handles browser-generated overlapping touches with slight movement", async ({page,context,browserName}) => {
    test.skip(browserName!=="chromium", "Native multitouch injection requires Chromium CDP; pointer sequences run in all engines.");
    const session=await context.newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:2});
    const a=await digit(page,"1").boundingBox();
    const b=await digit(page,"2").boundingBox();
    const first={id:1,x:a.x+a.width/2,y:a.y+a.height/2};
    const second={id:2,x:b.x+b.width/2,y:b.y+b.height/2};
    await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[first]});
    await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[first,second]});
    await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...first,x:first.x+4},second]});
    await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[{...first,x:first.x+4}]});
    await expect(page.locator("#current")).toHaveText("1");
    await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await expect(page.locator("#current")).toHaveText("12");
    await session.detach();
  });

  for (const reverse of [false,true]) {
    test(`accepts overlapping contacts once in release order, reverse=${reverse}`, async ({page}) => {
      await pointer(page,"1","pointerdown",1);
      await pointer(page,"2","pointerdown",2);
      await expect(page.locator("#current")).toHaveText("0");
      let expected="";
      for (const n of reverse ? ["2","1"] : ["1","2"]) {
        await pointer(page,n,"pointerup",Number(n));
        expected+=n;
        await expect(page.locator("#current")).toHaveText(expected);
        await digit(page,n).dispatchEvent("click",{pointerId:Number(n),pointerType:"touch",detail:1});
      }
      await expect(page.locator("#current")).toHaveText(reverse ? "21" : "12");
    });
  }

  test("tolerates slight finger movement without a synthesized click", async ({page}) => {
    await pointer(page,"7","pointerdown");
    await pointer(page,"7","pointermove",1,5,4);
    await pointer(page,"7","pointerup",1,5,4);
    await expect(page.locator("#current")).toHaveText("7");
  });

  test("rejects canceled and dragged contacts and recovers on the next tap", async ({page}) => {
    await pointer(page,"7","pointerdown");
    await pointer(page,"7","pointercancel");
    await digit(page,"7").dispatchEvent("click",{pointerType:"touch",pointerId:1,detail:1});
    await pointer(page,"8","pointerdown",2);
    const box=await digit(page,"8").boundingBox();
    await pointer(page,"8","pointermove",2,box.width,0);
    await pointer(page,"8","pointerup",2);
    await expect(page.locator("#current")).toHaveText("0");
    await pointer(page,"9","pointerdown",3);
    await pointer(page,"9","pointerup",3);
    await expect(page.locator("#current")).toHaveText("9");
  });

  test("suppresses legacy touch clicks while preserving keyboard and mouse activation", async ({page}) => {
    await pointer(page,"3","pointerdown");
    await pointer(page,"3","pointerup");
    await digit(page,"3").dispatchEvent("click",{detail:1});
    await digit(page,"3").focus();
    await page.keyboard.press("Space");
    await digit(page,"3").click();
    await digit(page,"4").click();
    await expect(page.locator("#current")).toHaveText("3 334");
  });

  test("accepts overlapping contacts on the same key exactly once each", async ({page}) => {
    await pointer(page,"5","pointerdown",1);
    await pointer(page,"5","pointerdown",2);
    await pointer(page,"5","pointerup",2);
    await expect(digit(page,"5")).toHaveClass(/is-pressed/);
    await pointer(page,"5","pointerup",1);
    await expect(digit(page,"5")).not.toHaveClass(/is-pressed/);
    await expect(page.locator("#current")).toHaveText("55");
  });

  test("accepts small drift across a key edge but rejects release outside the target", async ({page}) => {
    const button=digit(page,"7");
    const box=await button.boundingBox();
    const start={pointerType:"touch",pointerId:1,clientX:box.x+2,clientY:box.y+box.height/2};
    await button.dispatchEvent("pointerdown",start);
    await button.dispatchEvent("pointerup",{...start,clientX:box.x-3});
    await expect(page.locator("#current")).toHaveText("7");
    await button.dispatchEvent("pointerdown",{...start,pointerId:2});
    await button.dispatchEvent("pointerup",{...start,pointerId:2,clientX:box.x-9});
    await expect(page.locator("#current")).toHaveText("7");
  });

  test("abandons an old contact when the mode changes", async ({page}) => {
    await pointer(page,"7","pointerdown");
    await page.getByRole("button",{name:"Zeit",exact:true}).click();
    await pointer(page,"7","pointerup");
    await expect(page.locator("#current")).toHaveText("0:00");
    await pointer(page,"8","pointerdown",2);
    await pointer(page,"8","pointerup",2);
    await expect(page.locator("#current")).toHaveText("0:08");
  });

  test("clears unfinished contacts on backgrounding", async ({page}) => {
    await pointer(page,"7","pointerdown");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await pointer(page,"7","pointerup");
    await expect(page.locator("#current")).toHaveText("0");
    await pointer(page,"8","pointerdown",2);
    await pointer(page,"8","pointerup",2);
    await expect(page.locator("#current")).toHaveText("8");
  });

  test("reports event delivery, rejection and cancellation without calculation contents", async ({page}) => {
    await pointer(page,"7","pointerdown");
    await pointer(page,"7","pointermove",1,3,2);
    await pointer(page,"7","pointerup",1,3,2);
    await digit(page,"7").dispatchEvent("click",{pointerType:"touch",pointerId:1,detail:1});
    await pointer(page,"8","pointerdown",2);
    await pointer(page,"8","pointercancel",2);
    await page.getByLabel("Alles löschen",{exact:true}).click();
    await page.getByLabel("Dezimaltrennzeichen",{exact:true}).click();
    await page.getByLabel("Dezimaltrennzeichen",{exact:true}).click();
    const input=await report(page);
    expect(input.counts.pointerdown).toBe(2);
    expect(input.counts.pointermove).toBe(1);
    expect(input.counts.pointercancel).toBe(1);
    expect(input.counts.suppressed).toBe(1);
    expect(input.counts.rejected).toBe(1);
    expect(input.activeContacts).toBe(0);
    expect(input.events).toEqual(expect.arrayContaining([
      expect.objectContaining({type:"pointerup",control:"digit",accepted:true}),
      expect.objectContaining({type:"pointercancel",reason:"canceled"})
    ]));
    for(const event of input.events) {
      expect(Object.keys(event).every(key => ["type","time","pointerId","pointerType","primary","control","accepted","reason","maxDistance"].includes(key))).toBe(true);
    }
  });

  test("bounds diagnostic history and clears it on reload", async ({page}) => {
    await page.evaluate(() => {
      const button=document.querySelector('[data-action="clear"]');
      for(let i=0;i<200;i++) button.click();
    });
    const input=await report(page);
    expect(input.events.length).toBe(120);
    expect(input.counts.rejected).toBe(200);
    await page.reload();
    const fresh=await report(page);
    expect(fresh.events.length).toBeLessThan(10);
    expect(fresh.counts.rejected || 0).toBe(0);
  });
});
