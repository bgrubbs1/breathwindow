export const ACTIVITY_OPTIONS = {
  commute: { label: "Walking commute", short: "Commute", ventilation: 12 },
  cycling: { label: "Cycling", short: "Cycle", ventilation: 24 },
  running: { label: "Running", short: "Run", ventilation: 42 },
  work: { label: "Outdoor work", short: "Work", ventilation: 18 }
};

export const SENSITIVITY_OPTIONS = {
  none: { label: "No extra sensitivity", multiplier: 1 },
  asthma: { label: "Asthma or reactive airway", multiplier: 1.4 },
  heartlung: { label: "Heart or lung condition", multiplier: 1.5 },
  older: { label: "Older adult (65+)", multiplier: 1.3 },
  child: { label: "Child under 12", multiplier: 1.25 }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function heatIndexC(tempC, humidity) {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidity)) return tempC;
  const t = tempC * 9 / 5 + 32;
  const rh = clamp(humidity, 1, 100);
  let hi = 0.5 * (t + 61 + ((t - 68) * 1.2) + (rh * 0.094));
  if (hi >= 80) {
    hi = -42.379 + 2.04901523 * t + 10.141331 * rh
      - 0.22475541 * t * rh - 0.00683783 * t * t
      - 0.05481717 * rh * rh + 0.00122874 * t * t * rh
      + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
    if (rh < 13 && t >= 80 && t <= 112) {
      hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (rh > 85 && t >= 80 && t <= 87) {
      hi += ((rh - 85) / 10) * ((87 - t) / 5);
    }
  }
  return (hi - 32) * 5 / 9;
}

export function riskLevel(score) {
  if (score >= 75) return { key: "severe", label: "Severe", color: "#d94b3d" };
  if (score >= 50) return { key: "high", label: "High", color: "#e47a31" };
  if (score >= 25) return { key: "moderate", label: "Moderate", color: "#c1a72e" };
  return { key: "low", label: "Low", color: "#177b68" };
}

export function calculateHourRisk(hour, profile) {
  const activity = ACTIVITY_OPTIONS[profile.activity] ?? ACTIVITY_OPTIONS.commute;
  const sensitivity = SENSITIVITY_OPTIONS[profile.sensitivity] ?? SENSITIVITY_OPTIONS.none;
  const minutes = clamp(Number(profile.duration) || 30, 10, 180);
  const exposureScale = (activity.ventilation / 15) * (minutes / 30);
  const pm25 = Math.max(0, Number(hour.pm2_5) || 0);
  const ozone = Math.max(0, Number(hour.ozone) || 0);
  const temp = Number(hour.temperature_2m);
  const humidity = Number(hour.relative_humidity_2m);
  const apparent = Number.isFinite(temp) && Number.isFinite(humidity)
    ? heatIndexC(temp, humidity)
    : Number(hour.apparent_temperature) || 20;
  const rain = clamp(Number(hour.precipitation_probability) || 0, 0, 100);
  const wind = Math.max(0, Number(hour.wind_speed_10m) || 0);

  const pmScore = clamp((pm25 / 35) * 45 * exposureScale, 0, 58);
  const ozoneScore = clamp(((ozone - 60) / 120) * 35 * exposureScale, 0, 48);
  const heatScore = clamp(((apparent - 25) / 15) * 30, 0, 38);
  const weatherScore = rain * 0.075 + (wind > 30 ? Math.min((wind - 30) * 0.7, 10) : 0);
  const raw = pmScore + ozoneScore + heatScore + weatherScore;
  const score = Math.round(clamp(raw * sensitivity.multiplier, 0, 100));
  const components = {
    air: Math.round(pmScore + ozoneScore),
    heat: Math.round(heatScore),
    weather: Math.round(weatherScore)
  };
  const dominant = Object.entries(components).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "air";

  return {
    ...hour,
    risk: score,
    level: riskLevel(score),
    apparentHeat: apparent,
    components,
    dominant
  };
}

export function analyzeHours(hours, profile) {
  return hours.map(hour => calculateHourRisk(hour, profile));
}

