/**
 * Audio del gioco: effetti dei pacchetti Kenney "Sci-fi Sounds" e "Interface Sounds" (CC0)
 * e due brani CC0 da OpenGameArt. Gli effetti sono decodificati in memoria (WebAudio),
 * la musica è in streaming (HTMLAudioElement) per non occupare RAM sull'HoloLens.
 */

import type { MusicTrack } from "./themes.ts";

const SFX = {
  shoot: ["laserSmall_000", "laserSmall_001", "laserSmall_002"],
  enemyShoot: ["laserRetro_002"],
  hit: ["impactMetal_001", "impactMetal_003"],
  explode: ["explosionCrunch_000", "explosionCrunch_001", "explosionCrunch_002"],
  bigExplode: ["lowFrequency_explosion_000"],
  shield: ["forceField_001"],
  power: ["confirmation_002"],
  combo: ["maximize_006"],
  damage: ["error_006"],
  start: ["select_005"],
  alarm: ["glitch_003"],
  jingleWave: ["jingle_wave"],
  jingleOver: ["jingle_over"],
  jingleRecord: ["jingle_record"],
} as const;

type SfxName = keyof typeof SFX;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private music: HTMLAudioElement | null = null;
  private musicTrack: MusicTrack | null = null;
  private loading: Promise<void> | null = null;
  muted = false;

  /** Va chiamato dentro un gesto dell'utente (click, tap, grilletto). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.loading = this.loadAll();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.music?.paused && !this.muted) void this.music.play().catch(() => {});
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx!;
    const names = new Set(Object.values(SFX).flat());
    await Promise.all(
      [...names].map(async (n) => {
        try {
          // MP3: l'unico formato che suona ovunque, iPhone compresi
          const res = await fetch(`/media/sfx/${n}.mp3`);
          this.buffers.set(n, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* un suono mancante non deve bloccare il gioco */
        }
      }),
    );
  }

  private play(name: SfxName, vol = 1, rate = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    const list = SFX[name];
    const buf = this.buffers.get(list[Math.floor(Math.random() * list.length)]!);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
  }

  shoot(): void {
    this.play("shoot", 0.35);
  }
  enemyShoot(): void {
    this.play("enemyShoot", 0.35);
  }
  hit(): void {
    this.play("hit", 0.45);
  }
  explode(big = false): void {
    if (big) this.play("bigExplode", 1);
    else this.play("explode", 0.6);
  }
  damage(): void {
    this.play("damage", 0.8);
    this.play("bigExplode", 0.6, 1.4);
  }
  power(): void {
    this.play("power", 0.8);
    this.play("shield", 0.4, 1.3);
  }
  shieldHit(): void {
    this.play("shield", 0.7);
  }
  combo(level: number): void {
    this.play("combo", 0.6, 0.9 + level * 0.08);
  }
  bossAlarm(): void {
    this.play("alarm", 0.8);
    setTimeout(() => this.play("alarm", 0.8), 450);
  }
  start(): void {
    this.play("start", 0.8);
  }
  over(): void {
    this.play("damage", 0.8, 0.7);
  }

  /**
   * Musica: un brano per livello (vedi themes.ts), "lobby" in attesa.
   * Il cambio è in dissolvenza: il brano vecchio si abbassa mentre sale il nuovo.
   */
  setMusic(track: MusicTrack | null): void {
    if (track === this.musicTrack) return;
    this.musicTrack = track;
    const old = this.music;
    if (old) this.fade(old, 0, 900, () => old.pause());
    this.music = null;
    if (!track) return;
    const a = new Audio(`/media/music/${track}.mp3`);
    a.loop = true;
    a.volume = 0;
    this.music = a;
    if (this.ctx && !this.muted) void a.play().catch(() => {});
    this.fade(a, track === "lobby" ? 0.4 : 0.34, 1200);
  }

  private fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    const from = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      try {
        a.volume = from + (to - from) * k;
      } catch {
        /* iOS non permette di cambiare il volume: pazienza */
      }
      if (k < 1) requestAnimationFrame(step);
      else done?.();
    };
    requestAnimationFrame(step);
  }

  /** Jingle 8-bit (Kenney "Music Jingles", CC0). */
  jingle(name: "wave" | "over" | "record"): void {
    this.play(name === "wave" ? "jingleWave" : name === "over" ? "jingleOver" : "jingleRecord", 0.7);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.music) {
      if (this.muted) this.music.pause();
      else void this.music.play().catch(() => {});
    }
  }

  get ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }
}
