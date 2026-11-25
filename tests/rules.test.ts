import { describe, expect, it } from "vitest";
import * as R from "../src/client/play/game/rules.ts";
import { DIFFICULTY_PRESETS } from "../src/shared/protocol.ts";

describe("regole di gioco", () => {
  it("la combo sale ogni 4 distruzioni e si ferma a x5", () => {
    expect(R.comboLevel(0)).toBe(1);
    expect(R.comboLevel(3)).toBe(1);
    expect(R.comboLevel(4)).toBe(2);
    expect(R.comboLevel(16)).toBe(5);
    expect(R.comboLevel(100)).toBe(5);
  });

  it("i punti tengono conto di combo e punti doppi", () => {
    expect(R.pointsFor(10, 0, false)).toBe(10);
    expect(R.pointsFor(10, 8, false)).toBe(30);
    expect(R.pointsFor(10, 8, true)).toBe(60);
  });

  it("la difficoltà cresce ma resta giocabile", () => {
    expect(R.spawnInterval(1)).toBeGreaterThan(R.spawnInterval(5));
    expect(R.spawnInterval(50)).toBeGreaterThanOrEqual(0.3);
    expect(R.rockSpeed(5)).toBeGreaterThan(R.rockSpeed(1));
  });

  it("il boss arriva ogni 3 ondate", () => {
    expect([1, 2, 3, 4, 5, 6].map(R.isBossWave)).toEqual([false, false, true, false, false, true]);
  });

  it("i nemici arrivano dalla seconda ondata, al massimo 6", () => {
    expect(R.maxEnemies(1)).toBe(0);
    expect(R.maxEnemies(2)).toBe(2);
    expect(R.maxEnemies(40)).toBe(6);
    expect(R.enemyFireInterval(50)).toBeGreaterThanOrEqual(0.8);
  });

  it("la difficoltà dell'operatore cambia davvero il gioco", () => {
    const facile = DIFFICULTY_PRESETS.facile;
    const inferno = DIFFICULTY_PRESETS.inferno;
    expect(R.rockSpeed(3, inferno)).toBeGreaterThan(R.rockSpeed(3, facile));
    expect(R.spawnInterval(3, inferno)).toBeLessThan(R.spawnInterval(3, facile));
    expect(R.bossHp(0, inferno)).toBeGreaterThan(R.bossHp(0, facile));
    expect(R.maxEnemies(1, inferno)).toBeGreaterThan(0);
  });

  it("all'inizio escono quasi solo asteroidi piccoli", () => {
    let i = 0;
    const seq = [0.5, 0.9];
    const rnd = () => seq[i++ % seq.length]!;
    expect(R.pickRock(1, rnd)).toBe("small");
  });
});
