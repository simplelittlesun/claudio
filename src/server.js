import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import axios from "axios";
import dotenv from "dotenv";
import { resolve } from "path";
import { searchTrack, getMoodStations, getMoodStationTracks } from "./kkbox.js";
import { getRecommendation } from "./claude.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID     = process.env.KKBOX_CLIENT_ID;
const CLIENT_SECRET = process.env.KKBOX_CLIENT_SECRET;
const REDIRECT_URI  = "http://localhost:3000/auth/callback";
const AUTH_URL      = "https://account.kkbox.com/oauth2/authorize";
const TOKEN_URL     = "https://account.kkbox.com/oauth2/token";
const API_BASE      = "https://api.kkbox.com/v1.1";
const STATE_FILE    = join(__dirname, "../state.json");

/* ── state.json helpers ── */
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); }
  catch { return {}; }
}

function saveState(data) {
  const current = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...data }, null, 2), "utf-8");
}

/* ── token helpers ── */
async function refreshIfNeeded() {
  const state = loadState();
  if (!state.access_token) throw new Error("尚未授權，請先前往 /auth/kkbox");

  // Refresh if expiring within 60 s
  if (state.expires_at && Date.now() < state.expires_at - 60_000) {
    return state.access_token;
  }

  if (!state.refresh_token) throw new Error("沒有 refresh_token，請重新授權：/auth/kkbox");

  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: state.refresh_token,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  saveState({
    access_token:  data.access_token,
    refresh_token: data.refresh_token ?? state.refresh_token,
    expires_at:    Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/* ── static files ── */
app.use(express.static(join(__dirname, "../public")));

/* ──────────────────────────────────────────
   OAuth routes
────────────────────────────────────────── */

// 1. Redirect user to KKBOX authorization page
app.get("/auth/kkbox", (_req, res) => {
  const params = [
    `client_id=${encodeURIComponent(CLIENT_ID)}`,
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    `response_type=code`,
  ].join("&");
  const url = `${AUTH_URL}?${params}`;
  console.log("[auth/kkbox] redirect →", url);
  res.redirect(url);
});

// 2. Handle callback — exchange code for tokens, save to state.json
app.get("/auth/callback", async (req, res) => {
  console.log("[auth/callback] query params:", JSON.stringify(req.query));
  const { code, error } = req.query;

  if (error || !code) {
    return res.status(400).send(
      `授權失敗：${error ?? "未收到授權碼"}<br><br>` +
      `<pre>收到的參數：${JSON.stringify(req.query, null, 2)}</pre>`
    );
  }

  try {
    // Exchange code for tokens
    const params = new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const { data: tokenData } = await axios.post(TOKEN_URL, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const accessToken = tokenData.access_token;

    // Fetch user ID
    const { data: userData } = await axios.get(`${API_BASE}/users/me?territory=TW`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    saveState({
      access_token:  accessToken,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at:    Date.now() + tokenData.expires_in * 1000,
      user_id:       userData.id,
      user_name:     userData.name,
    });

    console.log(`[auth] 授權成功：${userData.name} (${userData.id})`);
    res.send(`
      <html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;padding:2rem;background:#07091a;color:#e2e8f0">
        <h2>✅ 授權成功</h2>
        <p>歡迎，${userData.name}！</p>
        <p>你現在可以使用 <a href="/api/my-playlists" style="color:#818cf8">/api/my-playlists</a> 取得歌單。</p>
        <p><a href="/" style="color:#c8956c">← 回到 Claudio FM</a></p>
      </body></html>
    `);
  } catch (err) {
    console.error("[auth/callback]", err.response?.data ?? err.message);
    res.status(502).send(`換取 token 失敗：${err.message}`);
  }
});

/* ──────────────────────────────────────────
   Playlist API routes
────────────────────────────────────────── */

// 3. Get user's playlists
app.get("/api/my-playlists", async (_req, res) => {
  try {
    const token  = await refreshIfNeeded();
    const { user_id } = loadState();

    const { data } = await axios.get(
      `${API_BASE}/users/${user_id}/playlists?territory=TW&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json({
      total: data.paging?.total ?? data.data?.length,
      playlists: (data.data ?? []).map((p) => ({
        id:    p.id,
        title: p.title,
        count: p.track_count,
        image: p.images?.[0]?.url ?? null,
      })),
    });
  } catch (err) {
    console.error("[my-playlists]", err.response?.data ?? err.message);
    const status = err.message.includes("授權") ? 401 : 502;
    res.status(status).json({ error: err.message });
  }
});

// 4. Get tracks in a specific playlist
app.get("/api/playlist/:id", async (req, res) => {
  try {
    const token = await refreshIfNeeded();
    const { id } = req.params;
    const limit  = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;

    const { data } = await axios.get(
      `${API_BASE}/playlists/${id}/tracks?territory=TW&limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json({
      total: data.paging?.total ?? data.data?.length,
      tracks: (data.data ?? []).map((t) => ({
        id:     t.id,
        title:  t.name,
        artist: t.album?.artist?.name ?? "—",
        album:  t.album?.name ?? "—",
        url:    t.url ?? null,
      })),
    });
  } catch (err) {
    console.error("[playlist/:id]", err.response?.data ?? err.message);
    const status = err.message.includes("授權") ? 401 : 502;
    res.status(status).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────
   Existing routes
────────────────────────────────────────── */

app.get("/api/search", async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter: q" });

  try {
    const tracks = await searchTrack(q);
    res.json({ tracks });
  } catch (err) {
    console.error("[search]", err.message);
    res.status(502).json({ error: "KKBOX API error", detail: err.message });
  }
});

app.get("/api/now", async (_req, res) => {
  try {
    // 1. 取得 Mood Stations 清單（有快取）
    const stations = await getMoodStations();

    // 2. 讓 Claude 選一個 station 並寫播報詞
    const { say, station_id } = await getRecommendation(stations);

    // 3. 取得該 station 的曲目，隨機抽一首
    const tracks = await getMoodStationTracks(station_id);
    if (!tracks.length) throw new Error("station 沒有曲目");
    const track = tracks[Math.floor(Math.random() * tracks.length)];

    res.json({ ...track, say });
  } catch (err) {
    console.error("[api/now]", err.message);
    // fallback：靜態資料
    res.json({
      title:  "魚",
      artist: "陳綺貞",
      album:  "太陽",
      url:    null,
      say:    "窗外應該已經有光了。這首歌很適合你還沒完全醒來的那幾分鐘——陳綺貞的〈魚〉。",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Claudio running at http://localhost:${PORT}`);
  console.log(`KKBOX 授權入口：http://localhost:${PORT}/auth/kkbox`);
});
