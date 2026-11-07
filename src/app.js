import { loadForecast, makeSampleForecast, searchPlaces } from "./api.js";
import {
  ACTIVITY_OPTIONS,
  SENSITIVITY_OPTIONS,
  analyzeForecast,
  buildRecommendations,
  formatDay,
  formatHour,
  riskLevel
} from "./model.js";

const DEFAULT_LOCATION = {
  name: "Blacksburg",
  admin: "Virginia",
  country: "US",
  latitude: 37.23,
  longitude: -80.41,
  timezone: "America/New_York"
};

const els = {
  form: document.querySelector("#planner-form"),
  city: document.querySelector("#city"),
  suggestions: document.querySelector("#suggestions"),
  duration: document.querySelector("#duration"),
  sensitivity: document.querySelector("#sensitivity"),
  resultLocation: document.querySelector("#result-location"),
  riskScore: document.querySelector("#risk-score"),
  riskLevel: document.querySelector("#risk-level"),
  gauge: document.querySelector("#gauge"),
  verdict: document.querySelector("#verdict"),
  verdictDetail: document.querySelector("#verdict-detail"),
  dataState: document.querySelector("#data-state"),
  airScore: document.querySelector("#air-score"),
  heatScore: document.querySelector("#heat-score"),
  airBar: document.querySelector("#air-bar"),
  heatBar: document.querySelector("#heat-bar"),
  airDetail: document.querySelector("#air-detail"),
  heatDetail: document.querySelector("#heat-detail"),
  nowTemp: document.querySelector("#now-temp"),
  nowPm: document.querySelector("#now-pm"),
  nowOzone: document.querySelector("#now-ozone"),
  nowRain: document.querySelector("#now-rain"),
  demoBanner: document.querySelector("#demo-banner"),
  retryLive: document.querySelector("#retry-live"),
  planTitle: document.querySelector("#plan-title"),
  planSubtitle: document.querySelector("#plan-subtitle"),
  bestTime: document.querySelector("#best-time"),
  improvement: document.querySelector("#improvement"),
  bestWindowScore: document.querySelector("#best-window-score"),
  chart: document.querySelector("#risk-chart"),
  chartDesc: document.querySelector("#chart-desc"),
  windowList: document.querySelector("#window-list"),
  recommendationList: document.querySelector("#recommendation-list"),
  refresh: document.querySelector("#refresh"),
  copyPlan: document.querySelector("#copy-plan"),
  shareTop: document.querySelector("#share-top"),
  toast: document.querySelector("#toast"),
  whyToggle: document.querySelector("#why-toggle"),
  methodCopy: document.querySelector("#method-copy"),
  footerSource: document.querySelector("#footer-source")
};

let state = {
  location: DEFAULT_LOCATION,
  forecast: null,
  result: null,
  sample: false,
  loading: false,
  suggestions: [],
  profile: {
    activity: "commute",
    duration: 30,
    sensitivity: "none"
  }
};

let suggestTimer;
let requestController;
let toastTimer;

function readProfile() {
  const selectedActivity = els.form.querySelector('input[name="activity"]:checked');
  return {
    activity: selectedActivity?.value ?? "commute",
    duration: Number(els.duration.value) || 30,
    sensitivity: els.sensitivity.value || "none"
  };
}

function locationLabel(location) {
  return [location.name, location.admin || location.country].filter(Boolean).join(", ");
}

