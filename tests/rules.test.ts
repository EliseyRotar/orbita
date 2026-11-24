import { describe, expect, it } from "vitest";
import * as R from "../src/client/play/game/rules.ts";

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
    expect(R.spawnInterval(50)).toBeGreaterThanOrEqual(0.42);
    expect(R.rockSpeed(5)).toBeGreaterThan(R.rockSpeed(1));
  });

  it("il boss arriva ogni 4 ondate", () => {
    expect([1, 2, 3, 4, 5, 8].map(R.isBossWave)).toEqual([false, false, false, true, false, true]);
  });

  it("all'inizio escono quasi solo asteroidi piccoli", () => {
    let i = 0;
    const seq = [0.5, 0.9];
    const rnd = () => seq[i++ % seq.length]!;
    expect(R.pickRock(1, rnd)).toBe("small");
  });
});
