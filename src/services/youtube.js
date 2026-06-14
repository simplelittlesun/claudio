import axios from "axios";

const YT_API_KEY = process.env.YOUTUBE_API_KEY;

/* 排除明顯非原曲版本的標題關鍵字 */
const YT_BLACKLIST = /interview|podcast|訪談|節目|talk show|talk\s*show|live talk|behind the scene|making of|making-of|reaction|cover by|covered by|tutorial|lesson|課程|教學|unboxing|review|vlog|commentary|gameplay|trailer|teaser|preview|第\d+[集話]|ep\.?\s*\d+|8d audio|slowed|reverb|sped up|nightcore|tiktok|fancam|fan\s*cam|remix(?!.*official)/i;

/* 標題正規化：移除括號內容、噪音詞、符號與空白，方便比對歌名/歌手 */
function normalize(str = "") {
  return str
    .toLowerCase()
    .replace(/[\(\[【「（].*?[\)\]】」）]/g, " ")
    .replace(/official\s*(music\s*)?(video|audio|mv)?|lyric(s)?\s*video|music\s*video|\bmv\b|\bhd\b|\b4k\b|feat\.?|ft\.?/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/* 檢查影片標題是否同時對應到推薦的歌名與歌手 */
function matchesTrack(videoTitle, title, artist) {
  const norm = normalize(videoTitle);
  const titleNorm = normalize(title);
  if (!titleNorm || !norm.includes(titleNorm)) return false;

  const artistParts = artist
    .split(/[、,&\/]| feat\.?| ft\.?| and /i)
    .map(a => normalize(a))
    .filter(a => a.length >= 2);
  if (!artistParts.length) return true;

  return artistParts.some(a => norm.includes(a));
}

function parseDuration(iso = "") {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

export async function searchYouTube(query, { title = "", artist = "", allowLong = false } = {}) {
  if (!YT_API_KEY) return null;

  /* 依序嘗試：official + topicId 限音樂 → official → 純查詢 */
  async function _search(q, useTopicFilter) {
    const params = {
      part: "snippet",
      q,
      type: "video",
      maxResults: 8,
      key: YT_API_KEY,
    };
    if (useTopicFilter) params.topicId = "/m/04rlf";
    const { data } = await axios.get("https://www.googleapis.com/youtube/v3/search", { params });
    return data.items ?? [];
  }

  try {
    let items = await _search(`${query} official`, true);
    if (!items.length) items = await _search(`${query} official`, false);
    if (!items.length) items = await _search(query, false);
    if (!items.length) return null;

    /* 1. 優先選歌名+歌手都對得上的結果 */
    const matched = items.filter(i => matchesTrack(i.snippet?.title ?? "", title, artist));
    let candidates = matched.length ? matched : items;

    /* 2. 過濾明顯非原曲版本 */
    const filtered = candidates.filter(i => !YT_BLACKLIST.test(i.snippet?.title ?? ""));
    if (filtered.length) candidates = filtered;

    if (allowLong) return candidates[0].id.videoId;

    /* 3. 取得時長，選第一個 ≤7 分鐘的 */
    const ids = candidates.map(i => i.id.videoId).join(",");
    const { data: vData } = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: { part: "contentDetails", id: ids, key: YT_API_KEY },
    });
    for (const v of vData.items ?? []) {
      if (parseDuration(v.contentDetails.duration) <= 420) return v.id;
    }
    return candidates[0].id.videoId;   // 全超過 7 分鐘就取第一個
  } catch (err) {
    console.error("[youtube]", err.response?.data?.error?.message ?? err.message);
    return null;
  }
}
