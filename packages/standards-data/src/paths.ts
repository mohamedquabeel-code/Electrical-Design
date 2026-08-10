import { fileURLToPath } from "node:url";

/**
 * Absolute path to the datasets directory.
 *
 * Kept separate from `index.ts` so the schemas stay importable in environments
 * without `node:url` — the mobile app bundles the JSON rather than reading it
 * from a filesystem.
 */
export const DATASETS_DIR = fileURLToPath(new URL("../datasets", import.meta.url));