function setLoading(loading) {
  state.loading = loading;
  els.refresh.classList.toggle("loading", loading);
  els.refresh.disabled = loading;
  els.form.querySelector(".find-button").disabled = loading;
  if (loading) {
    els.dataState.innerHTML = "<span></span> Refreshing live forecast";
    els.dataState.classList.remove("sample");
    els.verdict.textContent = "Reading the next 24 hours…";
    els.verdictDetail.textContent = "We’ll compare pollutant dose, heat stress, and rain risk for your chosen activity.";
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function setProfileControls(profile) {
  const activity = els.form.querySelector(`input[name="activity"][value="${profile.activity}"]`)
    ?? els.form.querySelector('input[name="activity"][value="commute"]');
  if (activity) activity.checked = true;
  els.duration.value = String(profile.duration || 30);
  els.sensitivity.value = profile.sensitivity || "none";
}

async function geocodeCity(query) {
  const places = await searchPlaces(query);
  if (!places.length) throw new Error("I couldn’t find that place. Try a nearby city and state.");
  return places[0];
}

async function loadPlan({ useLocation = false, allowSample = true } = {}) {
  requestController?.abort();
  requestController = new AbortController();
  const { signal } = requestController;
  setLoading(true);
  state.profile = readProfile();
  els.demoBanner.hidden = true;

  try {
    let location = state.location;
    if (!useLocation) {
      const query = els.city.value.trim();
      location = await geocodeCity(query);
    }
    const forecast = await loadForecast(location, signal);
    if (signal.aborted) return;
    state.location = location;
    state.forecast = forecast;
    state.sample = false;
    renderPlan();
    syncUrl();
  } catch (error) {
    if (error.name === "AbortError") return;
    if (!allowSample) {
      showToast(error.message || "Live data is unavailable.");
      return;
    }
    state.forecast = makeSampleForecast(state.location);
    state.sample = true;
    renderPlan();
    els.demoBanner.hidden = false;
    els.dataState.classList.add("sample");
    els.dataState.innerHTML = "<span></span> Sample scenario — live API unavailable";
    els.footerSource.textContent = "Sample scenario shown. Live source: Open-Meteo.";
  } finally {
    if (!signal.aborted) setLoading(false);
  }
}

function renderPlan() {
  if (!state.forecast) return;
  const result = analyzeForecast(state.forecast.hours.slice(0, 48), state.profile);
  state.result = result;
  if (!result.current || !result.best) return;

  els.resultLocation.textContent = locationLabel(state.location);
  els.riskScore.textContent = String(result.currentRisk);
  els.riskLevel.textContent = result.current.level.label;
  els.gauge.style.setProperty("--progress", `${result.currentRisk * 3.6}deg`);
  const levelSentence = {
    low: "Good conditions for your plan.",
    moderate: "A decent window—with a few tradeoffs.",
    high: "Consider moving this activity.",
    severe: "Delay or shorten outdoor activity."
  };
  els.verdict.textContent = levelSentence[result.current.level.key];
  els.verdictDetail.textContent = `${ACTIVITY_OPTIONS[state.profile.activity].label} · ${state.profile.duration} minutes · ${SENSITIVITY_OPTIONS[state.profile.sensitivity].label.toLowerCase()}.`;

  const air = Math.round(result.current.components.air || 0);
  const heat = Math.round(result.current.components.heat || 0);
  els.airScore.textContent = String(air);
  els.heatScore.textContent = String(heat);
  els.airBar.style.width = `${Math.min(100, air)}%`;
  els.heatBar.style.width = `${Math.min(100, heat)}%`;
  els.airDetail.textContent = dominantAirDetail(result.current);
  els.heatDetail.textContent = `Feels ${Math.round(result.current.apparentHeat)}°C`;

  els.nowTemp.textContent = `${Math.round(Number(result.current.temperature_2m) || 0)}°C`;
  els.nowPm.textContent = `${Math.round(Number(result.current.pm2_5) || 0)} µg/m³`;
  els.nowOzone.textContent = `${Math.round(Number(result.current.ozone) || 0)} µg/m³`;
  els.nowRain.textContent = `${Math.round(Number(result.current.precipitation_probability) || 0)}%`;

  const best = result.best;
  const activity = ACTIVITY_OPTIONS[state.profile.activity];
  if (result.improvement > 0) {
    const daySuffix = daySuffixForWindow(best.time, result.analyzed[0].time);
    els.planTitle.textContent = `Move your ${activity.short.toLowerCase()} to ${formatHour(best.time)}${daySuffix}.`;
    els.planSubtitle.textContent = `That window is the lowest combined air, heat, and weather exposure in the next 24 hours for a ${state.profile.duration}-minute session.`;
  } else {
    els.planTitle.textContent = `Go now—this is already a strong window.`;
    els.planSubtitle.textContent = `The next ${state.profile.duration} minutes are essentially tied with the best window in the forecast.`;
  }
  els.bestTime.textContent = compactTimeRange(best.time, best.endTime);
  els.improvement.textContent = `${result.improvement}%`;
  els.bestWindowScore.textContent = `${best.risk}/100`;

  els.dataState.innerHTML = state.sample
    ? "<span></span> Sample scenario — live API unavailable"
    : `<span></span> Live Open-Meteo data · updated ${new Date(state.forecast.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  els.dataState.classList.toggle("sample", state.sample);
  els.chartDesc.textContent = `From ${formatHour(result.analyzed[0].time)} to ${formatHour(result.analyzed[23]?.time || result.analyzed.at(-1).time)}. The lowest-risk suggested window is ${formatHour(best.time)} to ${formatHour(best.endTime, true)}, with a score of ${best.risk} out of 100.`;
  els.footerSource.textContent = state.sample
    ? "Sample scenario shown. Live source: Open-Meteo."
    : `Live forecast from ${state.forecast.source}. Planning aid only; check local alerts.`;

  renderChart(result.analyzed.slice(0, 24), best);
  renderWindows(result.windows);
  renderRecommendations(buildRecommendations(result, state.profile));
}

function compactTimeRange(startIso, endIso) {
  const start = formatHour(startIso).replace(":00", "");
  const end = formatHour(endIso, true).replace(":00", "");
  const startPeriod = start.split(" ").at(-1);
  const endPeriod = end.split(" ").at(-1);
  if (startPeriod === endPeriod) return `${start.slice(0, -(startPeriod.length + 1))}–${end}`;
  return `${start}–${end}`;
}

function daySuffixForWindow(windowIso, currentIso) {
  const windowDay = new Date(windowIso);
  const currentDay = new Date(currentIso);
  if (Number.isNaN(windowDay.getTime()) || Number.isNaN(currentDay.getTime())) return "";
  windowDay.setHours(0, 0, 0, 0);
  currentDay.setHours(0, 0, 0, 0);
  const dayDifference = Math.round((windowDay - currentDay) / 86400000);
  if (dayDifference === 0) return "";
  if (dayDifference === 1) return " tomorrow";
  return ` on ${formatDay(windowIso)}`;
}

function dominantAirDetail(hour) {
  const pm = Number(hour.pm2_5) || 0;
  const ozone = Number(hour.ozone) || 0;
  if (pm >= 20 && ozone >= 120) return "PM2.5 + ozone elevated";
  if (ozone > pm * 2) return "Ozone is the main driver";
  if (pm >= 15) return "Fine particles are elevated";
  return "PM2.5 + ozone";
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function renderChart(hours, best) {
  if (!hours.length) return;
  const title = els.chart.querySelector("title");
  const desc = els.chart.querySelector("desc");
  els.chart.replaceChildren(title, desc);
  const width = 1000;
  const height = 280;
  const left = 42;
  const right = 976;
  const top = 18;
  const bottom = 235;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const x = i => left + (i / Math.max(1, hours.length - 1)) * plotWidth;
  const y = score => bottom - (score / 100) * plotHeight;

  const defs = svgEl("defs");
  const gradient = svgEl("linearGradient", { id: "riskGradient", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.append(
    svgEl("stop", { offset: "0%", "stop-color": "#177b68", "stop-opacity": ".28" }),
    svgEl("stop", { offset: "100%", "stop-color": "#177b68", "stop-opacity": ".015" })
  );
  defs.append(gradient);
  els.chart.append(defs);

  [0, 25, 50, 75, 100].forEach(score => {
    const line = svgEl("line", { x1: left, y1: y(score), x2: right, y2: y(score), class: "grid-line" });
    const label = svgEl("text", { x: 0, y: y(score) + 4, class: "axis-label" });
    label.textContent = String(score);
    els.chart.append(line, label);
  });

  if (best && best.startIndex < hours.length) {
    const start = Math.max(0, best.startIndex);
    const end = Math.min(hours.length - 1, best.endIndex);
    els.chart.append(svgEl("rect", {
      x: x(start) - 8,
      y: top,
      width: Math.max(18, x(end) - x(start) + 16),
      height: plotHeight,
      rx: 11,
      class: "best-band"
    }));
  }

  const points = hours.map((hour, i) => `${x(i)},${y(hour.risk)}`).join(" ");
  const areaPoints = `${left},${bottom} ${points} ${right},${bottom}`;
  els.chart.append(svgEl("polygon", { points: areaPoints, class: "risk-area" }));
  els.chart.append(svgEl("polyline", { points, class: "risk-line" }));

  hours.forEach((hour, i) => {
    const dot = svgEl("circle", {
      cx: x(i), cy: y(hour.risk), r: i % 3 === 0 ? 5 : 3.7,
      fill: hour.level.color, class: "risk-dot"
    });
    const tooltip = svgEl("title");
    tooltip.textContent = `${formatHour(hour.time)}: ${hour.risk}/100 ${hour.level.label} risk · PM2.5 ${Math.round(hour.pm2_5)} µg/m³ · feels ${Math.round(hour.apparentHeat)}°C`;
    dot.append(tooltip);
    els.chart.append(dot);
  });

  [0, 6, 12, 18, 23].filter(i => hours[i]).forEach(i => {
    const label = svgEl("text", {
      x: x(i),
      y: 265,
      class: "axis-label",
      "text-anchor": i === 0 ? "start" : i === 23 ? "end" : "middle"
    });
    label.textContent = formatHour(hours[i].time);
    els.chart.append(label);
  });
}

function renderWindows(windows) {
  els.windowList.replaceChildren();
  if (!windows.length) return;
  windows.forEach((window, index) => {
    const item = document.createElement("div");
    item.className = "window-item";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `${formatHour(window.time)}–${formatHour(window.endTime, true)} · ${formatDay(window.time)}`;
    const detail = document.createElement("p");
    detail.textContent = `${window.avgAir} µg/m³ PM2.5 · feels ${Math.round(window.temp)}°C${index === 0 ? " · best fit" : ""}`;
    copy.append(title, detail);
    const score = document.createElement("div");
    score.className = "window-score";
    const strong = document.createElement("strong");
    strong.textContent = String(window.risk);
    strong.style.color = window.level.color;
    const span = document.createElement("span");
    span.textContent = window.level.label;
    score.append(strong, span);
    item.append(copy, score);
    els.windowList.append(item);
  });
}

function renderRecommendations(recommendations) {
  els.recommendationList.replaceChildren();
  recommendations.forEach((recommendation, index) => {
    const item = document.createElement("div");
    item.className = "playbook-item";
    const icon = document.createElement("span");
    icon.textContent = recommendation.icon;
    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = recommendation.title;
    const body = document.createElement("p");
    body.textContent = recommendation.body;
    content.append(title, body);
    item.append(icon, content);
    els.recommendationList.append(item);
  });
}

function planText() {
  if (!state.result) return "";
  const result = state.result;
  const lines = [
    `BreathWindow plan — ${locationLabel(state.location)}`,
    `${ACTIVITY_OPTIONS[state.profile.activity].label}, ${state.profile.duration} min, ${SENSITIVITY_OPTIONS[state.profile.sensitivity].label}`,
    `Current exposure: ${result.currentRisk}/100 (${result.current.level.label})`,
    `Best window: ${formatHour(result.best.time)}–${formatHour(result.best.endTime, true)} · ${result.best.risk}/100`,
    `Potential exposure reduction: ${result.improvement}%`,
    "",
    ...buildRecommendations(result, state.profile).map(item => `• ${item.title} ${item.body}`),
    "",
    "Planning aid only. Check local public-health alerts."
  ];
  return lines.join("\n");
}

async function copy(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast(message);
  }
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set("place", locationLabel(state.location));
  params.set("lat", Number(state.location.latitude).toFixed(4));
  params.set("lon", Number(state.location.longitude).toFixed(4));
  params.set("activity", state.profile.activity);
  params.set("duration", String(state.profile.duration));
  params.set("sensitivity", state.profile.sensitivity);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function renderSuggestions(places) {
  state.suggestions = places;
  els.suggestions.replaceChildren();
  if (!places.length) {
    els.suggestions.hidden = true;
    return;
  }
  places.forEach(place => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.textContent = place.name;
    const meta = document.createElement("small");
    meta.textContent = [place.admin, place.country].filter(Boolean).join(", ");
    button.append(meta);
    button.addEventListener("click", () => {
      state.location = place;
      els.city.value = locationLabel(place);
      els.suggestions.hidden = true;
      loadPlan({ useLocation: true });
    });
    els.suggestions.append(button);
  });
  els.suggestions.hidden = false;
}

async function fetchSuggestions(query) {
  try {
    const places = await searchPlaces(query);
    if (els.city.value.trim() === query.trim()) renderSuggestions(places);
  } catch {
    els.suggestions.hidden = true;
  }
}

els.form.addEventListener("submit", event => {
  event.preventDefault();
  els.suggestions.hidden = true;
  loadPlan();
});

for (const control of [els.duration, els.sensitivity]) {
  control.addEventListener("change", () => {
    state.profile = readProfile();
    renderPlan();
    syncUrl();
  });
}
for (const radio of els.form.querySelectorAll('input[name="activity"]')) {
  radio.addEventListener("change", () => {
    state.profile = readProfile();
    renderPlan();
    syncUrl();
  });
}

els.city.addEventListener("input", () => {
  clearTimeout(suggestTimer);
  const query = els.city.value.trim();
  if (query.length < 2) {
    els.suggestions.hidden = true;
    return;
  }
  suggestTimer = setTimeout(() => fetchSuggestions(query), 300);
});
els.city.addEventListener("keydown", event => {
  if (event.key === "Escape") els.suggestions.hidden = true;
});

document.querySelectorAll("[data-place]").forEach(button => {
  button.addEventListener("click", () => {
    els.city.value = button.dataset.place;
    loadPlan();
  });
});

els.refresh.addEventListener("click", () => loadPlan({ useLocation: true, allowSample: false }));
els.retryLive.addEventListener("click", () => loadPlan({ useLocation: true, allowSample: false }));
els.copyPlan.addEventListener("click", () => copy(planText(), "Plan copied"));
els.shareTop.addEventListener("click", () => copy(location.href, "Share link copied"));
els.whyToggle.addEventListener("click", () => {
  const expanded = els.whyToggle.getAttribute("aria-expanded") === "true";
  els.whyToggle.setAttribute("aria-expanded", String(!expanded));
  els.methodCopy.hidden = expanded;
  els.whyToggle.querySelector("span").textContent = expanded ? "+" : "−";
});

function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has("lat") || !params.has("lon")) return false;
  state.location = {
    name: params.get("place")?.split(",")[0] || "Shared location",
    admin: params.get("place")?.split(",").slice(1).join(",").trim() || "",
    country: "",
    latitude: Number(params.get("lat")),
    longitude: Number(params.get("lon")),
    timezone: "auto"
  };
  els.city.value = params.get("place") || locationLabel(state.location);
  state.profile = {
    activity: params.get("activity") || "commute",
    duration: Number(params.get("duration")) || 30,
    sensitivity: params.get("sensitivity") || "none"
  };
  setProfileControls(state.profile);
  if (params.get("demo") === "1") {
    state.forecast = makeSampleForecast(state.location);
    state.sample = true;
    renderPlan();
    els.demoBanner.hidden = false;
  } else {
    loadPlan({ useLocation: true });
  }
  return true;
}

if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

if (!restoreFromUrl()) {
  loadPlan({ useLocation: true });
}
