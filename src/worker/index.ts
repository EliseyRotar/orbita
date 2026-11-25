import { DurableObject } from "cloudflare:workers";
import type { PublicConfig } from "../shared/protocol.ts";
import { Hub } from "../server/hub.ts";
import { SqlStore } from "./sqlstore.ts";

/**
 * Orbita online su Cloudflare.
 * - Le pagine (gioco, monitor, spettatore, operatore) sono file statici serviti da Workers Assets.
 * - `/ws` apre un WebSocket verso un unico Durable Object "Fair": la fiera è una sola stanza,
 *   con poche decine di connessioni, quindi un oggetto basta e garantisce ordine e coerenza.
 */

export interface Env {
  FAIR: DurableObjectNamespace<Fair>;
  ASSETS: Fetcher;
  ADMIN_PIN?: string;
  SCHOOL?: string;
  COURSE?: string;
  QR_URL?: string;
  QR_LABEL?: string;
}

export class Fair extends DurableObject<Env> {
  private hub: Hub;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const config: PublicConfig = {
      title: "Orbita",
      school: env.SCHOOL ?? "ITI G. Marconi · Dalmine",
      course: env.COURSE ?? "Informatica e Telecomunicazioni",
      qrUrl: env.QR_URL ?? "https://www.itisdalmine.edu.it",
      qrLabel: env.QR_LABEL ?? "Scopri il Marconi",
      playUrl: "",
    };
    // online il pannello operatore è raggiungibile da chiunque: senza PIN resta chiuso
    this.hub = new Hub(new SqlStore(ctx.storage.sql), () => config, { adminPin: env.ADMIN_PIN ?? "", requirePin: true });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Serve un WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    const conn = this.hub.connect({
      send: (data) => server.send(data),
      close: () => server.close(1008, "troppi messaggi"),
      get open() {
        return server.readyState === WebSocket.READY_STATE_OPEN;
      },
    });
    server.addEventListener("message", (ev) => conn.message(typeof ev.data === "string" ? ev.data : ""));
    server.addEventListener("close", () => conn.close());
    server.addEventListener("error", () => conn.close());
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") return env.FAIR.getByName("fiera-2026").fetch(request);
    if (url.pathname === "/health") return Response.json({ ok: true, where: "cloudflare" });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
