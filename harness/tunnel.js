// A local HTTP server plus an optional cloudflared quick tunnel; Ctrl-C stops both.

import http from "node:http";
import { spawn, execFileSync } from "node:child_process";

export function listen(handler, port = 0) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(err.stack || err));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), "127.0.0.1", () => resolve(server));
  });
}

export function cloudflaredVersion() {
  try {
    return execFileSync("cloudflared", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// Start `cloudflared tunnel --url …` and resolve with its public URL.
export function openTunnel(localUrl) {
  if (!cloudflaredVersion()) {
    throw new Error("cloudflared is not on PATH: run inside `nix develop` (or `direnv allow`), or pass --local");
  }
  const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", localUrl], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`cloudflared gave no URL in 60 s:\n${output}`)), 60000);
    const onData = (chunk) => {
      output += chunk;
      const m = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], child });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`cloudflared exited (${code}):\n${output}`)); });
  });
}

// Serve until Ctrl-C, with a tunnel unless `local`. Prints the URLs.
export async function serveUntilInterrupted(handler, { port, local, what }) {
  const server = await listen(handler, port);
  const localUrl = `http://127.0.0.1:${server.address().port}/`;
  console.log(`${what}\n  local:  ${localUrl}`);
  let tunnel = null;
  if (!local) {
    tunnel = await openTunnel(localUrl);
    tunnel.child.removeAllListeners("exit");
    tunnel.child.on("exit", (code) => { console.error(`cloudflared exited (${code})`); });
    console.log(`  public: ${tunnel.url}/`);
  }
  console.log("Ctrl-C stops the server" + (tunnel ? " and the tunnel" : ""));
  const stop = () => {
    if (tunnel) tunnel.child.kill("SIGTERM");
    server.close();
    server.closeAllConnections?.();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return new Promise(() => {});
}
