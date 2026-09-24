import { mkdir, writeFile } from "node:fs/promises";
import { ARCHETYPE_CATALOG, archetypeGltf } from "../src/lib/treeForms.ts";

const directory = new URL("../src/assets/trees/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const info of ARCHETYPE_CATALOG) {
  await writeFile(new URL(`${info.id}.gltf`, directory), archetypeGltf(info.id));
}
console.log(`wrote ${ARCHETYPE_CATALOG.length} tree archetypes`);
