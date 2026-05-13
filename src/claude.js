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
const TASTE = readFileSync(join(__dirname, "../user/taste.md"), "utf-8");

function timeOfDay() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "早晨";
  if (h >= 12 && h < 18) return "下午";
  if (h >= 18 && h < 22) return "傍晚";
  return "深夜";
}

export async function getRecommendation(moodStations = []) {
  const period = timeOfDay();
  const clock = new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const stationList = moodStations
    .map((s) => `- ${s.id}：${s.title}`)
    .join("\n");

  const system = `${PERSONA}\n\n---\n\n## 聽眾的音樂品味\n\n${TASTE}`;

  const userMessage =
    `現在是${period}（${clock}）。\n\n` +
    `以下是可選的 KKBOX Mood Station 清單：\n${stationList}\n\n` +
    `請以 Claudio 的身份，根據當下時段與聽眾品味，選擇最合適的一個 Mood Station，並寫播報詞。` +
    `播報詞不要提到 Mood Station 的名稱，只要像電台 DJ 一樣自然地描述當下的氛圍與心情。`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            say:        { type: "string", description: "播報詞，2-4 句話" },
            station_id: { type: "string", description: "選擇的 Mood Station ID" },
          },
          required: ["say", "station_id"],
          additionalProperties: false,
        },
      },
    },
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}
