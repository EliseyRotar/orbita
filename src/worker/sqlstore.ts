import type { GameRecord, Settings } from "../shared/protocol.ts";
import { Records } from "../server/records.ts";

/**
 * Archivio partite nel database SQLite del Durable Object.
 * Le query della classifica restano in memoria (sono poche centinaia di partite):
 * SQLite serve solo a non perdere niente se Cloudflare riavvia l'oggetto.
 */
export class SqlStore extends Records {
  constructor(private readonly sql: SqlStorage) {
    super();
    sql.exec(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, data TEXT NOT NULL, ended_at INTEGER NOT NULL)`);
    this.games = sql
      .exec<{ data: string }>(`SELECT data FROM games ORDER BY ended_at`)
      .toArray()
      .map((r) => JSON.parse(r.data) as GameRecord);
    sql.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const row = sql.exec<{ value: string }>(`SELECT value FROM kv WHERE key = 'settings'`).toArray()[0];
    if (row) {
      try {
        this.storedSettings = JSON.parse(row.value) as Partial<Settings>;
      } catch {
        /* impostazioni illeggibili: si usano quelle predefinite */
      }
    }
  }

  protected override settingsSaved(s: Settings): void {
    this.sql.exec(`INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(s));
  }

  protected override saved(rec: GameRecord, op: "add" | "remove" | "rename"): void {
    if (op === "remove") {
      this.sql.exec(`DELETE FROM games WHERE id = ?`, rec.id);
    } else {
      this.sql.exec(
        `INSERT INTO games (id, data, ended_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        rec.id,
        JSON.stringify(rec),
        rec.endedAt,
      );
    }
  }
}
