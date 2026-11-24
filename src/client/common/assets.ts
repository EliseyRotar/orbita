import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Modelli 3D del Kenney Space Kit (CC0). Ogni modello viene ricentrato e
 * scalato in modo da stare in una sfera di raggio 1: chi lo usa decide la grandezza.
 */
export const MODEL_FILES = {
  meteor: "meteor_detailed.glb",
  meteorB: "meteor.glb",
  meteorHalf: "meteor_half.glb",
  crystal: "rock_crystals.glb",
  crystalA: "rock_crystalsLargeA.glb",
  crystalB: "rock_crystalsLargeB.glb",
  rock: "rock.glb",
  rockLargeA: "rock_largeA.glb",
  rockLargeB: "rock_largeB.glb",
  rocksSmallA: "rocks_smallA.glb",
  rocksSmallB: "rocks_smallB.glb",
  enemyA: "craft_speederA.glb",
  enemyB: "craft_speederB.glb",
  enemyC: "craft_speederD.glb",
  boss: "craft_miner.glb",
  gun: "weapon_gun.glb",
  deck: "platform_large.glb",
  dish: "satelliteDish_detailed.glb",
  astronaut: "astronautA.glb",
} as const;

export type ModelName = keyof typeof MODEL_FILES;
export type Models = Record<ModelName, THREE.Object3D>;

const BASE = "/media/";

function normalize(root: THREE.Object3D, keepBase = false): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const wrap = new THREE.Group();
  root.position.sub(keepBase ? new THREE.Vector3(sphere.center.x, box.min.y, sphere.center.z) : sphere.center);
  wrap.add(root);
  wrap.scale.setScalar(1 / (sphere.radius || 1));
  const holder = new THREE.Group();
  holder.add(wrap);
  return holder;
}

let modelsPromise: Promise<Models> | null = null;

/** Carica (una volta sola) tutti i modelli. */
export function loadModels(onProgress?: (done: number, total: number) => void): Promise<Models> {
  if (modelsPromise) return modelsPromise;
  const loader = new GLTFLoader();
  const names = Object.keys(MODEL_FILES) as ModelName[];
  let done = 0;
  modelsPromise = Promise.all(
    names.map(async (name) => {
      const gltf = await loader.loadAsync(`${BASE}models/${MODEL_FILES[name]}`);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
          const mat = m.material as THREE.MeshStandardMaterial;
          // i materiali Kenney sono metallici: con poche luci e senza envmap sembrano neri
          if (mat && "metalness" in mat) {
            mat.metalness = Math.min(mat.metalness, 0.25);
            mat.roughness = Math.max(mat.roughness, 0.55);
          }
        }
      });
      onProgress?.(++done, names.length);
      return [name, normalize(gltf.scene, name === "deck" || name === "gun" || name === "astronaut")] as const;
    }),
  ).then((list) => Object.fromEntries(list) as Models);
  return modelsPromise;
}

/** Copia leggera di un modello (geometrie e materiali condivisi). */
export function instance(models: Models, name: ModelName): THREE.Object3D {
  return models[name].clone(true);
}

/** Ricolora tutti i materiali di un oggetto (clonandoli): usato per il bagliore dei colpi. */
export function tintable(obj: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const mats: THREE.MeshStandardMaterial[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = (m.material as THREE.MeshStandardMaterial).clone();
      mats.push(m.material as THREE.MeshStandardMaterial);
    }
  });
  return mats;
}

export async function loadSky(): Promise<THREE.Texture> {
  const tex = await new THREE.TextureLoader().loadAsync(`${BASE}sky/milkyway.jpg`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

const tintCache = new Map<string, THREE.Material>();

/**
 * Tinge un oggetto moltiplicando il colore dei suoi materiali. I materiali tinti
 * sono condivisi (uno per colore), così centinaia di asteroidi non pesano sulla GPU.
 */
export function tint(obj: THREE.Object3D, color: number): void {
  if (color === 0xffffff) return;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const base = m.material as THREE.MeshStandardMaterial;
    const key = `${base.uuid}:${color}`;
    let t = tintCache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!t) {
      t = base.clone();
      t.color.multiply(new THREE.Color(color));
      tintCache.set(key, t);
    }
    m.material = t;
  });
}
