/**
 * Temi dei livelli: ogni ondata cambia cielo, nebulosa, pianeta, colore degli asteroidi
 * e musica. Le ondate del boss hanno un tema "allarme" tutto loro.
 */

export type MusicTrack = "lobby" | "w1" | "w2" | "w3" | "w4" | "w5" | "boss";
export type PlanetName = "mars" | "jupiter" | "neptune" | "moon" | "venus" | "uranus";

export interface Theme {
  name: string;
  /** Colore che moltiplica la foto della Via Lattea. */
  tint: number;
  /** I due colori della nebulosa e quanto si vede (0..1). */
  nebA: number;
  nebB: number;
  neb: number;
  /** Pianeta sullo sfondo e da che parte sta (azimut, elevazione in radianti). */
  planet: PlanetName | null;
  planetAt: [number, number];
  /** Colore che tinge gli asteroidi (moltiplica il loro colore originale). */
  rock: number;
  /** Colore della polvere spaziale. */
  dust: number;
  music: MusicTrack;
}

export const THEMES: Theme[] = [
  { name: "Via Lattea", tint: 0xffffff, nebA: 0x3df2ff, nebB: 0x2a3cff, neb: 0.12, planet: "mars", planetAt: [-0.7, 0.18], rock: 0xffffff, dust: 0x3df2ff, music: "w1" },
  { name: "Nebulosa di fuoco", tint: 0xffd2b0, nebA: 0xff3d7f, nebB: 0xffa22d, neb: 0.62, planet: "jupiter", planetAt: [0.75, 0.22], rock: 0xc89070, dust: 0xffb347, music: "w2" },
  { name: "Mari di ghiaccio", tint: 0xc8e8ff, nebA: 0x3df2ff, nebB: 0x2a5cff, neb: 0.55, planet: "neptune", planetAt: [-0.55, 0.3], rock: 0xa8c8e8, dust: 0xbfe7ff, music: "w3" },
  { name: "Giungla verde", tint: 0xd0ffd0, nebA: 0x7cff4d, nebB: 0x0b8b6c, neb: 0.5, planet: "uranus", planetAt: [0.6, 0.12], rock: 0xa8c098, dust: 0x7cff4d, music: "w4" },
  { name: "Vortice viola", tint: 0xe8d0ff, nebA: 0xb04dff, nebB: 0xff3dd2, neb: 0.6, planet: "venus", planetAt: [-0.8, 0.25], rock: 0xb8a0d0, dust: 0xff3dd2, music: "w5" },
];

export const BOSS_THEME: Theme = {
  name: "Allarme rosso",
  tint: 0xff9090,
  nebA: 0xff1030,
  nebB: 0x500018,
  neb: 0.8,
  planet: "moon",
  planetAt: [0.15, 0.35],
  rock: 0xb06060,
  dust: 0xff3d7f,
  music: "boss",
};

/** Tema di un'ondata: i boss (ogni 4 ondate) hanno il loro, le altre girano in ciclo. */
export function themeFor(wave: number, bossEvery = 4): Theme {
  if (wave % bossEvery === 0) return BOSS_THEME;
  const normal = wave - Math.floor(wave / bossEvery) - 1;
  return THEMES[normal % THEMES.length]!;
}
