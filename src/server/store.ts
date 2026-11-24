import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { GameRecord, GameStats, Platform, Totals } from "../shared/protocol.ts";

interface DbShape {
  version: 1;
  games: GameRecord[];
}

/** Giorno corrente (YYYY-MM-DD) nel fuso orario della fiera. */
export function fairDay(at = Date.now()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(at);
}

/**
 * Archivio partite su file JSON. Scrittura atomica (file temporaneo + rename)
 * e con debounce, così un crash a metà fiera non corrompe la classifica.
 */
export class Store {
  private games: GameRecord[] = [];
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
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

  all(): readonly GameRecord[] {
    return this.games;
  }

  add(input: GameStats & { player: string; platform: Platform; deviceLabel: string }): GameRecord {
    const endedAt = Date.now();
    const rec: GameRecord = { ...input, id: randomUUID(), endedAt, day: fairDay(endedAt) };
    this.games.push(rec);
    this.scheduleSave();
    return rec;
  }

  remove(id: string): boolean {
    const n = this.games.length;
    this.games = this.games.filter((g) => g.id !== id);
    if (this.games.length !== n) this.scheduleSave();
    return this.games.length !== n;
  }

  rename(id: string, player: string): boolean {
    const g = this.games.find((x) => x.id === id);
    if (!g) return false;
    g.player = player;
    this.scheduleSave();
    return true;
  }

  leaderboard(day: string | null, limit: number): GameRecord[] {
    return this.games
      .filter((g) => day === null || g.day === day)
      .sort((a, b) => b.score - a.score || a.endedAt - b.endedAt)
      .slice(0, limit);
  }

  recent(limit: number): GameRecord[] {
    return this.games.slice(-limit).reverse();
  }

  /** Posizione 1-based della partita nella classifica (del giorno o assoluta). */
  rankOf(rec: GameRecord, day: string | null): number {
    let rank = 1;
    for (const g of this.games) {
      if (g.id === rec.id || (day !== null && g.day !== day)) continue;
      if (g.score > rec.score || (g.score === rec.score && g.endedAt < rec.endedAt)) rank++;
    }
    return rank;
  }

  totals(day: string | null): Totals {
    const t: Totals = { games: 0, kills: 0, shots: 0, hits: 0, bosses: 0, playMs: 0, bestByPlatform: {} };
    for (const g of this.games) {
      if (day !== null && g.day !== day) continue;
      t.games++;
      t.kills += g.kills;
      t.shots += g.shots;
      t.hits += g.hits;
      t.bosses += g.bosses;
      t.playMs += g.durationMs;
      const best = t.bestByPlatform[g.platform];
      if (!best || g.score > best.score) t.bestByPlatform[g.platform] = { player: g.player, score: g.score };
    }
    return t;
  }

  private scheduleSave(): void {
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
