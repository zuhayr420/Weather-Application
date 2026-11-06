/**
 * windCompass.js — wind direction dial for the current-conditions card.
 * Values come from the shared forecast payload; nothing extra is fetched.
 */
(() => {
  const container = document.getElementById("wind-compass-container");

  const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  function cardinal(degrees) {
    return POINTS[Math.round((degrees % 360) / 22.5) % 16];
  }

  function render(data) {
    const cur = data?.current;
    if (!container || !cur) return;

    const speed = cur.wind_speed_10m ?? 0;
    const gust = cur.wind_gusts_10m;
    const degrees = cur.wind_direction_10m ?? 0;
    const from = cardinal(degrees);
    const gusty = gust !== null && gust !== undefined && gust > speed + 8;

    container.innerHTML = `
      <div class="compass">
        <div class="compass-ring" role="img"
             aria-label="Wind from ${from} at ${Math.round(speed)} ${weatherService.windUnit()}">
          <span class="compass-point compass-n">N</span>
          <span class="compass-point compass-e">E</span>
          <span class="compass-point compass-s">S</span>
          <span class="compass-point compass-w">W</span>
          <div class="compass-needle" style="transform: translateX(-50%) rotate(${Math.round(degrees)}deg)"></div>
          <div class="compass-hub">
            <div class="compass-speed">${Math.round(speed)}</div>
            <div class="compass-unit">${weatherService.windUnit()}</div>
          </div>
        </div>
        <div class="compass-caption">
          From <strong>${from}</strong> · ${Math.round(degrees)}°
          ${gusty ? `<span class="muted small"> · gusts ${Math.round(gust)} ${weatherService.windUnit()}</span>` : ""}
        </div>
      </div>
    `;
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.data));
})();
