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

/* ── KKBOX ── */
const CLIENT_ID     = process.env.KKBOX_CLIENT_ID;
const CLIENT_SECRET = process.env.KKBOX_CLIENT_SECRET;
const REDIRECT_URI  = "http://localhost:3000/auth/callback";
const AUTH_URL      = "https://account.kkbox.com/oauth2/authorize";
const TOKEN_URL     = "https://account.kkbox.com/oauth2/token";
const API_BASE      = "https://api.kkbox.com/v1.1";

/* ── YouTube ── */
const YT_API_KEY = process.env.YOUTUBE_API_KEY;

/* ── Last.fm ── */
const LASTFM_API_KEY  = process.env.LASTFM_API_KEY;
const LASTFM_USERNAME = process.env.LASTFM_USERNAME;
const LASTFM_BASE     = "https://ws.audioscrobbler.com/2.0";

/* ── Spotify ── */
const SP_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SP_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SP_REDIRECT_URI  = "http://127.0.0.1:3000/auth/spotify/callback";
const SP_AUTH_URL      = "https://accounts.spotify.com/authorize";
const SP_TOKEN_URL     = "https://accounts.spotify.com/api/token";
const SP_API_BASE      = "https://api.spotify.com/v1";
const SP_SCOPES        = "user-library-read playlist-read-private user-top-read user-read-recently-played";

const STATE_FILE = join(__dirname, "../state.json");

/* ══════════════════════════════════════════
   state.json helpers
══════════════════════════════════════════ */
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); }
  catch { return {}; }
}

function saveState(data) {
  const current = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...data }, null, 2), "utf-8");
}

