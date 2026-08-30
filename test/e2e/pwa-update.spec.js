const { test, expect } = require("@playwright/test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function copyBuildSource(target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of ["index.html", "manifest.webmanifest", "sw.js", "_headers", "build.js", "icon-192.png", "icon-512.png", "src"]) {
    fs.cpSync(path.join(ROOT, entry), path.join(target, entry), { recursive: true });
  }
}

function build(target) {
  execFileSync(process.execPath, ["build.js"], { cwd: target, stdio: "pipe" });
  return JSON.parse(fs.readFileSync(path.join(target, "dist", "asset-manifest.json"), "utf8"));
}

function contentType(filename) {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filename.endsWith(".css")) return "text/css; charset=utf-8";
  if (filename.endsWith(".json")) return "application/json; charset=utf-8";
  if (filename.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  if (filename.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function startSwitchableServer(first, second) {
  let active = first;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__switch") {
      active = second;
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const target = path.resolve(active, "." + pathname);
    if (!target.startsWith(active + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    fs.readFile(target, (error, content) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentType(target),
        "Cache-Control": "no-store",
        "Service-Worker-Allowed": "/"
      });
      response.end(content);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test("updates atomically and keeps the latest complete build offline", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Service worker update lifecycle is covered once in Chromium.");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zeitrechner-update-"));
  const sourceA = path.join(temp, "a");
  const sourceB = path.join(temp, "b");
  copyBuildSource(sourceA);
  copyBuildSource(sourceB);
  fs.appendFileSync(path.join(sourceB, "src", "app.js"), "\n// synthetic update fixture\n");
  const manifestA = build(sourceA);
  const manifestB = build(sourceB);
  expect(manifestB.version).not.toBe(manifestA.version);

  const server = await startSwitchableServer(path.join(sourceA, "dist"), path.join(sourceB, "dist"));
  const failures = [];
  page.on("requestfailed", (request) => failures.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url() + " -> " + response.status());
  });

  try {
    await page.goto(server.url + "/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator(".about-version")).toHaveText(manifestA.displayVersion);

    await new Promise((resolve, reject) => {
      http.get(server.url + "/__switch", (response) => {
        response.resume();
        response.on("end", resolve);
      }).on("error", reject);
    });

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const changed = new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        setTimeout(resolve, 5000);
      });
      await registration.update();
      await changed;
    });
    await page.reload();
    await expect(page.locator(".about-version")).toHaveText(manifestB.displayVersion);
    expect(failures).toEqual([]);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Zeitrechner");
    await expect(page.locator(".about-version")).toHaveText(manifestB.displayVersion);
  } finally {
    await context.setOffline(false);
    await server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
