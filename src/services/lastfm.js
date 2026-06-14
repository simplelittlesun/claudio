import axios from "axios";

const LASTFM_API_KEY  = process.env.LASTFM_API_KEY;
const LASTFM_USERNAME = process.env.LASTFM_USERNAME;
const LASTFM_BASE     = "https://ws.audioscrobbler.com/2.0";

/* ── Last.fm context cache（1 小時）── */
let _lfmCache = null;
let _lfmCacheAt = 0;

export async function getCachedListeningContext() {
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
