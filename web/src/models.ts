// models.ts — a tiny GLTF model loader + cache for the Kenney furniture/vehicle
// kits. Loads each `.glb` once (cache keyed by URL), then deep-clones the parsed
// source scene for every placement so re-use is cheap. Every clone gets
// castShadow/receiveShadow on all meshes so the models drop into the existing
// soft-shadow lighting. Static meshes only — no skinned meshes — so a plain
// clone(true) is sufficient (no SkeletonUtils needed).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface PlaceOpts {
  x: number;
  z: number;
  rotationY?: number;
  scale?: number;
  /** base Y the model's origin sits at (Kenney origins are at the base, y=0). */
  y?: number;
  parent: THREE.Object3D;
}

export class ModelLoader {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<THREE.Group>>();

  /** Fetch + parse a `.glb` once; the resulting source scene is cached per URL. */
  load(url: string): Promise<THREE.Group> {
    let p = this.cache.get(url);
    if (!p) {
      p = new Promise<THREE.Group>((resolve, reject) => {
        this.loader.load(
          url,
          (gltf) => resolve(gltf.scene),
          undefined,
          (err) => reject(err),
        );
      });
      this.cache.set(url, p);
    }
    return p;
  }

  /** Await the source, deep-clone it, enable shadows on every mesh, place it,
      add to parent, and return the clone. Resolves to null only if load fails. */
  async instance(url: string, opts: PlaceOpts): Promise<THREE.Group | null> {
    let source: THREE.Group;
    try {
      source = await this.load(url);
    } catch (err) {
      console.warn(`[models] failed to load ${url}:`, err);
      return null;
    }
    const clone = source.clone(true);
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if ((mesh as THREE.Mesh).isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    clone.position.set(opts.x, opts.y ?? 0, opts.z);
    clone.rotation.y = opts.rotationY ?? 0;
    const s = opts.scale ?? 1;
    clone.scale.setScalar(s);
    opts.parent.add(clone);
    return clone;
  }
}

/** Traverse `root` and tint every matched mesh's material to `color`. The
    material is cloned first so the shared (cached) source material is never
    mutated — other instances of the same model keep their original colors.
    `predicate` decides which meshes get tinted (default: all meshes). */
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
      return cloned;
    };
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(apply);
    } else {
      mesh.material = apply(mesh.material);
    }
  });
}
