import { getRecommendation } from "../src/claude.js";

console.log("Claudio 正在選歌...\n");

const result = await getRecommendation();

console.log("播報詞：");
console.log(result.say);
console.log();
console.log(`🎵  ${result.track} — ${result.artist}`);
