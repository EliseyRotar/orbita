import * as THREE from "three";
import type { VisualStyle } from "../../../shared/protocol.ts";
import { tint } from "../../common/assets.ts";
import { C } from "./palette.ts";

export type SkinRole = "rock" | "gold" | "enemy" | "boss";

/** Colore di ogni tipo di minaccia: si riconoscono a colpo d'occhio anche da lontano. */
const ROLE_COLOR: Record<SkinRole, number> = {
  rock: C.yellow,
  gold: C.green,
  enemy: C.pink,
  boss: C.pink,
};

const HOLO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying float vY;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  vY = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * mv;
}`;

const HOLO_FRAG = /* glsl */ `
uniform vec3 color;
uniform float time;
uniform float density;
varying vec3 vNormal;
varying vec3 vView;
varying float vY;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
  float scan = 0.55 + 0.45 * step(0.5, fract(vY * density - time * 1.8));
  float flicker = 0.92 + 0.08 * sin(time * 37.0 + vY * 3.0);
  float a = (0.12 + rim * 1.25) * scan * flicker;
  gl_FragColor = vec4(color * (0.5 + rim * 1.8), a);
}`;

/** Texture "bagliore" (sfumatura radiale) per sprite additivi: finto bloom, leggerissimo. */
let glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/**
 * Veste asteroidi, navicelle e boss nello stile scelto (dal pannello operatore o per prova
 * con ?style=neon|realistico|ologramma). Materiali e geometrie sono condivisi: costa poco.
 */
export class Skinner {
  readonly holoTime = { value: 0 };
  private edgeCache = new Map<string, THREE.EdgesGeometry>();
  private lineMats = new Map<number, THREE.LineBasicMaterial>();
  private holoMats = new Map<number, THREE.ShaderMaterial>();
  private glowMats = new Map<number, THREE.SpriteMaterial>();
  private darkMat = new THREE.MeshBasicMaterial({ color: 0x07070c });

  constructor(
    readonly style: VisualStyle,
    private readonly scale: number,
  ) {}

  update(dt: number): void {
    this.holoTime.value += dt;
  }

  /** Applica lo stile a un oggetto appena creato. `tintColor` vale per lo stile realistico. */
  skin(obj: THREE.Object3D, role: SkinRole, tintColor = 0xffffff): void {
    if (this.style === "realistico") {
      if (role === "rock") tint(obj, tintColor);
      if (role === "enemy" || role === "boss") this.addEngine(obj, role === "boss" ? 1.8 : 1);
      return;
    }
    const color = ROLE_COLOR[role];
    const meshes: THREE.Mesh[] = [];
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const m of meshes) {
      if (this.style === "neon") {
        m.material = this.darkMat;
        const edges = new THREE.LineSegments(this.edges(m.geometry), this.lineMat(color));
        edges.raycast = () => {};
        m.add(edges);
      } else {
        m.material = this.holoMat(color);
      }
    }
    if (role === "enemy" || role === "boss") this.addEngine(obj, role === "boss" ? 1.8 : 1);
  }

  /** Sprite luminoso (per plasma, motori, colpi). Dimensione in unità di gioco. */
  glow(color: number, size: number): THREE.Sprite {
    const sp = new THREE.Sprite(this.glowMat(color));
    sp.scale.setScalar(size * this.scale);
    sp.raycast = () => {};
    return sp;
  }

  /** Fiamma del motore dietro alle navicelle (sprite che sfarfalla). */
  private addEngine(obj: THREE.Object3D, size: number): void {
    const flame = this.glow(this.style === "realistico" ? 0xff9a3d : C.cyan, 0.9 * size);
    // i modelli Kenney hanno il muso verso -Z: il motore sta dietro, verso +Z (in unità del modello)
    flame.position.set(0, 0.1, 0.9);
    (obj.children[0] ?? obj).add(flame);
    // dimensione in unità del modello (il genitore è già scalato); sfarfalla a ogni disegno
    const base = 0.9 * size;
    flame.scale.setScalar(base);
    flame.onBeforeRender = () => flame.scale.setScalar(base * (0.8 + Math.random() * 0.4));
  }

  private edges(g: THREE.BufferGeometry): THREE.EdgesGeometry {
    let e = this.edgeCache.get(g.uuid);
    if (!e) {
      e = new THREE.EdgesGeometry(g, 28);
      this.edgeCache.set(g.uuid, e);
    }
    return e;
  }

  private lineMat(color: number): THREE.LineBasicMaterial {
    let m = this.lineMats.get(color);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color });
      this.lineMats.set(color, m);
    }
    return m;
  }

  private holoMat(color: number): THREE.ShaderMaterial {
    let m = this.holoMats.get(color);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(color) }, time: this.holoTime, density: { value: 9 / this.scale } },
        vertexShader: HOLO_VERT,
        fragmentShader: HOLO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.holoMats.set(color, m);
    }
    return m;
  }

  private glowMat(color: number): THREE.SpriteMaterial {
    let m = this.glowMats.get(color);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.glowMats.set(color, m);
    }
    return m;
  }
}
