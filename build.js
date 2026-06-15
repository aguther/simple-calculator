const { execSync } = require("child_process");
const fs = require("fs");

let sha = process.env.CF_PAGES_COMMIT_SHA || "";
if (!sha) {
  try { sha = execSync("git rev-parse HEAD").toString().trim(); } catch (e) {}
}
const version = sha ? sha.slice(0, 7) : "dev";

const html = fs.readFileSync("index.html", "utf8").replace("__COMMIT__", version);
fs.writeFileSync("index.html", html);
console.log("Build version:", version);
