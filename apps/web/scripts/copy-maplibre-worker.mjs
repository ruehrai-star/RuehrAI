import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"));
const dest = join(dirname(fileURLToPath(import.meta.url)), "../public/maplibre");

await mkdir(dest, { recursive: true });
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(join(dist, name), join(dest, name));
}
