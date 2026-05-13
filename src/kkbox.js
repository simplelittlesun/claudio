import axios from "axios";
import "dotenv/config";

const TOKEN_URL = "https://account.kkbox.com/oauth2/token";
const API_BASE = "https://api.kkbox.com/v1.1";
const TERRITORY = "TW";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.KKBOX_CLIENT_ID,
    client_secret: process.env.KKBOX_CLIENT_SECRET,
  });

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000; // 提前 60s 更新
  return cachedToken;
}

/* ── mood stations cache ── */
let cachedStations = null;

export async function getMoodStations() {
  if (cachedStations) return cachedStations;
  const token = await getAccessToken();
  const { data } = await axios.get(`${API_BASE}/mood-stations`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { territory: TERRITORY, limit: 100 },
  });
  cachedStations = data.data.map((s) => ({ id: s.id, title: s.name }));
  return cachedStations;
}

export async function getMoodStationTracks(stationId) {
  const token = await getAccessToken();
  const { data } = await axios.get(`${API_BASE}/mood-stations/${stationId}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { territory: TERRITORY },
  });
  return (data.tracks?.data ?? []).map((t) => ({
    id:     t.id,
    title:  t.name,
    artist: t.album?.artist?.name ?? "—",
    album:  t.album?.name ?? "—",
    url:    t.url ?? null,
  }));
}

export async function searchTrack(keyword, limit = 10) {
  const token = await getAccessToken();

  const { data } = await axios.get(`${API_BASE}/search`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q: keyword, type: "track", territory: TERRITORY, limit },
  });

  return data.tracks.data.map((track) => ({
    id: track.id,
    title: track.name,
    artist: track.album.artist.name,
    album: track.album.name,
    url: track.url,
  }));
}
