import { searchTrack } from "../src/kkbox.js";

console.log("搜尋「陳綺貞」...\n");

const results = await searchTrack("陳綺貞", 5);

results.forEach((track, i) => {
  console.log(`${i + 1}. ${track.title}`);
  console.log(`   歌手：${track.artist}`);
  console.log(`   專輯：${track.album}`);
  console.log(`   ID：${track.id}`);
  console.log(`   URL：${track.url}`);
  console.log();
});
