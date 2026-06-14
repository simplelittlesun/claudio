# Claudio

Claudio 是一個 AI DJ 電台專案。Claude 根據時段、天氣與你的 Last.fm 聆聽紀錄直接推薦歌曲並寫播報詞，再從 YouTube 找到對應的影片播放，打造個人化的電台聆聽體驗。

## 設定

1. 複製 `.env` 並填入以下金鑰：
   ```
   ANTHROPIC_API_KEY=your_anthropic_api_key
   YOUTUBE_API_KEY=your_youtube_api_key
   LASTFM_API_KEY=your_lastfm_api_key
   LASTFM_USERNAME=your_lastfm_username
   ```

2. 安裝依賴：
   ```
   npm install
   ```

3. 啟動：
   ```
   npm start
   ```
