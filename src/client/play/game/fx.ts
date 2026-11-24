import * as THREE from "three";

const MAX = 600;

/**
 * Esplosioni con un unico oggetto `Points` (una sola draw call):
 * importante per tenere fluido l'HoloLens 2.
 */
export class Sparks {
  readonly object: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private next = 0;
  private geo = new THREE.BufferGeometry();
  private tmp = new THREE.Color();

  constructor(size: number) {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.Points(this.geo, mat);
    this.object.frustumCulled = false;
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -9999;
  }

  burst(at: THREE.Vector3, color: number, count: number, speed: number): void {
    this.tmp.setHex(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([r * Math.cos(th) * s, u * s, r * Math.sin(th) * s], i * 3);
      const k = 0.7 + Math.random() * 0.3;
      this.col.set([this.tmp.r * k, this.tmp.g * k, this.tmp.b * k], i * 3);
      this.life[i] = 0.5 + Math.random() * 0.6;
    }
  }

  update(dt: number): void {
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < MAX; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const o = i * 3;
      if (this.life[i]! <= 0) {
        this.pos[o + 1] = -9999;
        continue;
      }
      this.vel[o]! *= drag;
      this.vel[o + 1]! *= drag;
      this.vel[o + 2]! *= drag;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      const fade = Math.min(1, this.life[i]! * 2);
      this.col[o]! *= 0.985 + 0.015 * fade;
      this.col[o + 1]! *= 0.97 + 0.03 * fade;
      this.col[o + 2]! *= 0.96 + 0.04 * fade;
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -9999;
    this.geo.attributes.position!.needsUpdate = true;
  }
}
