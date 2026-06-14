import { Router } from "express";
import axios from "axios";
import { getRecommendation } from "../claude.js";
import { getCachedListeningContext } from "../services/lastfm.js";
import { searchYouTube } from "../services/youtube.js";

const router = Router();

/* 看 Last.fm 目前抓到什麼 */
router.get("/api/debug/lastfm", async (_req, res) => {
  const data = await getCachedListeningContext();
  res.json(data ?? { error: "Last.fm 沒有資料或尚未載入" });
});

router.get("/api/debug/youtube", async (_req, res) => {
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

router.get("/api/debug/now", async (_req, res) => {
  const result = { claude: null, youtube: null, error: null };
  try {
    result.claude = "fetching...";
    const { title, artist } = await getRecommendation({ recentTracks: [] });
    result.claude = `ok — ${title} / ${artist}`;

    result.youtube = "fetching...";
    const ytId = await searchYouTube(`${title} ${artist}`, { title, artist });
    result.youtube = ytId ? `ok — ${ytId}` : `not found for "${title} ${artist}"`;

  } catch (err) {
    result.error = err.message;
  }
  res.json(result);
});

export default router;
