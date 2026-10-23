/// <reference types="vite/client" />

// n8ao ships no TypeScript types; declare the one symbol we use (spec §8 AO).
declare module 'n8ao' {
  import type * as THREE from 'three';
  export class N8AOPostPass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: THREE.Color;
      [k: string]: unknown;
    };
    setSize(width: number, height: number): void;
  }
}
