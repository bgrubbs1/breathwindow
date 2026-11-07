const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Forecast service returned ${response.status}`);
  return response.json();
}

export async function searchPlaces(query, signal) {
  if (!query || query.trim().length < 2) return [];
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("name", query.trim());
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const data = await fetchJson(url, signal);
  return (data.results ?? []).map(place => ({
    id: `${place.latitude},${place.longitude}`,
    name: place.name,
    admin: place.admin1 ?? "",
    country: place.country_code ?? place.country ?? "",
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone
  }));
}

export async function loadForecast(location, signal) {
  const weather = new URL(WEATHER_URL);
  weather.searchParams.set("latitude", location.latitude);
  weather.searchParams.set("longitude", location.longitude);
  weather.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m");
  weather.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m");
  weather.searchParams.set("timezone", "auto");
  weather.searchParams.set("forecast_days", "3");

  const air = new URL(AIR_URL);
  air.searchParams.set("latitude", location.latitude);
  air.searchParams.set("longitude", location.longitude);
  air.searchParams.set("hourly", "pm2_5,pm10,ozone,nitrogen_dioxide,uv_index");
  air.searchParams.set("current", "pm2_5,pm10,ozone,nitrogen_dioxide,uv_index");
  air.searchParams.set("timezone", "auto");
  air.searchParams.set("forecast_days", "3");

  const [weatherData, airData] = await Promise.all([
    fetchJson(weather, signal),
    fetchJson(air, signal)
  ]);
  const airByTime = new Map((airData.hourly?.time ?? []).map((time, i) => [time, {
    pm2_5: airData.hourly.pm2_5?.[i],
    pm10: airData.hourly.pm10?.[i],
    ozone: airData.hourly.ozone?.[i],
    nitrogen_dioxide: airData.hourly.nitrogen_dioxide?.[i],
    uv_index: airData.hourly.uv_index?.[i]
  }]));
  const now = weatherData.current?.time ?? weatherData.hourly?.time?.[0];
  const hours = [];
  (weatherData.hourly?.time ?? []).forEach((time, i) => {
    if (time < now) return;
    const airHour = airByTime.get(time) ?? {};
    hours.push({
      time,
      temperature_2m: weatherData.hourly.temperature_2m?.[i],
      relative_humidity_2m: weatherData.hourly.relative_humidity_2m?.[i],
      apparent_temperature: weatherData.hourly.apparent_temperature?.[i],
      precipitation_probability: weatherData.hourly.precipitation_probability?.[i],
      weather_code: weatherData.hourly.weather_code?.[i],
      wind_speed_10m: weatherData.hourly.wind_speed_10m?.[i],
      ...airHour
    });
  });
  if (hours.length < 12) throw new Error("Not enough forecast data for a useful plan");
  return {
    location,
    current: weatherData.current,
    utcOffsetSeconds: weatherData.utc_offset_seconds,
    hours: hours.slice(0, 48),
    fetchedAt: new Date().toISOString(),
    source: "Open-Meteo weather + air quality"
  };
}

export function makeSampleForecast(location = {
  name: "Blacksburg", admin: "Virginia", country: "US", latitude: 37.23, longitude: -80.41, timezone: "America/New_York"
}) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const hours = Array.from({ length: 48 }, (_, i) => {
    const date = new Date(now.getTime() + i * 3600_000);
    const localHour = date.getHours();
    const rush = localHour >= 7 && localHour <= 9 || localHour >= 16 && localHour <= 19;
    const afternoon = localHour >= 12 && localHour <= 17;
    const daylight = localHour >= 7 && localHour <= 19;
    return {
      time: toLocalIso(date),
      temperature_2m: 14 + Math.max(0, Math.sin((localHour - 8) / 13 * Math.PI)) * 10,
      relative_humidity_2m: 68 - Math.max(0, Math.sin((localHour - 8) / 13 * Math.PI)) * 24,
      apparent_temperature: 14 + Math.max(0, Math.sin((localHour - 8) / 13 * Math.PI)) * 11,
      precipitation_probability: localHour === 18 ? 45 : localHour === 19 ? 30 : 8,
      weather_code: daylight ? 1 : 0,
      wind_speed_10m: 7 + (rush ? 3 : 0),
      pm2_5: 7 + (rush ? 7 : 0) + (i > 18 && i < 24 ? 6 : 0),
      pm10: 13 + (rush ? 8 : 0),
      ozone: 54 + (afternoon ? 34 : 0),
      nitrogen_dioxide: 16 + (rush ? 14 : 0),
      uv_index: daylight ? Math.max(0, Math.sin((localHour - 7) / 12 * Math.PI)) * 4 : 0
    };
  });
  return {
    location,
    current: { time: hours[0].time, temperature_2m: hours[0].temperature_2m },
    utcOffsetSeconds: -18000,
    hours,
    fetchedAt: now.toISOString(),
    source: "Sample scenario"
  };
}

function toLocalIso(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}
