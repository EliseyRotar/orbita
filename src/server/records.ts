import type { GameRecord, GameStats, Platform, Settings, Totals } from "../shared/protocol.ts";

/** Giorno corrente (YYYY-MM-DD) nel fuso orario della fiera. */
export function fairDay(at = Date.now()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(at);
}

export type NewGame = GameStats & { player: string; platform: Platform; deviceLabel: string };

/**
 * Archivio delle partite in memoria con tutte le query della classifica.
 * Non sa dove vengono salvati i dati: lo decidono le sottoclassi
 * (file JSON sul portatile, SQLite nel Durable Object su Cloudflare).
 */
export class Records {
  protected games: GameRecord[] = [];

  all(): readonly GameRecord[] {
    return this.games;
  }

  add(input: NewGame): GameRecord {
    const endedAt = Date.now();
    const rec: GameRecord = { ...input, id: crypto.randomUUID(), endedAt, day: fairDay(endedAt) };
    this.games.push(rec);
    this.saved(rec, "add");
    return rec;
  }

  remove(id: string): boolean {
    const rec = this.games.find((g) => g.id === id);
    if (!rec) return false;
    this.games = this.games.filter((g) => g.id !== id);
    this.saved(rec, "remove");
    return true;
  }

  rename(id: string, player: string): boolean {
    const g = this.games.find((x) => x.id === id);
    if (!g) return false;
    g.player = player;
    this.saved(g, "rename");
    return true;
  }

  leaderboard(day: string | null, limit: number): GameRecord[] {
    return this.games
      .filter((g) => day === null || g.day === day)
      .sort((a, b) => b.score - a.score || a.endedAt - b.endedAt)
      .slice(0, limit);
  }

  /** Classifica con una sola riga per giocatore (la sua partita migliore). */
  bestPerPlayer(day: string | null, limit: number): GameRecord[] {
    const best = new Map<string, GameRecord>();
    for (const g of this.games) {
      if (day !== null && g.day !== day) continue;
      const key = g.player.trim().toLowerCase();
      const cur = best.get(key);
      if (!cur || g.score > cur.score || (g.score === cur.score && g.endedAt < cur.endedAt)) best.set(key, g);
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.endedAt - b.endedAt).slice(0, limit);
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
    const t: Totals = { games: 0, kills: 0, enemies: 0, shots: 0, hits: 0, bosses: 0, playMs: 0, bestByPlatform: {} };
    for (const g of this.games) {
      if (day !== null && g.day !== day) continue;
      t.games++;
      t.kills += g.kills;
      t.enemies += g.enemies ?? 0;
      t.shots += g.shots;
      t.hits += g.hits;
      t.bosses += g.bosses;
      t.playMs += g.durationMs;
      const best = t.bestByPlatform[g.platform];
      if (!best || g.score > best.score) t.bestByPlatform[g.platform] = { player: g.player, score: g.score };
    }
    return t;
  }

  protected storedSettings: Partial<Settings> = {};

  loadSettings(): Partial<Settings> {
    return this.storedSettings;
  }

  saveSettings(s: Settings): void {
    this.storedSettings = s;
    this.settingsSaved(s);
  }

  protected settingsSaved(_s: Settings): void {}

  /** Chiamato dopo ogni modifica: le sottoclassi salvano. */
  protected saved(_rec: GameRecord, _op: "add" | "remove" | "rename"): void {}
}
