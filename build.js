const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const ASSETS_DIR = path.join(DIST, "assets");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}

function shortHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function commitVersion() {
  const fromCloudflare = process.env.CF_PAGES_COMMIT_SHA || process.env.CLOUDFLARE_COMMIT_SHA || "";
  if (fromCloudflare) return fromCloudflare.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (error) {
    return "dev";
  }
}

const sourceAssets = [
  { source: "src/app.css", name: "app", extension: ".css" },
  { source: "src/viewport.js", name: "viewport", extension: ".js" },
  { source: "src/calculator-core.js", name: "calculator-core", extension: ".js" },
  { source: "src/state-store.js", name: "state-store", extension: ".js" },
  { source: "src/app.js", name: "app", extension: ".js" }
].map((asset) => ({ ...asset, content: read(asset.source) }));

const buildFingerprint = shortHash(Buffer.concat([
  read("index.html"),
  read("manifest.webmanifest"),
  read("sw.js"),
  read("_headers"),
  ...sourceAssets.map((asset) => asset.content)
]));
const displayVersion = commitVersion() + "." + buildFingerprint.slice(0, 7);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const builtAssets = new Map();
for (const asset of sourceAssets) {
  const filename = asset.name + "." + shortHash(asset.content) + asset.extension;
  fs.writeFileSync(path.join(ASSETS_DIR, filename), asset.content);
  builtAssets.set(asset.source, "assets/" + filename);
}

let html = read("index.html").toString("utf8");
for (const [source, built] of builtAssets) {
  html = html.replaceAll(source, built);
}
html = html.replaceAll("__COMMIT__", displayVersion);
fs.writeFileSync(path.join(DIST, "index.html"), html);

for (const filename of ["manifest.webmanifest", "icon-192.png", "icon-512.png", "_headers"]) {
  fs.copyFileSync(path.join(ROOT, filename), path.join(DIST, filename));
}

const precacheAssets = [
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  ...Array.from(builtAssets.values(), (asset) => "./" + asset)
];
let serviceWorker = read("sw.js").toString("utf8");
serviceWorker = serviceWorker.replaceAll("__BUILD_VERSION__", buildFingerprint);
serviceWorker = serviceWorker.replace(
  /\/\*__PRECACHE_ASSETS__\*\/\s*\[[\s\S]*?\];/,
  "/*__PRECACHE_ASSETS__*/ " + JSON.stringify(precacheAssets, null, 2) + ";"
);
fs.writeFileSync(path.join(DIST, "sw.js"), serviceWorker);

const assetManifest = {
  version: buildFingerprint,
  displayVersion,
  assets: Object.fromEntries(builtAssets),
  precache: precacheAssets
};
fs.writeFileSync(path.join(DIST, "asset-manifest.json"), JSON.stringify(assetManifest, null, 2) + "\n");

console.log("Build version:", displayVersion);
console.log("Build fingerprint:", buildFingerprint);
