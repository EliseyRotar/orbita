import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fairDay, Store } from "../src/server/store.ts";

const base = { kills: 1, enemies: 0, shots: 2, hits: 1, maxCombo: 1, bosses: 0, wave: 1, durationMs: 1000, platform: "vr" as const, deviceLabel: "Quest" };

describe("archivio partite", () => {
  it("ordina la classifica e calcola la posizione", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "orbita-")), "g.json"));
    const a = s.add({ ...base, player: "Anna", score: 300 });
    const b = s.add({ ...base, player: "Bruno", score: 500 });
    const c = s.add({ ...base, player: "Carla", score: 100 });
    expect(s.leaderboard(null, 10).map((g) => g.player)).toEqual(["Bruno", "Anna", "Carla"]);
    expect(s.rankOf(a, null)).toBe(2);
    expect(s.rankOf(b, a.day)).toBe(1);
    expect(s.rankOf(c, null)).toBe(3);
  });

  it("somma i totali e il migliore per dispositivo", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "orbita-")), "g.json"));
    s.add({ ...base, player: "Anna", score: 300 });
    s.add({ ...base, player: "Dario", score: 700, platform: "ar" });
    const t = s.totals(fairDay());
    expect(t.games).toBe(2);
    expect(t.kills).toBe(2);
    expect(t.bestByPlatform.ar?.player).toBe("Dario");
  });

  it("salva su file e ricarica", () => {
    const file = join(mkdtempSync(join(tmpdir(), "orbita-")), "g.json");
    const s = new Store(file);
    const g = s.add({ ...base, player: "Elia", score: 42 });
    s.rename(g.id, "Elia R.");
    s.flush();
    expect(JSON.parse(readFileSync(file, "utf8")).games[0].player).toBe("Elia R.");
    expect(new Store(file).all()).toHaveLength(1);
  });
});
