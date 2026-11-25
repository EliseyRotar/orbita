import { DIFFICULTY_PRESETS, type Difficulty } from "../../../shared/protocol.ts";

/**
 * Regole di gioco pure (senza three.js), così si possono testare e bilanciare facilmente.
 * Le distanze sono in "unità di gioco": vengono moltiplicate per la scala della modalità
 * (1 su PC/VR, più piccola in AR perché si gioca dentro una stanza vera).
 *
 * Ogni regola riceve la difficoltà scelta dall'operatore (moltiplicatori, 1 = normale).
 * La base "normale" è già impegnativa dalla seconda ondata: in fiera le partite devono
 * durare pochi minuti.
 */

export type RockKind = "small" | "medium" | "large" | "gold";

export const ROCK = {
  small: { radius: 0.85, hp: 1, points: 10, speed: 1.25 },
  medium: { radius: 1.15, hp: 2, points: 25, speed: 1.0 },
  large: { radius: 1.8, hp: 4, points: 50, speed: 0.78 },
  gold: { radius: 0.95, hp: 2, points: 100, speed: 1.1 },
} as const satisfies Record<RockKind, { radius: number; hp: number; points: number; speed: number }>;

export const NORMAL: Difficulty = DIFFICULTY_PRESETS.normale;

export const START_LIVES = 3;
export const MAX_LIVES = 4;
export const WAVE_SECONDS = 18;
export const BOSS_EVERY = 3;
export const COMBO_WINDOW = 3;
export const FIRE_INTERVAL = 0.16;
export const SPAWN_DISTANCE = 30;
export const HIT_RADIUS = 1.25;
export const BOLT_SPEED = 75;

/** Quanto è "avanti" la partita: l'ondata, accelerata o rallentata dalla difficoltà. */
const level = (wave: number, d: Difficulty) => (wave - 1) * d.ramp;

export function isBossWave(wave: number): boolean {
  return wave % BOSS_EVERY === 0;
}

export function spawnInterval(wave: number, d: Difficulty = NORMAL): number {
  return Math.max(0.3, 1.5 - 0.15 * level(wave, d)) / d.spawn;
}

export function rockSpeed(wave: number, d: Difficulty = NORMAL): number {
  return Math.min(14, 3.8 + 0.85 * level(wave, d)) * d.speed;
}

export function maxRocks(wave: number, d: Difficulty = NORMAL): number {
  return Math.min(26, Math.round((6 + 2 * (1 + level(wave, d))) * d.spawn));
}

export function bossHp(index: number, d: Difficulty = NORMAL): number {
  return Math.round((70 + 35 * index) * d.bossHp);
}

export function bossReward(index: number): number {
  return 600 * (index + 1);
}

/** Ogni quanto il boss lancia mine (secondi). */
export function mineInterval(index: number, d: Difficulty = NORMAL): number {
  return Math.max(0.5, 1.5 - 0.25 * index) / Math.sqrt(d.enemies);
}

/** Velocità dei proiettili nemici (mine/plasma). */
export function mineSpeed(wave: number, d: Difficulty = NORMAL): number {
  return Math.min(13, 7 + 0.4 * level(wave, d)) * d.speed;
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
  return wave < 2 ? 0.04 : 0.06;
}

/** Scelta del tipo di asteroide in base all'ondata: all'inizio quasi solo piccoli. */
export function pickRock(wave: number, rnd: () => number = Math.random, d: Difficulty = NORMAL): RockKind {
  if (rnd() < goldChance(wave)) return "gold";
  const r = rnd();
  const large = Math.min(0.35, 0.08 * level(wave, d));
  const medium = Math.min(0.45, 0.22 + 0.06 * level(wave, d));
  if (r < large) return "large";
  if (r < large + medium) return "medium";
  return "small";
}

/** Navicelle nemiche: una già alla prima ondata (a difficoltà alta), poi sempre di più. */
export const ENEMY = { radius: 2.1, hp: 3, points: 75 } as const;

export function maxEnemies(wave: number, d: Difficulty = NORMAL): number {
  if (wave < 2 && d.enemies < 1.3) return 0;
  return Math.min(6, Math.round((1 + Math.floor(wave / 2)) * d.enemies));
}

export function enemyChance(wave: number, d: Difficulty = NORMAL): number {
  return Math.min(0.5, (0.18 + 0.05 * wave) * d.enemies);
}

export function enemyFireInterval(wave: number, d: Difficulty = NORMAL): number {
  return Math.max(0.8, 2.6 - 0.15 * level(wave, d)) / d.enemies;
}