/* ══════════════════════════════════════════
   KKBOX token helper
══════════════════════════════════════════ */
async function kkboxRefreshIfNeeded() {
  const state = loadState();
  if (!state.access_token) throw new Error("尚未授權，請先前往 /auth/kkbox");
  if (state.expires_at && Date.now() < state.expires_at - 60_000) return state.access_token;
  if (!state.refresh_token) throw new Error("沒有 refresh_token，請重新授權：/auth/kkbox");

  const params = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: state.refresh_token,
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  saveState({ access_token: data.access_token, refresh_token: data.refresh_token ?? state.refresh_token, expires_at: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

/* ══════════════════════════════════════════
   Spotify token helper
══════════════════════════════════════════ */
async function spotifyGetToken() {
  const state = loadState();
  if (!state.sp_access_token) throw new Error("Spotify 尚未授權，請先前往 /auth/spotify");

  if (state.sp_expires_at && Date.now() < state.sp_expires_at - 60_000) {
    return state.sp_access_token;
  }

  // Refresh
  const basic = Buffer.from(`${SP_CLIENT_ID}:${SP_CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: state.sp_refresh_token });
  const { data } = await axios.post(SP_TOKEN_URL, params.toString(), {
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  saveState({
    sp_access_token: data.access_token,
    sp_refresh_token: data.refresh_token ?? state.sp_refresh_token,
    sp_expires_at: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

async function spotifyGet(path, params = {}) {
  const token = await spotifyGetToken();
  const { data } = await axios.get(`${SP_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return data;
}

/* ══════════════════════════════════════════
   Weather cache（15 分鐘）
══════════════════════════════════════════ */
let _weatherCache = null;
let _weatherCacheAt = 0;

async function getWeather() {
  if (_weatherCache && Date.now() - _weatherCacheAt < 15 * 60_000) return _weatherCache;
  try {
    const { data } = await axios.get("https://wttr.in/?format=j1", { timeout: 3000 });
    const c = data.current_condition?.[0];
    if (!c) return null;
    _weatherCache = {
      desc:     c.weatherDesc?.[0]?.value ?? "",
      tempC:    c.temp_C,
      humidity: c.humidity,
    };
    _weatherCacheAt = Date.now();
    console.log(`[weather] ${_weatherCache.desc} ${_weatherCache.tempC}°C`);
    return _weatherCache;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════
   Last.fm context cache（1 小時）
══════════════════════════════════════════ */
let _lfmCache = null;
let _lfmCacheAt = 0;

async function getCachedListeningContext() {
  if (_lfmCache && Date.now() - _lfmCacheAt < 3_600_000) return _lfmCache;
  if (!LASTFM_API_KEY || !LASTFM_USERNAME) return null;
  try {
    // 並行取得 top tracks + top artists（近一個月）
    const [topTracksRes, topArtistsRes] = await Promise.all([
      axios.get(LASTFM_BASE, { params: { method: "user.getTopTracks", user: LASTFM_USERNAME, api_key: LASTFM_API_KEY, format: "json", period: "1month", limit: 15 } }),
      axios.get(LASTFM_BASE, { params: { method: "user.getTopArtists", user: LASTFM_USERNAME, api_key: LASTFM_API_KEY, format: "json", period: "1month", limit: 8 } }),
    ]);

    const tracks = (topTracksRes.data.toptracks?.track ?? []).map(t => ({
      title:  t.name,
      artist: t.artist?.name ?? t.artist,
    }));

    const artists = (topArtistsRes.data.topartists?.artist ?? []).map(a => a.name);

    const context = { tracks, artists };
    _lfmCache = context;
    _lfmCacheAt = Date.now();
    console.log(`[lastfm] 載入 ${tracks.length} 首 top tracks，${artists.length} 位 top artists`);
    return context;
  } catch (err) {
    console.error("[lastfm]", err.message);
    return null;
  }
}

/* ══════════════════════════════════════════
   YouTube helpers
══════════════════════════════════════════ */
function parseDuration(iso = "") {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

/* 排除明顯非音樂內容的標題關鍵字 */
const YT_BLACKLIST = /interview|podcast|訪談|節目|talk show|talk\s*show|live talk|behind the scene|making of|making-of|reaction|cover by|covered by|tutorial|lesson|課程|教學|unboxing|review|vlog|commentary|gameplay|trailer|teaser|preview|第\d+[集話]|ep\.?\s*\d+/i;

async function searchYouTube(query, { allowLong = false } = {}) {
  if (!YT_API_KEY) return null;

  /* 先用嚴格條件（topicId 限音樂），沒結果再退回寬鬆搜尋 */
  async function _search(useTopicFilter) {
    const params = {
      part: "snippet",
      q: `${query} official`,
      type: "video",
      maxResults: 8,
      key: YT_API_KEY,
    };
    if (useTopicFilter) params.topicId = "/m/04rlf";
    const { data } = await axios.get("https://www.googleapis.com/youtube/v3/search", { params });
    return data.items ?? [];
  }

  try {
    let items = await _search(true);
    if (!items.length) items = await _search(false);   // fallback：不限 topic
    if (!items.length) return null;

    /* 過濾明顯非音樂標題 */
    const filtered = items.filter(i => !YT_BLACKLIST.test(i.snippet?.title ?? ""));
    if (filtered.length) items = filtered;

    if (allowLong) return items[0].id.videoId;

    /* 取得時長，選第一個 ≤7 分鐘的 */
    const ids = items.map(i => i.id.videoId).join(",");
    const { data: vData } = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: { part: "contentDetails", id: ids, key: YT_API_KEY },
    });
    for (const v of vData.items ?? []) {
      if (parseDuration(v.contentDetails.duration) <= 420) return v.id;
    }
    return items[0].id.videoId;   // 全超過 7 分鐘就取第一個
  } catch (err) {
    console.error("[youtube]", err.response?.data?.error?.message ?? err.message);
    return null;
  }
}

/* ══════════════════════════════════════════
   Static files
══════════════════════════════════════════ */
app.use(express.static(join(__dirname, "../public")));

/* PWA icon fallback — redirect missing PNG sizes to the SVG */
app.get("/icon-:size.png", (_req, res) => {
  res.redirect(301, "/icon.svg");
});

/* ══════════════════════════════════════════
   KKBOX OAuth routes
══════════════════════════════════════════ */
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

app.get("/auth/callback", async (req, res) => {
  console.log("[auth/callback] query params:", JSON.stringify(req.query));
  const { code, error } = req.query;
  if (error || !code) {
    return res.status(400).send(`授權失敗：${error ?? "未收到授權碼"}<br><pre>${JSON.stringify(req.query, null, 2)}</pre>`);
  }
  try {
    const params = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    const { data: tokenData } = await axios.post(TOKEN_URL, params.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const { data: userData } = await axios.get(`${API_BASE}/users/me?territory=TW`, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    saveState({ access_token: tokenData.access_token, refresh_token: tokenData.refresh_token ?? null, expires_at: Date.now() + tokenData.expires_in * 1000, user_id: userData.id, user_name: userData.name });
    res.send(`<html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;padding:2rem;background:#07091a;color:#e2e8f0"><h2>✅ KKBOX 授權成功</h2><p>歡迎，${userData.name}！</p><p><a href="/" style="color:#c8956c">← 回到 Claudio FM</a></p></body></html>`);
  } catch (err) {
    res.status(502).send(`換取 token 失敗：${err.message}`);
  }
});

/* ══════════════════════════════════════════
   Spotify OAuth routes
══════════════════════════════════════════ */

// 1. 導向 Spotify 授權頁面
app.get("/auth/spotify", (_req, res) => {
  const params = new URLSearchParams({
    client_id:     SP_CLIENT_ID,
    redirect_uri:  SP_REDIRECT_URI,
    response_type: "code",
    scope:         SP_SCOPES,
  });
  const url = `${SP_AUTH_URL}?${params}`;
  console.log("[auth/spotify] redirect →", url);
  res.redirect(url);
});

// 2. 接收授權碼，換取 token
app.get("/auth/spotify/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.status(400).send(`Spotify 授權失敗：${error ?? "未收到授權碼"}`);
  }
  try {
    const basic = Buffer.from(`${SP_CLIENT_ID}:${SP_CLIENT_SECRET}`).toString("base64");
    const params = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: SP_REDIRECT_URI });
    const { data: tokenData } = await axios.post(SP_TOKEN_URL, params.toString(), {
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    });

    // 取得使用者資料
    const { data: userData } = await axios.get(`${SP_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    saveState({
      sp_access_token:  tokenData.access_token,
      sp_refresh_token: tokenData.refresh_token,
      sp_expires_at:    Date.now() + tokenData.expires_in * 1000,
      sp_user_id:       userData.id,
      sp_user_name:     userData.display_name,
    });

    // 清除 top tracks 快取
    _spTopCache = null;

    console.log(`[auth/spotify] 授權成功：${userData.display_name} (${userData.id})`);
    res.send(`
      <html><head><meta charset="UTF-8"></head>
      <body style="font-family:sans-serif;padding:2rem;background:#07091a;color:#e2e8f0">
        <h2>✅ Spotify 授權成功</h2>
        <p>歡迎，${userData.display_name}！</p>
        <p>Claudio 現在會根據你的 Spotify 聆聽習慣推薦音樂。</p>
        <p>
          <a href="/api/spotify/top-tracks" style="color:#818cf8">查看你的 Top Tracks</a>
          <a href="/api/spotify/playlists" style="color:#818cf8">查看你的歌單</a>
        </p>
        <p><a href="/" style="color:#c8956c">← 回到 Claudio FM</a></p>
      </body></html>
    `);
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.error("[auth/spotify/callback]", JSON.stringify(detail));
    res.status(502).send(`
      <pre style="font-family:monospace;padding:2rem;background:#1a1a2e;color:#e2e8f0">
Spotify token 換取失敗

HTTP status: ${err.response?.status ?? "N/A"}
Error detail: ${JSON.stringify(detail, null, 2)}
      </pre>
    `);
  }
});

/* ══════════════════════════════════════════
   Spotify API routes
══════════════════════════════════════════ */

// 3. 取得所有歌單
app.get("/api/spotify/playlists", async (_req, res) => {
  try {
    const data = await spotifyGet("/me/playlists", { limit: 50 });
    res.json({
      total: data.total,
      playlists: (data.items ?? []).map(p => ({
        id:    p.id,
        name:  p.name,
        count: p.tracks?.total ?? 0,
        image: p.images?.[0]?.url ?? null,
        owner: p.owner?.display_name ?? "—",
      })),
    });
  } catch (err) {
    console.error("[spotify/playlists]", err.response?.data ?? err.message);
    res.status(err.message.includes("授權") ? 401 : 502).json({ error: err.message });
  }
});

// 4. 取得特定歌單的歌曲
app.get("/api/spotify/playlist/:id", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const data   = await spotifyGet(`/playlists/${req.params.id}/tracks`, { limit, offset, fields: "total,items(track(id,name,artists,album(name),duration_ms,external_urls))" });
    res.json({
      total: data.total,
      tracks: (data.items ?? [])
        .filter(i => i.track)
        .map(i => ({
          id:       i.track.id,
          title:    i.track.name,
          artist:   i.track.artists.map(a => a.name).join(", "),
          album:    i.track.album.name,
          duration: Math.round(i.track.duration_ms / 1000),
          url:      i.track.external_urls?.spotify ?? null,
        })),
    });
  } catch (err) {
    console.error("[spotify/playlist/:id]", err.response?.data ?? err.message);
    res.status(err.message.includes("授權") ? 401 : 502).json({ error: err.message });
  }
});

// 5. 取得最常聽的歌曲
app.get("/api/spotify/top-tracks", async (req, res) => {
  try {
    const range = req.query.range ?? "medium_term";   // short_term / medium_term / long_term
    const data  = await spotifyGet("/me/top/tracks", { limit: 20, time_range: range });
    res.json({
      tracks: (data.items ?? []).map(t => ({
        id:       t.id,
        title:    t.name,
        artist:   t.artists.map(a => a.name).join(", "),
        album:    t.album.name,
        duration: Math.round(t.duration_ms / 1000),
        url:      t.external_urls?.spotify ?? null,
      })),
    });
  } catch (err) {
    console.error("[spotify/top-tracks]", err.response?.data ?? err.message);
    res.status(err.message.includes("授權") ? 401 : 502).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════
   KKBOX Playlist routes
══════════════════════════════════════════ */
app.get("/api/my-playlists", async (_req, res) => {
  try {
    const token = await kkboxRefreshIfNeeded();
    const { user_id } = loadState();
    const { data } = await axios.get(`${API_BASE}/users/${user_id}/playlists?territory=TW&limit=50`, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ total: data.paging?.total ?? data.data?.length, playlists: (data.data ?? []).map(p => ({ id: p.id, title: p.title, count: p.track_count, image: p.images?.[0]?.url ?? null })) });
  } catch (err) {
    res.status(err.message.includes("授權") ? 401 : 502).json({ error: err.message });
  }
});

app.get("/api/playlist/:id", async (req, res) => {
  try {
    const token = await kkboxRefreshIfNeeded();
    const { id } = req.params;
    const limit  = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const { data } = await axios.get(`${API_BASE}/playlists/${id}/tracks?territory=TW&limit=${limit}&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ total: data.paging?.total, tracks: (data.data ?? []).map(t => ({ id: t.id, title: t.name, artist: t.album?.artist?.name ?? "—", album: t.album?.name ?? "—", url: t.url ?? null })) });
  } catch (err) {
    res.status(err.message.includes("授權") ? 401 : 502).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════
   Debug：看 Last.fm 目前抓到什麼
══════════════════════════════════════════ */
app.get("/api/debug/lastfm", async (_req, res) => {
  const data = await getCachedListeningContext();
  res.json(data ?? { error: "Last.fm 沒有資料或尚未載入" });
});

app.get("/api/debug/youtube", async (_req, res) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.json({ error: "YOUTUBE_API_KEY 未設定" });
  try {
    const { data } = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: { part: "snippet", q: "落日飛車 official", type: "video", maxResults: 1, key },
    });
    const item = data.items?.[0];
    res.json({ ok: true, videoId: item?.id?.videoId, title: item?.snippet?.title });
  } catch (err) {
    res.json({ error: err.message, status: err.response?.status, detail: err.response?.data });
  }
});

/* ══════════════════════════════════════════
   Search
══════════════════════════════════════════ */
app.get("/api/search", async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter: q" });
  try {
    const tracks = await searchTrack(q);
    res.json({ tracks });
  } catch (err) {
    res.status(502).json({ error: "KKBOX API error", detail: err.message });
  }
});

/* ══════════════════════════════════════════
   /api/now — 核心選歌流程
══════════════════════════════════════════ */
app.get("/api/now", async (req, res) => {
  const transition = req.query.transition === "true";
  try {
    // 1. 取得 Mood Stations 清單
    const stations = await getMoodStations();

    // 2. 並行取得 Last.fm 聆聽喜好 + 天氣
    const [listeningContext, weather] = await Promise.all([
      getCachedListeningContext(),
      getWeather(),
    ]);

    // 3. 讓 Claude 選 station 並寫播報詞
    const { say, station_id } = await getRecommendation(stations, { transition, spotifyContext: listeningContext, weather });

    // 4. 從 station 隨機取一首歌
    const tracks = await getMoodStationTracks(station_id);
    if (!tracks.length) throw new Error("station 沒有曲目");
    const track = tracks[Math.floor(Math.random() * tracks.length)];

    // 5. 搜尋 YouTube（古典音樂不限時長）
    const stationName = stations.find(s => s.id === station_id)?.title ?? "";
    const isClassical = /classic|古典/i.test(stationName);
    const youtubeId   = await searchYouTube(`${track.title} ${track.artist}`, { allowLong: isClassical });
    console.log(`[now] ${track.title} — ${track.artist} | station: ${stationName} | yt: ${youtubeId ?? "not found"}`);

    res.json({ ...track, say, youtubeId });
  } catch (err) {
    console.error("[api/now]", err.message);
    res.json({
      title: "魚", artist: "陳綺貞", album: "太陽", url: null,
      say: "窗外應該已經有光了。這首歌很適合你還沒完全醒來的那幾分鐘——陳綺貞的〈魚〉。",
    });
  }
});

/* ══════════════════════════════════════════
   Start
══════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`Claudio running at http://localhost:${PORT}`);
  console.log(`Spotify 授權入口：http://localhost:${PORT}/auth/spotify`);
});
