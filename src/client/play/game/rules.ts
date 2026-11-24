/**
 * Regole di gioco pure (senza three.js), così si possono testare e bilanciare facilmente.
 * Le distanze sono in "unità di gioco": vengono moltiplicate per la scala della modalità
 * (1 su PC/VR, più piccola in AR perché si gioca dentro una stanza vera).
 */

export type RockKind = "small" | "medium" | "large" | "gold";

export const ROCK = {
  small: { radius: 0.85, hp: 1, points: 10, speed: 1.25 },
  medium: { radius: 1.15, hp: 2, points: 25, speed: 1.0 },
  large: { radius: 1.8, hp: 4, points: 50, speed: 0.78 },
  gold: { radius: 0.95, hp: 2, points: 100, speed: 1.1 },
} as const satisfies Record<RockKind, { radius: number; hp: number; points: number; speed: number }>;

export const START_LIVES = 3;
export const MAX_LIVES = 5;
export const WAVE_SECONDS = 22;
export const BOSS_EVERY = 4;
export const COMBO_WINDOW = 3;
export const FIRE_INTERVAL = 0.16;
export const SPAWN_DISTANCE = 30;
export const HIT_RADIUS = 1.25;
export const BOLT_SPEED = 75;

export function isBossWave(wave: number): boolean {
  return wave % BOSS_EVERY === 0;
}

export function spawnInterval(wave: number): number {
  return Math.max(0.42, 1.9 - 0.14 * (wave - 1));
}

export function rockSpeed(wave: number): number {
  return 3.2 + 0.6 * (wave - 1);
}

export function maxRocks(wave: number): number {
  return 6 + wave;
}

export function bossHp(index: number): number {
  return 28 + 14 * index;
}

export function bossReward(index: number): number {
  return 500 * (index + 1);
}

export function mineInterval(index: number): number {
  return Math.max(1.0, 2.3 - 0.3 * index);
}

/** Moltiplicatore combo: sale di 1 ogni 4 distruzioni consecutive, massimo x5. */
export function comboLevel(streak: number): number {
  return Math.min(5, 1 + Math.floor(streak / 4));
}

export function pointsFor(base: number, streak: number, double: boolean): number {
  return base * comboLevel(streak) * (double ? 2 : 1);
}

/** Probabilità di asteroide dorato (porta un potenziamento). */
export function goldChance(wave: number): number {
  return wave < 2 ? 0.04 : 0.07;
}

/** Scelta del tipo di asteroide in base all'ondata: all'inizio quasi solo piccoli. */
export function pickRock(wave: number, rnd: () => number = Math.random): RockKind {
  if (rnd() < goldChance(wave)) return "gold";
  const r = rnd();
  const large = Math.min(0.3, 0.05 * (wave - 1));
  const medium = Math.min(0.45, 0.2 + 0.05 * wave);
  if (r < large) return "large";
  if (r < large + medium) return "medium";
  return "small";
}
