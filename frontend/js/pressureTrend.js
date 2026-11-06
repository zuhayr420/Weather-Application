/**
 * pressureTrend.js — 3-hour pressure tendency.
 * Rising pressure generally means improving weather, falling pressure means
 * unsettled weather on the way. Uses the hourly series already in memory.
 */
(() => {
  const container = document.getElementById("pressure-trend-content");

  const TRENDS = [
    { min: 1.5, name: "Rising rapidly", symbol: "↑↑", cls: "pt-up", outlook: "Improving conditions likely." },
    { min: 0.5, name: "Rising", symbol: "↑", cls: "pt-up", outlook: "Conditions should improve." },
    { min: -0.5, name: "Steady", symbol: "→", cls: "pt-steady", outlook: "Current conditions likely to persist." },
    { min: -1.5, name: "Falling", symbol: "↓", cls: "pt-down", outlook: "Deteriorating conditions possible." },
    { min: -Infinity, name: "Falling rapidly", symbol: "↓↓", cls: "pt-down", outlook: "Unsettled weather likely — expect changes." },
  ];

  function render(data) {
    if (!container) return;
    // Sea-level pressure, so it matches the pressure shown in the main card
    // (surface pressure is much lower at altitude and confuses the comparison).
    const series = data?.hourly?.pressure_msl || data?.hourly?.surface_pressure;
    if (!series?.length) {
      container.innerHTML = '<p class="muted small">Pressure data unavailable.</p>';
      return;
    }

    const index = weatherService.nowHourIndex(data);
    const current = series[index] ?? series[0];
    const threeHoursAgo = series[Math.max(0, index - 3)] ?? current;
    const delta = current - threeHoursAgo;
    const trend = TRENDS.find((t) => delta >= t.min);
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";

    container.innerHTML = `
      <div class="pt-row">
        <div class="pt-arrow ${trend.cls}" aria-hidden="true">${trend.symbol}</div>
        <div>
          <div class="pt-label">${trend.name}</div>
          <div class="pt-delta">${sign}${Math.abs(delta).toFixed(1)} hPa over 3 h · ${Math.round(current)} hPa now</div>
        </div>
      </div>
      <p class="pt-outlook">${trend.outlook}</p>
    `;
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.data));
})();
