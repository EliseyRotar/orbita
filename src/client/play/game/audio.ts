/**
 * Audio del gioco: effetti dei pacchetti Kenney "Sci-fi Sounds" e "Interface Sounds" (CC0)
 * e due brani CC0 da OpenGameArt. Gli effetti sono decodificati in memoria (WebAudio),
 * la musica è in streaming (HTMLAudioElement) per non occupare RAM sull'HoloLens.
 */

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
} as const;

type SfxName = keyof typeof SFX;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private music: HTMLAudioElement | null = null;
  private musicTrack: "lobby" | "game" | null = null;
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
          const res = await fetch(`/media/sfx/${n}.ogg`);
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

  /** Musica: "lobby" in attesa, "game" durante la partita (più veloce durante il boss). */
  setMusic(track: "lobby" | "game" | null, intense = false): void {
    if (track !== this.musicTrack) {
      this.musicTrack = track;
      this.music?.pause();
      this.music = null;
      if (track) {
        const a = new Audio(track === "game" ? "/media/music/game.mp3" : "/media/music/lobby.ogg");
        a.loop = true;
        a.volume = track === "game" ? 0.32 : 0.4;
        this.music = a;
        if (this.ctx && !this.muted) void a.play().catch(() => {});
      }
    }
    if (this.music) this.music.playbackRate = intense ? 1.08 : 1;
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
