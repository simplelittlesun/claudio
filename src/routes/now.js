import { Router } from "express";
import { getRecommendation } from "../claude.js";
import { getCachedListeningContext } from "../services/lastfm.js";
import { getWeather } from "../services/weather.js";
import { searchYouTube } from "../services/youtube.js";

const router = Router();

/* 記錄最近播過的歌，避免重複 */
const _recentTracks = [];
const RECENT_MAX = 10;

router.get("/api/now", async (req, res) => {
  const transition = req.query.transition === "true";
  try {
    // 1. 並行取得 Last.fm 聆聽喜好 + 天氣
    const [listeningContext, weather] = await Promise.all([
      getCachedListeningContext(),
      getWeather(),
    ]);

    // 2. Claude 直接推薦歌曲（title + artist）並寫播報詞
    const { say, title, artist } = await getRecommendation({
      transition,
      spotifyContext: listeningContext,
      weather,
      recentTracks: _recentTracks,
    });

    // 3. 搜尋 YouTube
    const isClassical = /古典|classical|piano sonata|symphony|concerto/i.test(title + artist);
    const youtubeId = await searchYouTube(`${title} ${artist}`, { title, artist, allowLong: isClassical });
    console.log(`[now] ${title} — ${artist} | yt: ${youtubeId ?? "not found"}`);

    // 4. 記錄已播，避免重複
    _recentTracks.push({ title, artist });
    if (_recentTracks.length > RECENT_MAX) _recentTracks.shift();

    res.json({ title, artist, say, youtubeId });
  } catch (err) {
    console.error("[api/now]", err.message);
    res.json({
      title: "魚", artist: "陳綺貞",
      say: "窗外應該已經有光了。陳綺貞的〈魚〉。",
    });
  }
});

export default router;
