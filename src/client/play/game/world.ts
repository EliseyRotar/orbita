import * as THREE from "three";
import { instance, type Models } from "../../common/assets.ts";
import { C } from "./palette.ts";
import { THEMES, type PlanetName, type Theme } from "./themes.ts";

/**
 * Ambiente per PC, VR e monitor spettatore:
 * - cielo: la Via Lattea vera (mappa stellare NASA, pubblico dominio) + una nebulosa colorata
 *   che cambia a ogni livello;
 * - un pianeta sullo sfondo (texture Solar System Scope, CC BY 4.0);
 * - la piattaforma della stazione sotto i piedi (Kenney, CC0).
 * In AR (HoloLens) non si disegna: si vede la stanza vera.
 */

const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D nebMap;
uniform vec3 tint;
uniform vec3 nebA;
uniform vec3 nebB;
uniform float neb;
uniform float bright;
uniform float time;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(map, vUv).rgb * tint * bright;
  vec4 n = texture2D(nebMap, vec2(vUv.x + time * 0.004, vUv.y));
  vec3 cloud = mix(nebA, nebB, n.g) * pow(n.r, 1.7) * neb * 1.6;
  gl_FragColor = vec4(base + cloud, 1.0);
  #include <colorspace_fragment>
}`;

let nebulaCache: THREE.DataTexture | null = null;
/** La nebulosa si calcola una sola volta: ricalcolarla a ogni ingresso in VR bloccava il Quest. */
function nebulaTexture(): THREE.DataTexture {
  return (nebulaCache ??= makeNebulaTexture());
}

/** Rumore "a nuvola" calcolato una volta in una texture equirettangolare (senza cuciture). */
function makeNebulaTexture(): THREE.DataTexture {
  const W = 512;
  const H = 256;
  const data = new Uint8Array(W * H * 4);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!;
  const hash = (x: number, y: number, z: number) => perm[(perm[(perm[x & 255]! + y) & 255]! + z) & 255]! / 255;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
    return l(
      l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
      l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
      zf,
    );
  };
  const fbm = (x: number, y: number, z: number) => {
    let v = 0, a = 0.5, f = 1;
    for (let o = 0; o < 5; o++) {
      v += a * noise(x * f, y * f, z * f);
      a *= 0.5;
      f *= 2.1;
    }
    return v;
  };
  for (let j = 0; j < H; j++) {
    const theta = (j / (H - 1)) * Math.PI;
    for (let i = 0; i < W; i++) {
      const phi = (i / W) * Math.PI * 2;
      const x = Math.sin(theta) * Math.cos(phi) * 2.2 + 10;
      const y = Math.cos(theta) * 2.2 + 10;
      const z = Math.sin(theta) * Math.sin(phi) * 2.2 + 10;
      const d = fbm(x, y, z);
      const mask = Math.max(0, Math.min(1, (d - 0.42) * 2.6));
      const mix = fbm(x + 31.7, y + 7.3, z + 3.1);
      const o = (j * W + i) * 4;
      data[o] = mask * 255;
      data[o + 1] = mix * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const planetTextures = new Map<PlanetName, THREE.Texture>();
function planetTexture(name: PlanetName): THREE.Texture {
  let t = planetTextures.get(name);
  if (!t) {
    t = new THREE.TextureLoader().load(`/media/planets/${name}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    planetTextures.set(name, t);
  }
  return t;
}

const PLANET_DIST = 170;
const FADE = 2.8;

interface Planet {
  mesh: THREE.Mesh;
  dir: THREE.Vector3;
  out: boolean;
  t: number;
}

/** Cielo, nebulosa e pianeta, con il passaggio animato da un tema all'altro. */
export class Backdrop {
  readonly group = new THREE.Group();
  private uniforms: Record<string, THREE.IUniform>;
  private from: Theme = THEMES[0]!;
  private to: Theme = THEMES[0]!;
  private k = 1;
  private planets: Planet[] = [];
  private time = 0;
  private cA = new THREE.Color();
  private cB = new THREE.Color();

  constructor(sky: THREE.Texture | null) {
    this.uniforms = {
      map: { value: sky ?? new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) },
      nebMap: { value: nebulaTexture() },
      tint: { value: new THREE.Color(1, 1, 1) },
      nebA: { value: new THREE.Color() },
      nebB: { value: new THREE.Color() },
      neb: { value: 0 },
      bright: { value: 1 },
      time: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    // la parte più luminosa della galassia davanti al giocatore, un po' in alto
    dome.rotation.set(0.78, 0, 0.3);
    dome.renderOrder = -10;
    this.group.add(dome);
    this.setTheme(THEMES[0]!, true);
  }

