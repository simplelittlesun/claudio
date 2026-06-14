import axios from "axios";

/* ── Weather cache（15 分鐘）── */
let _weatherCache = null;
let _weatherCacheAt = 0;

export async function getWeather() {
  if (_weatherCache && Date.now() - _weatherCacheAt < 15 * 60_000) return _weatherCache;
  try {
    const { data } = await axios.get("https://wttr.in/?format=j1", { timeout: 3000 });
    const c = data.current_condition?.[0];
    if (!c) return null;
    _weatherCache = {
      desc:     c.weatherDesc?.[0]?.value ?? "",
      tempC:    c.temp_C,
      humidity: c.humidity,
    };
    _weatherCacheAt = Date.now();
    console.log(`[weather] ${_weatherCache.desc} ${_weatherCache.tempC}°C`);
    return _weatherCache;
  } catch {
    return null;
  }
}
