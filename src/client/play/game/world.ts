import * as THREE from "three";
import { instance, type Models } from "../../common/assets.ts";
import { C } from "./palette.ts";

/**
 * Ambiente per PC, VR e monitor spettatore: la Via Lattea vera (mappa stellare NASA,
 * pubblico dominio) e la piattaforma della stazione sotto i piedi (Kenney, CC0).
 * In AR (HoloLens) non si disegna: si vede la stanza vera.
 */
export function buildEnvironment(sky: THREE.Texture | null, models: Models | null): THREE.Group {
  const env = new THREE.Group();

  if (sky) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 64, 32),
      new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    // la parte più luminosa della galassia davanti al giocatore, un po' in alto
    dome.rotation.set(0.78, 0, 0.3);
    env.add(dome);
  } else {
    env.add(starfield());
  }

  if (models) {
    const deck = instance(models, "deck");
    deck.scale.setScalar(2.4);
    env.add(deck);
    const dish = instance(models, "dish");
    dish.scale.setScalar(0.7);
    dish.position.set(1.4, 0.05, 0.9);
    dish.rotation.y = -2.4;
    env.add(dish);
  }

  // anello luminoso a terra: fa capire dove stare con il visore
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.6, 48),
    new THREE.MeshBasicMaterial({ color: C.cyan, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  env.add(ring);

  return env;
}

function starfield(): THREE.Points {
  const n = 1800;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const R = 180;
    pos.set([r * Math.cos(th) * R, u * R, r * Math.sin(th) * R], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: C.white, size: 0.8 }));
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
