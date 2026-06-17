const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let sha = process.env.CF_PAGES_COMMIT_SHA || "";
if (!sha) {
  try { sha = execSync("git rev-parse HEAD").toString().trim(); } catch (e) {}
}
const version = sha ? sha.slice(0, 7) : "dev";

const dist = path.join(__dirname, "dist");
if (!fs.existsSync(dist)) fs.mkdirSync(dist);

const assets = ["index.html", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
for (const file of assets) {
  fs.copyFileSync(path.join(__dirname, file), path.join(dist, file));
}

const srcDist = path.join(dist, "src");
if (!fs.existsSync(srcDist)) fs.mkdirSync(srcDist);
fs.copyFileSync(path.join(__dirname, "src", "calculator-core.js"), path.join(srcDist, "calculator-core.js"));

const htmlPath = path.join(dist, "index.html");
fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, "utf8").replaceAll("__COMMIT__", version));

console.log("Build version:", version);
