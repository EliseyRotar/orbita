import * as THREE from "three";
import { C } from "./palette.ts";

/**
 * Ambiente per PC e VR: cielo stellato, un pianeta lontano e la piattaforma
 * della stazione sotto i piedi (in VR dà un riferimento e riduce il mal di movimento).
 * In AR (HoloLens) non si disegna: si vede la stanza vera.
 */
export function buildEnvironment(): THREE.Group {
  const env = new THREE.Group();

  // stelle
  const n = 1800;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const R = 160 + Math.random() * 40;
    pos.set([r * Math.cos(th) * R, u * R, r * Math.sin(th) * R], i * 3);
    c.setHex([C.paper, C.ice, C.signal, C.coral][Math.random() < 0.8 ? 0 : (1 + Math.floor(Math.random() * 3))]!);
    const k = 0.4 + Math.random() * 0.6;
    col.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  env.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, sizeAttenuation: true, depthWrite: false })));

  // pianeta con anello
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(34, 48, 32),
    new THREE.MeshLambertMaterial({ color: C.coral, emissive: 0x3a0f2a }),
  );
  planet.position.set(-70, 18, -140);
  env.add(planet);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(44, 62, 96),
    new THREE.MeshBasicMaterial({ color: C.signal, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.position.copy(planet.position);
  ring.rotation.set(1.25, 0.2, 0.3);
  env.add(ring);

  // piattaforma della stazione
  const deck = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 48),
    new THREE.MeshLambertMaterial({ color: C.ultramarine, emissive: 0x070c2c }),
  );
  floor.rotation.x = -Math.PI / 2;
  deck.add(floor);
  for (const [r, w, color] of [[2.2, 0.06, C.signal], [1.4, 0.025, C.ice], [0.6, 0.025, C.ice]] as const) {
    const line = new THREE.Mesh(
      new THREE.RingGeometry(r - w, r, 64),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.005;
    deck.add(line);
  }
  env.add(deck);

  return env;
}

export function addLights(scene: THREE.Scene, ar: boolean): void {
  scene.add(new THREE.HemisphereLight(C.ice, ar ? 0x8899cc : C.deep, ar ? 1.6 : 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, ar ? 1.6 : 2.2);
  sun.position.set(4, 6, 3);
  scene.add(sun);
}
