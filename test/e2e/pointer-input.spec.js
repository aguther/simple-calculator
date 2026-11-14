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
async function clientBox(locator) {
  return locator.evaluate(element => {
    const rect=element.getBoundingClientRect();
    return {x:rect.left,y:rect.top,width:rect.right-rect.left,height:rect.bottom-rect.top};
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

  test("accepts return to the original key after leaving it", async ({page}) => {
    const box=await digit(page,"7").boundingBox();
    await pointer(page,"7","pointerdown",71);
    await pointer(page,"7","pointermove",71,box.width*2,0);
    await pointer(page,"7","pointermove",71,0,0);
    await pointer(page,"7","pointerup",71);
    await digit(page,"8").evaluate(button => button.dispatchEvent(new PointerEvent("click",{bubbles:true,pointerType:"mouse",pointerId:71,detail:1})));
    await expect(page.locator("#current")).toHaveText("7");
    const input=await report(page);
    expect(input.events).toContainEqual(expect.objectContaining({type:"pointerup",pointerId:71,accepted:true,maxDistance:Math.round(box.width*2)}));
  });

  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1180,height:820}]) {
    test(`accepts swipes up to neighboring key outer edges at ${viewport.width}x${viewport.height}`, async ({page}) => {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.locator("#app").evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(viewport.height);
      const button=digit(page,"5");
      const box=await clientBox(button);
      const start={pointerType:"touch",clientX:box.x+box.width/2,clientY:box.y+box.height/2};
      let pointerId=100;
      let accepted=0;
      const expected=["5","55","555","5 555"];
      for(const [neighbor,dx,dy] of [["4",-1,0],["6",1,0],["8",0,-1],["2",0,1]]) {
        const adjacent=await clientBox(digit(page,neighbor));
        const edge={clientX:adjacent.x+(dx<0 ? 0 : dx>0 ? adjacent.width : adjacent.width/2),clientY:adjacent.y+(dy<0 ? 0 : dy>0 ? adjacent.height : adjacent.height/2)};
        const contact={...start,pointerId:pointerId++};
        await button.dispatchEvent("pointerdown",contact);
        await button.dispatchEvent("pointermove",{...contact,...edge});
        await button.dispatchEvent("pointerup",{...contact,...edge});
        await digit(page,neighbor).evaluate((element,id) => element.dispatchEvent(new PointerEvent("click",{bubbles:true,pointerType:"mouse",pointerId:id,detail:1})),contact.pointerId);
        await expect(page.locator("#current")).toHaveText(expected[accepted++]);
        const outside={...start,pointerId:pointerId++};
        await button.dispatchEvent("pointerdown",outside);
        await button.dispatchEvent("pointerup",{...outside,clientX:edge.clientX+dx,clientY:edge.clientY+dy});
        await expect(page.locator("#current")).toHaveText(expected[accepted-1]);
      }
      await expect(page.locator("#current")).toHaveText("5 555");
      const diagonal=await clientBox(digit(page,"9"));
      await button.dispatchEvent("pointerdown",{...start,pointerId:200});
      await button.dispatchEvent("pointerup",{...start,pointerId:200,clientX:diagonal.x+diagonal.width,clientY:diagonal.y});
      await expect(page.locator("#current")).toHaveText("55 555");
      await button.dispatchEvent("pointerdown",{...start,pointerId:201});
      await button.dispatchEvent("pointerup",{...start,pointerId:201,clientX:diagonal.x+diagonal.width+1,clientY:diagonal.y});
      await expect(page.locator("#current")).toHaveText("55 555");
    });
  }

  test("uses the actual neighboring width for the wide zero key and mirrors outer edges", async ({page}) => {
    await digit(page,"7").click();
    const button=digit(page,"0");
    const box=await clientBox(button);
    const adjacent=await clientBox(page.locator('[data-action="sep"]'));
    const boundary=adjacent.x+adjacent.width;
    const start={pointerType:"touch",clientX:box.x+box.width/2,clientY:box.y+box.height/2};
    for(const [id,x] of [[301,boundary],[302,boundary+1],[303,box.x-(boundary-(box.x+box.width))],[304,box.x-(boundary-(box.x+box.width))-1]]) {
      await button.dispatchEvent("pointerdown",{...start,pointerId:id});
      await button.dispatchEvent("pointerup",{...start,pointerId:id,clientX:x});
    }
    await expect(page.locator("#current")).toHaveText("700");
  });

  test("retains contact boundaries through many moves and reports release direction and duration", async ({page}) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+1000));
    const button=digit(page,"5");
    const box=await clientBox(button);
    const start={pointerId:501,pointerType:"touch",clientX:box.x+box.width/2,clientY:box.y+box.height/2};
    await button.dispatchEvent("pointerdown",start);
    await button.evaluate((element,start) => {
      for(let i=0;i<200;i++) element.dispatchEvent(new PointerEvent("pointermove",{...start,bubbles:true,clientX:start.clientX+1}));
    },start);
    await page.clock.runFor(40);
    await button.dispatchEvent("pointerup",{...start,clientX:start.clientX+7,clientY:start.clientY+4});
    await expect(page.locator("#current")).toHaveText("5");
    const input=await report(page);
    expect(input.counts.pointermove).toBe(200);
    expect(input.events.some(event => event.type==="pointermove")).toBe(false);
    expect(input.events).toContainEqual(expect.objectContaining({type:"pointerdown",pointerId:501}));
    const release=input.events.find(event => event.type==="pointerup" && event.pointerId===501);
    expect(release.gesture).toEqual({durationMs:40,deltaX:7,deltaY:4,outsideX:0,outsideY:0});
  });

  test("identifies vertical overrun without recording absolute coordinates", async ({page}) => {
    const button=digit(page,"5");
    const box=await clientBox(button);
    const below=await clientBox(digit(page,"2"));
    const start={pointerId:502,pointerType:"touch",clientX:box.x+box.width/2,clientY:box.y+box.height/2};
    await button.dispatchEvent("pointerdown",start);
    await button.dispatchEvent("pointerup",{...start,clientY:below.y+below.height+3});
    await expect(page.locator("#current")).toHaveText("0");
    const input=await report(page);
    const release=input.events.find(event => event.type==="pointerup" && event.pointerId===502);
    expect(release).toMatchObject({accepted:false,reason:"outside",gesture:{deltaX:0,outsideX:0,outsideY:3}});
    expect(Object.keys(release.gesture).sort()).toEqual(["deltaX","deltaY","durationMs","outsideX","outsideY"]);
  });

  test("distinguishes lost pointer capture from browser cancellation", async ({page}) => {
    await pointer(page,"5","pointerdown",503);
    await digit(page,"5").dispatchEvent("lostpointercapture",{pointerId:503,pointerType:"touch"});
    await expect(page.locator("#current")).toHaveText("0");
    const input=await report(page);
    expect(input.events).toContainEqual(expect.objectContaining({type:"pointercancel",pointerId:503,reason:"capture-lost",accepted:false}));
  });

  test("handles native overlapping touches and returns while retaining history scrolling", async ({page,context,browserName}) => {
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
    const key=await digit(page,"7").boundingBox();
    const returning={id:3,x:key.x+key.width/2,y:key.y+key.height/2};
    await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[returning]});
    await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...returning,x:returning.x+key.width*2}]});
    await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[returning]});
    await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    const nativeReport=await report(page);
    expect(nativeReport.events.filter(event => event.type==="pointercancel")).toEqual([]);
    await expect(page.locator("#current")).toHaveText("127");
    await page.locator("#aboutClose").click();
    await page.evaluate(() => {
      const key=document.querySelector('#pad button[aria-label="1"]');
      const add=document.querySelector('#pad button[data-op="+"]');
      for(let i=0;i<50;i++) { key.click(); add.click(); }
    });
    const tape=page.locator("#tape");
    const before=await tape.evaluate(element => element.scrollTop);
    expect(before).toBeGreaterThan(0);
    const tapeBox=await tape.boundingBox();
    const scrolling={id:4,x:tapeBox.x+tapeBox.width/2,y:tapeBox.y+30};
    await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[scrolling]});
    for(const offset of [30,60,90,120]) {
      await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...scrolling,y:scrolling.y+offset}]});
    }
    await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await expect.poll(() => tape.evaluate(element => element.scrollTop)).toBeLessThan(before);
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
    await pointer(page,"8","pointermove",2,box.width*2,0);
    await pointer(page,"8","pointerup",2,box.width*2,0);
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
    await button.dispatchEvent("pointerup",{...start,pointerId:2,clientX:box.x-box.width*2});
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
      expect(Object.keys(event).every(key => ["type","time","pointerId","pointerType","primary","control","accepted","reason","maxDistance","gesture"].includes(key))).toBe(true);
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
