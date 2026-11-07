import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeForecast,
  calculateHourRisk,
  heatIndexC,
  rankWindows,
  riskLevel
} from "../src/model.js";

const baseHour = {
  time: "2026-07-15T12:00",
  pm2_5: 6,
  ozone: 55,
  temperature_2m: 20,
  relative_humidity_2m: 50,
  apparent_temperature: 20,
  precipitation_probability: 5,
  wind_speed_10m: 8
};

test("risk levels map at the documented boundaries", () => {
  assert.equal(riskLevel(0).key, "low");
  assert.equal(riskLevel(24).key, "low");
  assert.equal(riskLevel(25).key, "moderate");
  assert.equal(riskLevel(50).key, "high");
  assert.equal(riskLevel(75).key, "severe");
});

test("clean conditions produce a low exposure score", () => {
  const risk = calculateHourRisk(baseHour, { activity: "commute", duration: 30, sensitivity: "none" });
  assert.ok(risk.risk < 20, `expected low risk, got ${risk.risk}`);
});

test("high pollution and exertion increase the score", () => {
  const clean = calculateHourRisk(baseHour, { activity: "commute", duration: 30, sensitivity: "none" });
  const polluted = calculateHourRisk({ ...baseHour, pm2_5: 40, ozone: 160 }, { activity: "running", duration: 60, sensitivity: "asthma" });
  assert.ok(polluted.risk > clean.risk + 45);
  assert.equal(polluted.level.key, "severe");
});

test("heat index rises with humidity", () => {
  assert.ok(heatIndexC(32, 80) > heatIndexC(32, 30));
  assert.ok(heatIndexC(32, 80) > 32);
});

test("window ranking rejects overlapping candidates", () => {
  const hours = Array.from({ length: 12 }, (_, i) => ({
    ...baseHour,
    time: `2026-07-15T${String(i).padStart(2, "0")}:00`,
    pm2_5: 6 + i
  }));
  const profile = { activity: "commute", duration: 30, sensitivity: "none" };
  const analyzed = hours.map(hour => calculateHourRisk(hour, profile));
  const windows = rankWindows(analyzed, profile, 3);
  assert.equal(windows.length, 3);
  assert.ok(Math.abs(windows[0].startIndex - windows[1].startIndex) >= 2);
});

test("best forecast window is better than the current window", () => {
  const hours = Array.from({ length: 24 }, (_, i) => ({
    ...baseHour,
    time: `2026-07-15T${String(i).padStart(2, "0")}:00`,
    pm2_5: i < 12 ? 38 : 5
  }));
  const result = analyzeForecast(hours, { activity: "cycling", duration: 30, sensitivity: "none" });
  assert.ok(result.best.risk < result.currentRisk);
  assert.ok(result.improvement > 0);
});
