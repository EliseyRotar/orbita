import type { ClientMsg, HelloMsg, ServerMsg } from "../../shared/protocol.ts";

type Listener = (msg: ServerMsg) => void;
type StatusListener = (online: boolean) => void;

/**
 * WebSocket con riconnessione automatica: se l'hotspot cade per qualche secondo
 * la postazione si ricollega da sola e ripete il saluto iniziale.
 */
export class Link {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retry = 0;
  online = false;

  constructor(private hello: () => HelloMsg) {
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify(this.hello()));
      this.setOnline(true);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      this.setOnline(false);
      const wait = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }

  private setOnline(v: boolean): void {
    if (this.online === v) return;
    this.online = v;
    for (const l of this.statusListeners) l(v);
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Ripete il saluto (es. dopo aver cambiato nome o PIN). */
  rehello(): void {
    this.send(this.hello());
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: StatusListener): void {
    this.statusListeners.add(l);
    l(this.online);
  }
}
