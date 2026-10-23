// models.ts — GLTF loader + cache. Every placement is a clone of a cached
// source, uniformly scaled and pivot-corrected so the bbox BOTTOM-CENTER sits
// at the group origin (Kenney origins sit at a corner, which made rotations
// swing furniture off its spot).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface NormalizedAsset {
  group: THREE.Group;
  /** real-world size (m) after scaling, in the model's own axes. */
  size: THREE.Vector3;
}

interface RawBox { size: THREE.Vector3; center: THREE.Vector3; minY: number }

export class ModelLoader {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<THREE.Group>>();
  private readonly rawBox = new Map<string, RawBox>();

  /** Fetch + parse a .glb once; the parsed source scene is cached per URL. */
  load(url: string): Promise<THREE.Group> {
    let p = this.cache.get(url);
    if (!p) {
      p = new Promise<THREE.Group>((resolve, reject) => {
        this.loader.load(url, (gltf) => resolve(gltf.scene), undefined, (err) => reject(err));
      });
      this.cache.set(url, p);
    }
    return p;
  }

  /** Raw (unscaled) bbox of a model, measured once. */
  async measure(url: string): Promise<RawBox | null> {
    const cached = this.rawBox.get(url);
    if (cached) return cached;
    let source: THREE.Group;
    try {
      source = await this.load(url);
    } catch (err) {
      console.warn(`[models] failed to load ${url}:`, err);
      return null;
    }
    const box = new THREE.Box3().setFromObject(source, true);
    const raw = { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), minY: box.min.y };
    this.rawBox.set(url, raw);
    return raw;
  }

  /** Clone `url`, scale it uniformly by `scale`, and wrap it so the group origin
      is the bbox bottom-center. Resolves to null if the load fails. */
  async place(url: string, scale: number): Promise<NormalizedAsset | null> {
    const raw = await this.measure(url);
    if (!raw) return null;
    const source = await this.load(url);
    const clone = source.clone(true);
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    clone.position.set(-raw.center.x, -raw.minY, -raw.center.z);
    const inner = new THREE.Group();
    inner.add(clone);
    inner.scale.setScalar(scale);
    const group = new THREE.Group();
    group.add(inner);
    return { group, size: raw.size.clone().multiplyScalar(scale) };
  }
}

/** Traverse `root` and tint every matched mesh's material to `color`. The
    material is cloned first so the shared (cached) source material is never
    mutated — other instances of the same model keep their original colors. */
export function tintMeshes(
  root: THREE.Object3D,
  color: number,
  predicate: (mesh: THREE.Mesh) => boolean = () => true,
): void {
  const tint = new THREE.Color(color);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !predicate(mesh)) return;
    const apply = (m: THREE.Material): THREE.Material => {
      const cloned = m.clone() as THREE.MeshStandardMaterial;
      if ('color' in cloned && cloned.color) cloned.color.copy(tint);
      cloned.map = null; // a flat tint; the kit colormap would darken it
      return cloned;
    };
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(apply);
    } else {
      mesh.material = apply(mesh.material);
    }
  });
}
