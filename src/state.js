import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "../state.json");

export function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); }
  catch { return {}; }
}

export function saveState(data) {
  const current = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...data }, null, 2), "utf-8");
}
