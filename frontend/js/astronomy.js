/**
 * astronomy.js — Sun & Moon panel.
 * Sun times come from Open-Meteo's daily block (location-local wall clock);
 * moon phase is calculated locally, so this panel needs no extra request.
 */
(() => {
  const container = document.getElementById("astro-content");

  function minutesOfDay(iso) {
    const [, time = "0:0"] = String(iso).split("T");
    const [h, m] = time.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function shiftClock(iso, minutes) {
    const [date] = String(iso).split("T");
    let total = minutesOfDay(iso) + minutes;
    total = ((total % 1440) + 1440) % 1440;
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${date}T${hh}:${mm}`;
  }

  function moonPhase(date) {
    const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
    const days = (date.getTime() - knownNewMoon) / 86400000;
    const phase = ((days % 29.530588) + 29.530588) % 29.530588;
    const illumination = Math.round(((1 - Math.cos((2 * Math.PI * phase) / 29.530588)) / 2) * 100);
    const table = [
      [1.85, "New Moon", "🌑"],
      [5.53, "Waxing Crescent", "🌒"],
      [9.22, "First Quarter", "🌓"],
      [12.91, "Waxing Gibbous", "🌔"],
      [16.61, "Full Moon", "🌕"],
      [20.3, "Waning Gibbous", "🌖"],
      [23.99, "Last Quarter", "🌗"],
      [27.68, "Waning Crescent", "🌘"],
      [Infinity, "New Moon", "🌑"],
    ];
    const [, name, emoji] = table.find(([max]) => phase < max);
    return { name, emoji, illumination };
  }

  function sunArc(sunrise, sunset, nowMinutes, isDay) {
    const startMin = minutesOfDay(sunrise);
    const endMin = minutesOfDay(sunset);
    const progress = Math.max(0, Math.min(1, (nowMinutes - startMin) / Math.max(1, endMin - startMin)));
    const angle = Math.PI - progress * Math.PI;
    const cx = 150;
    const cy = 120;
    const r = 100;
    const x = (cx + r * Math.cos(angle)).toFixed(1);
    const y = (cy - r * Math.sin(angle)).toFixed(1);

    return `
      <svg viewBox="0 0 300 148" class="sun-arc-svg" role="img"
           aria-label="Sun position between sunrise at ${weatherService.formatClock(sunrise)} and sunset at ${weatherService.formatClock(sunset)}">
        <defs>
          <linearGradient id="horizonFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d="M 50 120 A 100 100 0 0 1 250 120 Z" fill="url(#horizonFade)" />
        <path d="M 50 120 A 100 100 0 0 1 250 120" fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="4 5" />
        <line x1="36" y1="120" x2="264" y2="120" stroke="var(--border)" stroke-width="1" />
        ${isDay
          ? `<circle cx="${x}" cy="${y}" r="9" fill="#f59e0b" />`
          : `<text x="150" y="114" font-size="20" text-anchor="middle" fill="#94a3b8">☾</text>`}
        <text x="50" y="140" fill="var(--text-muted)" font-size="11" text-anchor="middle">${weatherService.formatClock(sunrise)}</text>
        <text x="250" y="140" fill="var(--text-muted)" font-size="11" text-anchor="middle">${weatherService.formatClock(sunset)}</text>
      </svg>`;
  }

  function render(data) {
    const daily = data?.daily;
    if (!container || !daily?.sunrise?.[0] || !daily?.sunset?.[0]) {
      if (container) container.innerHTML = '<p class="muted small">Astronomy data unavailable for this location.</p>';
      return;
    }

    const sunrise = daily.sunrise[0];
    const sunset = daily.sunset[0];
    const startMin = minutesOfDay(sunrise);
    const endMin = minutesOfDay(sunset);
    const dayLength = Math.max(0, endMin - startMin);
    const dayLabel = `${Math.floor(dayLength / 60)}h ${dayLength % 60}m`;

    const localNow = weatherService.localNow(data);
    const nowMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
    const isDay = nowMinutes >= startMin && nowMinutes <= endMin;
    const untilSunrise = (startMin - nowMinutes + 1440) % 1440;
    const untilSunset = (endMin - nowMinutes + 1440) % 1440;
    const countdownLabel = isDay ? "Daylight remaining" : "Sunrise in";
    const countdownValue = isDay
      ? `${Math.floor(untilSunset / 60)}h ${untilSunset % 60}m`
      : `${Math.floor(untilSunrise / 60)}h ${untilSunrise % 60}m`;

    const moon = moonPhase(new Date());

    container.innerHTML = `
      <div class="astro-sun">
        ${sunArc(sunrise, sunset, nowMinutes, isDay)}
        ${isDay ? "" : '<p class="sun-note">Sun is below the horizon</p>'}
      </div>
      <div class="astro-row">
        <span class="muted small">Day length</span>
        <strong>${dayLabel}</strong>
      </div>
      <div class="astro-row">
        <span class="muted small">${countdownLabel}</span>
        <strong>${countdownValue}</strong>
      </div>
      <div class="astro-moon">
        <span class="astro-moon-emoji" aria-hidden="true">${moon.emoji}</span>
        <div>
          <strong>${moon.name}</strong>
          <div class="muted small">${moon.illumination}% illuminated</div>
        </div>
      </div>
      <div class="astro-hours">
        <div class="astro-hour astro-hour--gold">
          <strong>Golden hour</strong>
          <span class="muted small">${weatherService.formatClock(shiftClock(sunrise, 60))} · ${weatherService.formatClock(shiftClock(sunset, -60))}</span>
        </div>
        <div class="astro-hour astro-hour--blue">
          <strong>Blue hour</strong>
          <span class="muted small">${weatherService.formatClock(shiftClock(sunrise, -30))} · ${weatherService.formatClock(shiftClock(sunset, 30))}</span>
        </div>
      </div>
    `;
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.data));
})();
