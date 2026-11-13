/**
 * journey.js — Live Journey Tracker.
 * Watches GPS position while active, shows a speed/heading HUD, and fetches
 * current conditions for the traveler's position periodically, logging any
 * notable change.
 */
(() => {
  const toggleBtn = document.getElementById("journeyToggle");
  const body = document.getElementById("journeyBody");
  const speedEl = document.getElementById("hudSpeed");
  const headingEl = document.getElementById("hudHeading");
  const conditionsEl = document.getElementById("hudConditions");
  const log = document.getElementById("journeyLog");

  let watchId = null;
  let lastWeatherFetch = 0;
  let lastConditionLabel = null;
  let lastErrorLog = 0;
  const WEATHER_POLL_MS = 5 * 60 * 1000;

  function addLog(text) {
    const li = document.createElement("li");
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    li.textContent = `${time} — ${text}`;
    log.prepend(li);
    while (log.children.length > 20) log.removeChild(log.lastChild);
  }

  function headingLabel(deg) {
    if (deg === null || deg === undefined || Number.isNaN(deg)) return "—";
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(deg / 45) % 8];
  }

  async function onPosition(pos) {
    lastErrorLog = 0;
    const { latitude, longitude, speed, heading } = pos.coords;
    const unit = weatherService.state.unit;
    const speedDisplay = speed == null ? 0 : unit === "fahrenheit" ? speed * 2.23694 : speed * 3.6;
    speedEl.textContent = Math.max(0, Math.round(speedDisplay));
    headingEl.textContent = headingLabel(heading);

    const now = Date.now();
    if (now - lastWeatherFetch > WEATHER_POLL_MS || lastWeatherFetch === 0) {
      lastWeatherFetch = now;
      try {
        const data = await weatherService.fetchWeatherAt(latitude, longitude);
        const meta = weatherService.describeCode(data.current.weather_code);
        conditionsEl.textContent = `${meta.label}, ${weatherService.formatTemp(data.current.temperature_2m)}`;
        if (meta.label !== lastConditionLabel) {
          addLog(`Conditions: ${meta.label}, ${weatherService.formatTemp(data.current.temperature_2m)}, wind ${Math.round(data.current.wind_speed_10m)} ${weatherService.windUnit()}`);
          lastConditionLabel = meta.label;
        }
      } catch (err) {
        console.error(err);
      }
    }
  }

  function onError(err) {
    console.error(err);
    conditionsEl.textContent = "Location unavailable";
    // The watch retries on its own; don't stack identical log lines each time.
    if (Date.now() - lastErrorLog > 30000) {
      addLog("Location signal lost — waiting for a GPS fix.");
      lastErrorLog = Date.now();
    }
  }

  function start() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by this browser.");
      return;
    }
    body.hidden = false;
    toggleBtn.textContent = "Stop tracking";
    conditionsEl.textContent = "Locating…";
    addLog("Journey tracking started.");
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
  }

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    toggleBtn.textContent = "Start tracking";
    addLog("Journey tracking stopped.");
  }

  toggleBtn.addEventListener("click", () => {
    if (watchId === null) start(); else stop();
  });
})();
