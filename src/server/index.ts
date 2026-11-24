import { createReadStream, existsSync, statSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { extname, join, normalize, resolve } from "node:path";
import QRCode from "qrcode";
import { WebSocketServer } from "ws";
import type { PublicConfig } from "../shared/protocol.ts";
import { lanAddresses, loadOrCreateCert } from "./certs.ts";
import { loadConfig, ROOT } from "./config.ts";
import { Hub } from "./hub.ts";
import { Store } from "./store.ts";

const DEV = process.argv.includes("--dev");
const cfg = loadConfig();
const store = new Store(join(cfg.dataDir, "games.json"));

const ips = lanAddresses();
const playUrl = `https://${ips[0] ?? "localhost"}:${cfg.httpsPort}/`;
const qrSvg = await QRCode.toString(cfg.qrUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
const publicConfig: PublicConfig = {
  title: cfg.title,
  school: cfg.school,
  course: cfg.course,
  qrUrl: cfg.qrUrl,
  qrLabel: cfg.qrLabel,
  qrSvg,
  playUrl,
};
const hub = new Hub(store, () => publicConfig, cfg.adminPin);

// ---------- pagine e file statici ----------

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler;

const PAGES: Record<string, string> = {
  "/": "index.html",
  "/tv": "tv.html",
  "/monitor": "tv.html",
  "/spettatore": "spectator.html",
  "/admin": "admin.html",
};

if (DEV) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true, hmr: false },
    appType: "mpa",
  });
  handler = (req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    if (PAGES[path] && path !== "/") req.url = `/${PAGES[path]}`;
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end("Not found");
    });
  };
} else {
  const dist = resolve(ROOT, "dist");
  if (!existsSync(join(dist, "index.html"))) {
    console.error("Manca la build del client: esegui prima `npm run build` (oppure usa `npm run dev`).");
    process.exit(1);
  }
  const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".glb": "model/gltf-binary",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
  };
  handler = (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const rel = PAGES[path] ?? path.replace(/^\/+/, "");
    const file = normalize(join(dist, rel));
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    // i bundle in assets/ hanno l'hash nel nome; i media cambiano di rado
    const immutable = rel.startsWith("assets/");
    const media = rel.startsWith("media/");
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : media ? "public, max-age=3600" : "no-cache",
    });
    createReadStream(file).pipe(res);
  };
}

const route: Handler = (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }
  handler(req, res);
};

// ---------- server HTTP (localhost/TV) + HTTPS (visori) ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
wss.on("connection", (ws) => hub.attach(ws));

function upgrade(server: http.Server | https.Server) {
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
}

const httpServer = http.createServer(route);
upgrade(httpServer);
httpServer.listen(cfg.httpPort, "0.0.0.0");

const tls = await loadOrCreateCert(join(cfg.dataDir, "certs"));
const httpsServer = https.createServer(tls, route);
upgrade(httpsServer);
httpsServer.listen(cfg.httpsPort, "0.0.0.0");

const line = "─".repeat(60);
console.log(`\n${line}\n  Orbita ${DEV ? "(sviluppo)" : ""} è attivo\n${line}`);
console.log(`  Monitor classifica:    http://localhost:${cfg.httpPort}/monitor`);
console.log(`  Monitor spettatore:    http://localhost:${cfg.httpPort}/spettatore`);
console.log(`  Operatore:             http://localhost:${cfg.httpPort}/admin`);
console.log(`  Gioco su questo PC:    http://localhost:${cfg.httpPort}/`);
for (const ip of ips) console.log(`  Visori / altri PC:     https://${ip}:${cfg.httpsPort}/`);
if (ips.length === 0) console.log("  ⚠ Nessuna rete trovata: collega il PC all'hotspot e riavvia.");
console.log(`  Dati partite:          ${join(cfg.dataDir, "games.json")}`);
console.log(`${line}\n`);

function shutdown() {
  store.flush();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
