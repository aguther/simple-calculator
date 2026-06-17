const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const EDGE_PATHS = [
  process.env.CALCULATOR_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);

function findBrowser() {
  return EDGE_PATHS.find((candidate) => fs.existsSync(candidate));
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json") || file.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const target = path.normalize(path.join(ROOT, pathname));

    if (!target.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(target), "Cache-Control": "no-store" });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/index.html` });
    });
  });
}

function requestJson(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        resolve(JSON.parse(body));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForBrowser(port) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await requestJson(`http://127.0.0.1:${port}/json/version`);
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error("Browser did not expose the DevTools endpoint");
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function removeProfile(profile) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 9) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const headerLength = payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + payload.length);
  frame[0] = 0x81;

  if (payload.length < 126) {
    frame[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payload.length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  const maskOffset = headerLength;
  const mask = crypto.randomBytes(4);
  mask.copy(frame, maskOffset);
  for (let i = 0; i < payload.length; i += 1) {
    frame[maskOffset + 4 + i] = payload[i] ^ mask[i % 4];
  }
  return frame;
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const masked = (second & 0x80) !== 0;
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;

    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    const opcode = buffer[offset] & 0x0f;
    if (opcode === 1) messages.push(payload.toString("utf8"));
    offset += frameLength;
  }

  return { messages, rest: buffer.subarray(offset) };
}

function connectWebSocket(webSocketDebuggerUrl) {
  const url = new URL(webSocketDebuggerUrl);
  const socket = net.connect(Number(url.port), url.hostname);
  const key = crypto.randomBytes(16).toString("base64");
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  let handshaken = false;
  let closing = false;
  const pending = new Map();
  const listeners = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  socket.write([
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "\r\n"
  ].join("\r\n"));

  socket.on("error", (err) => {
    if (!closing) readyReject(err);
  });

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshaken) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headers = buffer.subarray(0, headerEnd).toString("utf8");
      if (!headers.includes(" 101 ")) {
        readyReject(new Error("DevTools WebSocket upgrade failed"));
        return;
      }
      buffer = buffer.subarray(headerEnd + 4);
      handshaken = true;
      readyResolve();
    }

    const decoded = decodeFrames(buffer);
    buffer = decoded.rest;
    for (const message of decoded.messages) {
      const data = JSON.parse(message);
      if (data.id && pending.has(data.id)) {
        pending.get(data.id)(data);
        pending.delete(data.id);
      } else if (data.method && listeners.has(data.method)) {
        for (const listener of listeners.get(data.method)) listener(data.params);
      }
    }
  });

  function once(method) {
    return new Promise((resolve) => {
      const listener = (params) => {
        listeners.set(method, listeners.get(method).filter((fn) => fn !== listener));
        resolve(params);
      };
      listeners.set(method, [...(listeners.get(method) || []), listener]);
    });
  }

  function command(method, params = {}) {
    const id = nextId;
    nextId += 1;
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: timed out`));
      }, 10000);
      pending.set(id, (data) => {
        clearTimeout(timer);
        if (data.error) reject(new Error(`${method}: ${data.error.message}`));
        else resolve(data.result || {});
      });
      ready.then(() => {
        socket.write(encodeFrame(message));
      }, reject);
    });
  }

  return {
    ready,
    command,
    once,
    close() {
      closing = true;
      socket.end();
    }
  };
}

async function run() {
  const browser = findBrowser();
  if (!browser) {
    throw new Error("No Edge or Chrome executable found. Set CALCULATOR_BROWSER to a Chromium-based browser.");
  }

  const { server, url } = await startServer();
  const debugPort = 9223 + Math.floor(Math.random() * 1000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zeitrechner-smoke-"));
  const child = spawn(browser, [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let browserErrors = "";
  child.stderr.on("data", (chunk) => {
    browserErrors += chunk.toString("utf8");
  });

  try {
    await Promise.race([
      waitForBrowser(debugPort),
      waitForExit(child).then(({ code, signal }) => {
        throw new Error(`Browser exited before DevTools became available (code ${code}, signal ${signal}). ${browserErrors.trim()}`);
      })
    ]);
    const tab = await requestJson(`http://127.0.0.1:${debugPort}/json/new?about%3Ablank`, "PUT");
    const cdp = connectWebSocket(tab.webSocketDebuggerUrl);
    const exceptions = [];

    await cdp.command("Page.enable");
    await cdp.command("Runtime.enable");
    const pageLoaded = cdp.once("Page.loadEventFired");
    await cdp.command("Page.navigate", { url });
    await pageLoaded;

    const pageErrorListener = cdp.once("Runtime.exceptionThrown").then((event) => {
      exceptions.push(event.exceptionDetails.text || "Runtime exception");
    });
    pageErrorListener.catch(() => {});

    const result = await cdp.command("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise((resolve, reject) => {
        const wait = () => new Promise((done) => setTimeout(done, 30));
        const clickText = async (text) => {
          const button = [...document.querySelectorAll("button")]
            .find((candidate) => candidate.textContent.trim() === text);
          if (!button) throw new Error("Button not found: " + text);
          button.click();
          await wait();
        };
        (async () => {
          localStorage.clear();
          await clickText("AC");
          for (const key of ["1", ":", "3", "0", "+", "4", "5", "="]) {
            await clickText(key);
          }
          const timeState = {
            title: document.title,
            sum: document.getElementById("sum").textContent,
            minutes: document.getElementById("sumMinutes").textContent,
            current: document.getElementById("current").textContent,
            rows: document.querySelectorAll("#tape .row").length
          };
          await clickText("Rechner");
          const numberState = {
            current: document.getElementById("current").textContent,
            hasDecimalKey: [...document.querySelectorAll("#pad button")]
              .some((button) => button.textContent.trim() === ".")
          };
          await clickText("Zeit");
          const restoredState = {
            sum: document.getElementById("sum").textContent,
            current: document.getElementById("current").textContent
          };
          resolve({ timeState, numberState, restoredState });
        })().catch(reject);
      })`
    });

    cdp.close();
    assert.deepEqual(exceptions, []);
    assert.equal(result.result.value.timeState.title, "Zeitrechner");
    assert.equal(result.result.value.timeState.sum, "2:15");
    assert.equal(result.result.value.timeState.minutes, "135 min");
    assert.equal(result.result.value.timeState.current, "2:15");
    assert.ok(result.result.value.timeState.rows >= 3);
    assert.equal(result.result.value.numberState.current, "0");
    assert.equal(result.result.value.numberState.hasDecimalKey, true);
    assert.equal(result.result.value.restoredState.sum, "2:15");
    assert.equal(result.result.value.restoredState.current, "2:15");

    console.log("browser smoke test passed");
  } finally {
    if (!child.killed) {
      const exited = waitForExit(child);
      child.kill();
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    }
    server.close();
    await removeProfile(profile);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
