import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GameRecord } from "../shared/protocol.ts";
import { Records } from "./records.ts";

export { fairDay } from "./records.ts";

interface DbShape {
  version: 1;
  games: GameRecord[];
}

/**
 * Archivio partite su file JSON per il server locale (piano B senza internet).
 * Scrittura atomica (file temporaneo + rename) e con debounce, così un crash
 * a metà fiera non corrompe la classifica.
 */
export class Store extends Records {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {
    super();
    if (existsSync(file)) {
      try {
        const db = JSON.parse(readFileSync(file, "utf8")) as DbShape;
        this.games = Array.isArray(db.games) ? db.games : [];
      } catch (err) {
        const backup = `${file}.broken-${Date.now()}`;
        renameSync(file, backup);
        console.warn(`[store] file dati illeggibile, spostato in ${backup}`, err);
      }
    }
  }

  protected override saved(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 250);
  }

  flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const db: DbShape = { version: 1, games: this.games };
    writeFileSync(tmp, JSON.stringify(db, null, 1));
    renameSync(tmp, this.file);
  }
}
