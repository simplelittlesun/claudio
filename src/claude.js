import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();

const PERSONA = readFileSync(join(__dirname, "../prompts/dj-persona.md"), "utf-8");
const TASTE   = readFileSync(join(__dirname, "../user/taste.md"), "utf-8");

const TZ = "Asia/Taipei";

/* 取得台灣時區的小時（部署在 UTC 伺服器如 Railway 也正確）*/
function taipeiHour() {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date())
  ) % 24;
}

/* ── 時段定義 ── */
function timeOfDay() {
  const h = taipeiHour();
  if (h >= 6  && h < 10) return "早晨";
  if (h >= 10 && h < 17) return "白天";
  if (h >= 17 && h < 21) return "傍晚";
  return "深夜";
}

const PERIOD_TONE = {
  早晨: "現在是早晨（6–10 點）。語氣輕快、有能量、帶點陽光感，像一杯剛泡好的咖啡。選歌以節奏明快、旋律清晰、能幫助開啟一天為主。",
  白天: "現在是白天（10–17 點）。語氣自然從容，像在咖啡廳的背景音。選歌以適合專注或輕鬆活動的為主，不要太激烈也不要太沉悶。",
  傍晚: "現在是傍晚（17–21 點）。語氣溫柔帶點感性，像窗邊的夕陽光線，帶一點疲倦後的舒緩。選歌以有情緒、有層次的為主，幫助聽眾從一天的節奏慢下來。",
  深夜: "現在是深夜（21–6 點）。語氣安靜、內斂，像窗外的路燈。選歌以安靜、帶點餘韻的為主，適合發呆、沉思或準備入睡。",
};

/* ── 主函式 ── */
export async function getRecommendation({ transition = false, spotifyContext = null, weather = null, recentTracks = [] } = {}) {
  const period = timeOfDay();
  const clock  = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

  const hasContext = spotifyContext?.tracks?.length || spotifyContext?.artists?.length;
  const spotifySection = hasContext
    ? `\n\n---\n\n## 聽眾的真實聆聽紀錄（Last.fm，近一個月）\n\n` +
      (spotifyContext.tracks?.length
        ? `**最常聽的歌曲：**\n` + spotifyContext.tracks.map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`).join("\n")
        : "") +
      (spotifyContext.artists?.length
        ? `\n\n**最常聽的藝人：**\n` + spotifyContext.artists.join("、")
        : "") +
      `\n\n請參考以上資料，了解她真實的音樂口味，讓播報詞或選曲更貼近她的喜好。`
    : "";

  const weatherSection = weather
    ? `\n\n---\n\n## 當前天氣\n\n${weather.desc}，${weather.tempC}°C，濕度 ${weather.humidity}%。` +
      `請將天氣氛圍自然融入選曲判斷與播報詞的意象中——不要直接說「現在天氣是⋯」，而是讓它成為語感的一部分。`
    : "";

  const recentSection = recentTracks.length
    ? `\n\n---\n\n## 這次已播過的歌曲（請勿重複選）\n\n` +
      recentTracks.map(t => `- ${t.title} — ${t.artist}`).join("\n")
    : "";

  const system =
    `${PERSONA}\n\n---\n\n` +
    `## 聽眾的音樂品味\n\n${TASTE}` +
    spotifySection +
    weatherSection +
    recentSection +
    `\n\n---\n\n` +
    `## 當前時段指引\n\n${PERIOD_TONE[period]}\n\n---\n\n` +
    `## 選歌規則\n\n` +
    `- 直接推薦一首具體的歌曲（歌名 + 歌手），不要推薦「類型」或「風格」\n` +
    `- 選你有把握真實存在、YouTube 上找得到的歌\n` +
    `- 古典音樂以外，優先選 10 分鐘以內的曲目\n` +
    `- 避免選不在聽眾品味範圍的歌手（如告五人、八三么）\n` +
    `- 蘇打綠只選 2020 年（含）之後發行的歌；2020 年以前的蘇打綠時期作品一律不選`;

  const userMessage = transition
    ? `現在是${period}（${clock}）。\n\n剛才一首歌結束了。請以 Claudio 的身份，寫一段自然銜接的播報詞，引導聽眾進入下一首歌的氛圍，然後選擇下一首歌。播報詞不要提到歌名，直接描述當下的感受與流動，像 DJ 在說話一樣自然。`
    : `現在是${period}（${clock}）。\n\n請以 Claudio 的身份，根據當下時段與聽眾品味，選擇最合適的一首歌，並寫開場播報詞。播報詞不要提到歌名，像電台 DJ 開播一樣，自然地描述當下的氛圍與心情。`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            say:    { type: "string", description: "播報詞，2-4 句話" },
            title:  { type: "string", description: "推薦歌曲的歌名" },
            artist: { type: "string", description: "推薦歌曲的歌手名" },
          },
          required: ["say", "title", "artist"],
          additionalProperties: false,
        },
      },
    },
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}
