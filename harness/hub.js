// ./rr hub [--port P] [--local]
//
// One long-lived address for everything: the plots and every app, behind a single tunnel whose
// URL stays the same for as long as this process runs. This front process only holds the port
// and the tunnel and proxies to a child server (harness/hub-app.js); when files under harness/,
// scenarios/ or frameworks/ change, it restarts the child, so pages always reflect current code
// without a new URL. Requests made during a restart wait for the new child.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, ROOT } from "./selection.js";
import { openTunnel } from "./tunnel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WATCHED = ["harness", "scenarios", "frameworks"];
const IGNORED = /(^|\/)(node_modules|dist|generated|\.elm-home|elm-stuff|\.git)(\/|$)/;

export async function hubCommand(rest) {
  const args = parseArgs(rest, ["local"]);
  const port = Number(args.port ?? 5190);
  const childPort = port + 1000;

  // The child server, restarted on changes.
  let child = null;
  let ready = null;
  const start = () => {
    child = fork(path.join(HERE, "hub-app.js"), [String(childPort)], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const c = child;
    ready = new Promise((resolve) => c.once("message", (m) => m === "ready" && resolve()));
    c.on("exit", (code, signal) => { if (c === child && signal !== "SIGTERM") console.error(`hub: server exited (${code}); restarting on the next change`); });
  };
  const restart = (why) => {
    console.log(`hub: ${why}, reloading`);
    const old = child;
    start();
    old?.kill("SIGTERM");
  };
  start();

  let timer = null;
  for (const dir of WATCHED) {
    fs.watch(path.join(ROOT, dir), { recursive: true }, (_event, file) => {
      if (!file || IGNORED.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => restart(`${dir}/${file} changed`), 300);
    });
  }

  // The stable front: proxy every request to the current child, waiting out restarts.
  const front = http.createServer(async (req, res) => {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    for (let attempt = 0; attempt < 100; attempt++) {
      await ready;
      try {
        await new Promise((resolve, reject) => {
          const up = http.request({ host: "127.0.0.1", port: childPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
            res.writeHead(r.statusCode, r.headers);
            r.pipe(res);
            r.on("end", resolve);
          });
          up.on("error", reject);
          up.end(Buffer.concat(body));
        });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("hub: the server did not come back");
  });
  await new Promise((resolve, reject) => { front.once("error", reject); front.listen(port, "127.0.0.1", resolve); });
  const local = `http://127.0.0.1:${port}/`;
  console.log(`hub: plots and apps\n  local:  ${local}`);

  // One tunnel for the whole session; reopened (with a new URL) only if cloudflared dies.
  let tunnel = null;
  const openOnce = async () => {
    tunnel = await openTunnel(local);
    console.log(`  public: ${tunnel.url}/`);
    tunnel.child.removeAllListeners("exit");
    tunnel.child.on("exit", (code) => {
      console.error(`hub: cloudflared exited (${code}), reopening (the public URL will change)`);
      setTimeout(() => openOnce().catch((e) => console.error(`hub: ${e.message}`)), 2000);
    });
  };
  if (!args.local) await openOnce();
  console.log("Ctrl-C stops the hub" + (args.local ? "" : " and the tunnel"));

  const stop = () => {
    if (tunnel) { tunnel.child.removeAllListeners("exit"); tunnel.child.kill("SIGTERM"); }
    child?.kill("SIGTERM");
    front.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return new Promise(() => {});
}
