import type * as THREE from "three";
import type { FeedKind, GameStats } from "../../../shared/protocol.ts";

export type Mode = "desktop" | "mobile" | "vr" | "ar";
export type Phase = "lobby" | "countdown" | "playing" | "over";
export type PowerKind = "triple" | "slow" | "shield" | "life" | "double";

/** Un "puntatore" che spara: mouse, controller del Quest o mano dell'HoloLens. */
export interface Aimer {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  /** Grilletto tenuto premuto (fuoco automatico). */
  held: boolean;
  /** Premuto in questo frame. */
  pressed: boolean;
  /** Mano che spara: 0 sinistra/prima, 1 destra/seconda, -1 mouse o tocco. */
  hand: number;
}

/** Eventi da far "sentire" con la vibrazione dei controller. */
export type Feedback = "shoot" | "hit" | "kill" | "damage" | "power" | "boss";

export interface ActivePower {
  kind: PowerKind;
  /** Secondi rimanenti (0 = senza scadenza, es. scudo). */
  left: number;
  total: number;
}

export interface ResultInfo {
  stats: GameStats;
  player: string;
  rankToday: number | null;
  rankAll: number | null;
  isRecord: boolean;
}

/** Tutto ciò che serve per disegnare HUD e schermate, su DOM o su pannello 3D. */
export interface ViewModel {
  phase: Phase;
  player: string;
  nextPlayer: string | null;
  score: number;
  lives: number;
  combo: number;
  wave: number;
  countdown: number;
  powers: ActivePower[];
  toast: string | null;
  boss: { hp: number; max: number } | null;
  result: ResultInfo | null;
  /** Partita in pausa. */
  paused: boolean;
  /** In "over": secondi prima di poter ripartire (evita ripartenze accidentali). */
  lockout: number;
  online: boolean;
}

export interface GameCallbacks {
  onStart(player: string, id: string, startedAt: number): void;
  onTick(score: number, lives: number, combo: number, wave: number): void;
  onEvent(kind: FeedKind, text: string): void;
  onEnd(stats: GameStats, id: string, player: string, startedAt: number): void;
  /** La partita è stata messa in pausa o ripresa. */
  onPause?(paused: boolean): void;
  /** Partita annullata prima di iniziare (non finisce in classifica). */
  onAbort(): void;
  /** Vibrazione: hand = -1 per entrambe le mani. */
  onFeedback?(kind: Feedback, hand: number): void;
}

export const POWER_LABEL: Record<PowerKind, string> = {
  triple: "Colpo triplo",
  slow: "Tempo lento",
  shield: "Scudo",
  life: "Vita extra",
  double: "Punti doppi",
};