  get theme(): Theme {
    return this.to;
  }

  /** Cambia tema; con `instant` salta l'animazione (all'avvio). */
  setTheme(theme: Theme, instant = false): void {
    if (theme === this.to && !instant) return;
    this.from = instant ? theme : this.to;
    this.to = theme;
    this.k = instant ? 1 : 0;
    for (const p of this.planets) {
      if (!p.out) {
        p.out = true;
        p.t = instant ? FADE : 0;
      }
    }
    if (theme.planet) {
      const [az, el] = theme.planetAt;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(30, 48, 32),
        new THREE.MeshLambertMaterial({ map: planetTexture(theme.planet), transparent: true, opacity: instant ? 1 : 0, fog: false }),
      );
      mesh.rotation.set(0.3, Math.random() * 6, 0.15);
      mesh.renderOrder = -9;
      this.group.add(mesh);
      this.planets.push({ mesh, dir, out: false, t: instant ? FADE : 0 });
    }
    if (instant) this.update(0);
  }

  update(dt: number): void {
    this.time += dt;
    this.uniforms.time!.value = this.time;
    if (this.k < 1) this.k = Math.min(1, this.k + dt / FADE);
    const k = this.k * this.k * (3 - 2 * this.k);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    const col = (u: string, a: number, b: number) =>
      (this.uniforms[u]!.value as THREE.Color).copy(this.cA.setHex(a)).lerp(this.cB.setHex(b), k);
    col("tint", this.from.tint, this.to.tint);
    col("nebA", this.from.nebA, this.to.nebA);
    col("nebB", this.from.nebB, this.to.nebB);
    this.uniforms.neb!.value = lerp(this.from.neb, this.to.neb);
    // lampo di "salto nell'iperspazio" a metà transizione
    const warp = this.k < 1 ? Math.sin(Math.PI * this.k) : 0;
    const pulse = this.to.music === "boss" ? 0.12 * Math.sin(this.time * 4) : 0;
    this.uniforms.bright!.value = 1 + warp * 0.9 + pulse;

    for (let i = this.planets.length - 1; i >= 0; i--) {
      const p = this.planets[i]!;
      p.t = Math.min(FADE, p.t + dt);
      const pk = p.t / FADE;
      const mat = p.mesh.material as THREE.MeshLambertMaterial;
      if (p.out) {
        mat.opacity = 1 - pk;
        p.mesh.position.copy(p.dir).multiplyScalar(PLANET_DIST + 90 * pk * pk);
        if (pk >= 1) {
          this.group.remove(p.mesh);
          p.mesh.geometry.dispose();
          mat.dispose();
          this.planets.splice(i, 1);
          continue;
        }
      } else {
        mat.opacity = pk;
        p.mesh.position.copy(p.dir).multiplyScalar(PLANET_DIST + 70 * (1 - pk) * (1 - pk));
      }
      p.mesh.rotation.y += dt * 0.01;
    }
  }

  /** Quanto è intenso il salto (0..1), per accelerare la polvere spaziale. */
  get warp(): number {
    return this.k < 1 ? Math.sin(Math.PI * this.k) : 0;
  }
}

export interface Environment {
  group: THREE.Group;
  backdrop: Backdrop;
}

export function buildEnvironment(sky: THREE.Texture | null, models: Models | null): Environment {
  const group = new THREE.Group();
  const backdrop = new Backdrop(sky);
  group.add(backdrop.group);

  if (models) {
    const deck = instance(models, "deck");
    deck.scale.setScalar(2.4);
    group.add(deck);
    const dish = instance(models, "dish");
    dish.scale.setScalar(0.7);
    dish.position.set(1.4, 0.05, 0.9);
    dish.rotation.y = -2.4;
    group.add(dish);
  }

  // anello luminoso a terra: fa capire dove stare con il visore
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.6, 48),
    new THREE.MeshBasicMaterial({ color: C.cyan, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);

  return { group, backdrop };
}

export function addLights(scene: THREE.Scene, ar: boolean): void {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, ar ? 0x9a8a80 : 0x251a2e, ar ? 2.4 : 1.6));
  const sun = new THREE.DirectionalLight(0xfff0dc, ar ? 2.2 : 2.8);
  sun.position.set(4, 6, 3);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fb8ff, 1.1);
  rim.position.set(-5, 2, -6);
  scene.add(rim);
}
