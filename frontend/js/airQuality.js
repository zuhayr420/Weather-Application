/**
 * airQuality.js — Air Quality panel.
 * Data: Open-Meteo Air Quality API (keyless, CORS-enabled), fetched directly
 * from the browser. Values are the current hour's US AQI plus pollutants.
 */
(() => {
  const container = document.getElementById("aqi-content");

  const SCALE = [
    { max: 50, label: "Good", color: "#16a34a", ink: "#ffffff", advice: "Air quality is satisfactory and poses little or no risk." },
    { max: 100, label: "Moderate", color: "#facc15", ink: "#422006", advice: "Acceptable for most people; sensitive groups may notice mild effects." },
    { max: 150, label: "Unhealthy for sensitive groups", color: "#ea580c", ink: "#ffffff", advice: "Sensitive groups should limit prolonged outdoor exertion." },
    { max: 200, label: "Unhealthy", color: "#dc2626", ink: "#ffffff", advice: "Everyone may feel effects — reduce time outdoors and exertion." },
    { max: 300, label: "Very unhealthy", color: "#9333ea", ink: "#ffffff", advice: "Health alert: avoid outdoor activity where possible." },
    { max: Infinity, label: "Hazardous", color: "#7f1d1d", ink: "#ffffff", advice: "Emergency conditions — stay indoors and filter indoor air." },
  ];

  function category(aqi) {
    return SCALE.find((band) => aqi <= band.max);
  }

  function pollutant(label, value, unit = "µg/m³") {
    if (value === null || value === undefined) return "";
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return `<div class="aq-pollutant"><span>${label}</span><span>${rounded} ${unit}</span></div>`;
  }

  function peakHour(aqiData) {
    const hourly = aqiData.hourly;
    if (!hourly?.us_aqi?.length) return "";
    const start = weatherService.nowHourIndex(aqiData);
    const window = hourly.us_aqi.slice(start, start + 12);
    const values = window.filter((v) => v !== null && v !== undefined);
    if (!values.length) return "";
    const peak = Math.max(...values);
    const index = start + window.indexOf(peak);
    if (peak <= (aqiData.current?.us_aqi ?? peak)) return "Air quality should stay steady or improve over the next 12 hours.";
    return `Air quality peaks around ${weatherService.formatClock(hourly.time[index])} at AQI ${Math.round(peak)}.`;
  }

  let requestToken = 0;

  async function render(location) {
    if (!container || !location) return;
    const token = ++requestToken;
    container.innerHTML = '<p class="muted small">Loading air quality…</p>';

    try {
      const data = await weatherService.fetchAirQuality(location.lat, location.lon);
      if (token !== requestToken) return;

      const current = data.current || {};
      const aqi = current.us_aqi ?? current.european_aqi;
      if (aqi === null || aqi === undefined) {
        container.innerHTML = '<p class="muted small">No air quality data for this location.</p>';
        return;
      }

      const band = category(aqi);
      const pct = Math.min(100, Math.max(2, (aqi / 300) * 100));
      const european = current.european_aqi;

      container.innerHTML = `
        <div class="aq-hero">
          <div class="aq-number" style="background:${band.color};color:${band.ink}">${Math.round(aqi)}</div>
          <div>
            <div class="aq-category">${band.label}</div>
            <div class="muted small">US AQI${european !== null && european !== undefined ? ` · European AQI ${Math.round(european)}` : ""}</div>
          </div>
        </div>
        <div class="aq-track" role="img" aria-label="Air quality index ${Math.round(aqi)} out of 300">
          <div class="aq-fill" style="width:${pct}%;background:${band.color}"></div>
        </div>
        <div class="aq-pollutants">
          ${pollutant("PM2.5", current.pm2_5)}
          ${pollutant("PM10", current.pm10)}
          ${pollutant("Ozone (O₃)", current.ozone)}
          ${pollutant("NO₂", current.nitrogen_dioxide)}
          ${pollutant("SO₂", current.sulphur_dioxide)}
          ${pollutant("CO", current.carbon_monoxide)}
        </div>
        <p class="summary-text"><i class="ph ph-heart" aria-hidden="true"></i> ${band.advice}</p>
        <p class="summary-text muted small">${peakHour(data)}</p>
      `;
    } catch (err) {
      if (token !== requestToken) return;
      console.error("Air quality failed", err);
      container.innerHTML = '<p class="muted small">Air quality data is unavailable right now.</p>';
    }
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.location));
})();
