const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

function runBuild() {
  execFileSync(process.execPath, ["build.js"], { cwd: ROOT, stdio: "pipe" });
  return JSON.parse(fs.readFileSync(path.join(DIST, "asset-manifest.json"), "utf8"));
}

test("build is deterministic and references complete hashed assets", () => {
  const first = runBuild();
  const second = runBuild();
  assert.deepEqual(second, first);
  assert.match(first.version, /^[a-f0-9]{12}$/);

  for (const asset of first.precache) {
    assert.ok(fs.existsSync(path.join(DIST, asset.replace(/^\.\//, ""))), "missing precache asset: " + asset);
  }

  const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(DIST, "sw.js"), "utf8");
  assert.doesNotMatch(html, /__COMMIT__|src\/app\.(?:css|js)|src\/calculator-core\.js|src\/state-store\.js/);
  assert.doesNotMatch(serviceWorker, /__BUILD_VERSION__/);
  assert.match(serviceWorker, new RegExp(first.version));

  for (const built of Object.values(first.assets)) {
    assert.ok(html.includes(built), "HTML does not reference " + built);
  }
});

test("manifest and Cloudflare headers encode the deployment contract", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8"));
  const headers = fs.readFileSync(path.join(DIST, "_headers"), "utf8");
  const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.orientation, "any");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  assert.match(headers, /Content-Security-Policy:.*script-src 'self'.*style-src 'self'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
  assert.match(headers, /Permissions-Policy:/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /\/assets\/\*/);
  assert.match(headers, /immutable/);
  assert.match(headers, /\/sw\.js[\s\S]*no-cache/);
  assert.doesNotMatch(html, /<(?:script|style)(?![^>]*(?:src)=)[^>]*>\s*[^<\s]/i);
  assert.doesNotMatch(html, /\sstyle=/i);
  for (const source of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) {
    assert.doesNotMatch(source[1], /^(?:data:|https?:|\/\/)/, "CSP-external resource: " + source[1]);
  }
});

test("standalone layout overrides unreliable dynamic viewport units", () => {
  const css = fs.readFileSync(path.join(ROOT, "src", "app.css"), "utf8");
  const standalone = css.match(/@media \(display-mode: standalone\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(standalone, "missing standalone viewport override");
  assert.match(standalone[1], /body,\s*\.app\s*\{[\s\S]*height:\s*100vh/);
  assert.doesNotMatch(standalone[1], /height:\s*100[dl]vh/);
});
