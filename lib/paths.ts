import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const OUTPUTS_DIR = path.join(DATA_DIR, "outputs");
export const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, UPLOADS_DIR, OUTPUTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
