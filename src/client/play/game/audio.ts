/**
 * Effetti sonori sintetizzati con WebAudio: nessun file da scaricare,
 * funziona offline e dentro le sessioni WebXR.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Va chiamato dentro un gesto dell'utente (click, tap, grilletto). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(freq: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  shoot(): void {
    this.tone(1400, 380, 0.09, "square", 0.05);
  }
  hit(): void {
    this.tone(520, 260, 0.06, "triangle", 0.12);
  }
  explode(big = false): void {
    this.burst(big ? 0.9 : 0.35, big ? 0.7 : 0.35, big ? 2200 : 3200);
  }
  damage(): void {
    this.tone(180, 50, 0.5, "sawtooth", 0.25);
    this.burst(0.4, 0.4, 900);
  }
  power(): void {
    [0, 0.07, 0.14].forEach((d, i) => this.tone(660 * (1 + i * 0.26), 990 * (1 + i * 0.26), 0.12, "sine", 0.18, d));
  }
  combo(level: number): void {
    this.tone(440 + level * 110, 880 + level * 110, 0.15, "triangle", 0.15);
  }
  bossAlarm(): void {
    for (let i = 0; i < 3; i++) this.tone(300, 600, 0.25, "sawtooth", 0.12, i * 0.35);
  }
  start(): void {
    [0, 0.1, 0.2].forEach((d, i) => this.tone(392 * 2 ** (i * 4 / 12), 392 * 2 ** (i * 4 / 12), 0.14, "square", 0.08, d));
  }
  over(): void {
    [0, 0.18, 0.36].forEach((d, i) => this.tone(330 / (1 + i * 0.2), 220 / (1 + i * 0.2), 0.3, "triangle", 0.15, d));
  }
}