export function rankWindows(analyzed, profile, count = 3) {
  const minutes = Number(profile.duration) || 30;
  const hoursNeeded = Math.max(1, Math.ceil(minutes / 60));
  if (!analyzed.length) return [];
  const candidates = [];
  for (let i = 0; i <= analyzed.length - hoursNeeded; i++) {
    const slice = analyzed.slice(i, i + hoursNeeded);
    const risk = Math.round(slice.reduce((sum, h) => sum + h.risk, 0) / slice.length);
    const avgAir = slice.reduce((sum, h) => sum + (Number(h.pm2_5) || 0), 0) / slice.length;
    candidates.push({
      startIndex: i,
      endIndex: i + hoursNeeded - 1,
      time: slice[0].time,
      endTime: addMinutes(slice[0].time, minutes),
      risk,
      level: riskLevel(risk),
      avgAir: Math.round(avgAir),
      temp: slice[0].apparentHeat
    });
  }
  candidates.sort((a, b) => a.risk - b.risk || a.startIndex - b.startIndex);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(item => Math.abs(item.startIndex - candidate.startIndex) >= 2)) {
      selected.push(candidate);
    }
    if (selected.length === count) break;
  }
  return selected.sort((a, b) => a.risk - b.risk || a.startIndex - b.startIndex);
}

export function addMinutes(iso, minutes) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setMinutes(date.getMinutes() + minutes);
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function analyzeForecast(hours, profile) {
  const analyzed = analyzeHours(hours, profile);
  const hoursNeeded = Math.max(1, Math.ceil((Number(profile.duration) || 30) / 60));
  const currentSlice = analyzed.slice(0, hoursNeeded);
  const currentRisk = currentSlice.length
    ? Math.round(currentSlice.reduce((sum, h) => sum + h.risk, 0) / currentSlice.length)
    : 0;
  const windows = rankWindows(analyzed, profile, 3);
  const best = windows.reduce((winner, item) => !winner || item.risk < winner.risk ? item : winner, null);
  const improvement = best && currentRisk > 0
    ? Math.max(0, Math.round(((currentRisk - best.risk) / currentRisk) * 100))
    : 0;
  const current = analyzed[0] ?? null;
  return { analyzed, windows, best, currentRisk, current, improvement };
}

export function buildRecommendations(result, profile) {
  if (!result?.best || !result?.current) return [];
  const { best, currentRisk, improvement } = result;
  const activity = ACTIVITY_OPTIONS[profile.activity] ?? ACTIVITY_OPTIONS.commute;
  const minutes = Number(profile.duration) || 30;
  const moveLabel = best.risk < currentRisk
    ? `Shift your ${minutes}-minute ${activity.short.toLowerCase()} to ${formatHour(best.time)}–${formatHour(best.endTime, true)}.`
    : `Your current window is already among the cleanest in the next 24 hours.`;
  const recommendations = [{
    icon: "↗",
    title: moveLabel,
    body: best.risk < currentRisk
      ? `Estimated exposure drops ${improvement}% versus starting now. ${best.avgAir} µg/m³ average PM2.5 in the suggested window.`
      : `Current risk is ${currentRisk}/100. Keep the session easy and monitor symptoms.`
  }];

  if ((result.current.components.air || 0) > 30) {
    recommendations.push({
      icon: "◌",
      title: "Put distance between you and traffic.",
      body: "Choose a side street or park path away from idling vehicles. Tailpipe pollution can fall quickly only a few metres from the curb."
    });
  }
  if ((result.current.components.heat || 0) > 12) {
    recommendations.push({
      icon: "☀",
      title: "Lower the heat load.",
      body: "Carry water, start with the shaded half of the route, and reduce pace if the apparent temperature is above 27°C."
    });
  }
  if ((result.current.components.weather || 0) > 20) {
    recommendations.push({
      icon: "☂",
      title: "Avoid the wettest hour.",
      body: "Rain raises slip and visibility risk. The ranked windows already penalize high precipitation probability."
    });
  }
  if (recommendations.length < 3) {
    recommendations.push({
      icon: "✓",
      title: "Make the plan portable.",
      body: "Use Share plan to save a compact link, or Print plan for a no-account copy you can keep offline."
    });
  }
  return recommendations.slice(0, 3);
}

export function formatHour(iso, end = false) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatDay(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function scoreGradient(score) {
  const safe = riskLevel(score);
  const pct = clamp(score, 0, 100);
  return `conic-gradient(${safe.color} 0 ${pct}%, rgba(17, 37, 32, .10) ${pct}% 100%)`;
}
