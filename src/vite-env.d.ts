/// <reference types="vite/client" />

declare module "rhino3dm/rhino3dm.module.js" {
  import type rhino3dmFactory from "rhino3dm";
  const rhino3dm: typeof rhino3dmFactory;
  export default rhino3dm;
}

declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Uint8Array>;
}

declare module "node:module" {
  export function createRequire(filename: string | URL): {
    resolve(specifier: string): string;
  };
}

interface ImportMetaEnv {
  readonly VITE_OVERPASS_URL?: string;
  readonly VITE_NOMINATIM_URL?: string;
}
