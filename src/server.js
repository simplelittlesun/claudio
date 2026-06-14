import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import { resolve } from "path";
import nowRoutes from "./routes/now.js";
import debugRoutes from "./routes/debug.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

/* ══════════════════════════════════════════
   Static files
══════════════════════════════════════════ */
app.use(express.static(join(__dirname, "../public")));

/* PWA icon fallback — redirect missing PNG sizes to the SVG */
app.get("/icon-:size.png", (_req, res) => {
  res.redirect(301, "/icon.svg");
});

/* ══════════════════════════════════════════
   Routes
══════════════════════════════════════════ */
app.use(nowRoutes);
app.use(debugRoutes);

/* ══════════════════════════════════════════
   Start
══════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`Claudio running at http://localhost:${PORT}`);
});
