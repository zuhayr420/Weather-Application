/**
 * route.js — Route Weather Planner.
 * Plans a driving route (OSRM), samples points along it, fetches weather at
 * each, and renders waypoint cards with a Safe/Moderate/Dangerous verdict.
 */
const routePlanner = (() => {
  let originLoc = null;
  let destLoc = null;
  let routeMap = null;
  let routeLine = null;

  function ensureMap() {
    if (routeMap) return routeMap;
    routeMap = L.map("routeMap", { zoomControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(routeMap);
    return routeMap;
  }

  // Sample N evenly spaced points along a GeoJSON LineString (lon/lat pairs)
  function sampleRoute(coords, n) {
    const points = [];
    const step = Math.max(1, Math.floor(coords.length / (n - 1)));
    for (let i = 0; i < coords.length; i += step) points.push(coords[i]);
    if (points[points.length - 1] !== coords[coords.length - 1]) points.push(coords[coords.length - 1]);
    return points.slice(0, n).length === n ? points.slice(0, n) : points;
  }

  function verdictFor(weather) {
    const code = weather.current.weather_code;
    const meta = weatherService.describeCode(code);
    const wind = weather.current.wind_speed_10m;
    const windKmh = weatherService.state.unit === "fahrenheit" ? wind * 1.60934 : wind;
    let score = 0; // higher = worse
    if (meta.group === "storm") score += 3;
    if (meta.group === "snow") score += 2;
    if (meta.group === "rain") score += 1;
    if (meta.group === "fog") score += 1.5;
    if (windKmh > 50) score += 2;
    else if (windKmh > 30) score += 1;
    if (score >= 3) return { level: "dangerous", label: "Dangerous" };
    if (score >= 1) return { level: "moderate", label: "Moderate" };
    return { level: "safe", label: "Safe" };
  }

  async function planRoute(origin, dest, { renderUi = true } = {}) {
    const routeData = await weatherService.fetchRoute(origin, dest);
    const r = routeData.routes?.[0];
    if (!r) throw new Error("No route found");
    const coords = r.geometry.coordinates; // [lon, lat]
    const sampleCount = 5;
    const points = sampleRoute(coords, sampleCount);

    const weatherAtPoints = await Promise.all(
      points.map(([lon, lat]) => weatherService.fetchWeatherAt(lat, lon))
    );

    const waypoints = points.map(([lon, lat], i) => ({
      lat, lon,
      weather: weatherAtPoints[i],
      verdict: verdictFor(weatherAtPoints[i]),
      isOrigin: i === 0,
      isDest: i === points.length - 1,
    }));

    if (renderUi) renderRoute(r, waypoints, origin, dest);
    return { route: r, waypoints };
  }

  function renderRoute(r, waypoints, origin, dest) {
    document.getElementById("routeResults").hidden = false;
    const map = ensureMap();
    setTimeout(() => map.invalidateSize(), 50);

    if (routeLine) map.removeLayer(routeLine);
    const latlngs = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    routeLine = L.layerGroup().addTo(map);
    L.polyline(latlngs, { color: getComputedStyle(document.body).getPropertyValue("--accent") || "#2563eb", weight: 4 }).addTo(routeLine);
    waypoints.forEach((wp) => {
      const meta = weatherService.describeCode(wp.weather.current.weather_code);
      L.circleMarker([wp.lat, wp.lon], {
        radius: 7,
        color: { safe: "#16a34a", moderate: "#d97706", dangerous: "#dc2626" }[wp.verdict.level],
        fillOpacity: 0.9,
      })
        .bindTooltip(`${meta.label}, ${weatherService.formatTemp(wp.weather.current.temperature_2m)}`)
        .addTo(routeLine);
    });
    map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [24, 24] });

    const km = (r.distance / 1000).toFixed(1);
    const mi = (r.distance / 1609.34).toFixed(1);
    const mins = Math.round(r.duration / 60);
    const worst = waypoints.reduce((acc, wp) => {
      const rank = { safe: 0, moderate: 1, dangerous: 2 };
      return rank[wp.verdict.level] > rank[acc.level] ? wp.verdict : acc;
    }, { level: "safe", label: "Safe" });

    document.getElementById("routeSummary").innerHTML = `
      <div><strong>${km} km / ${mi} mi</strong><span class="muted">Distance</span></div>
      <div><strong>${mins} min</strong><span class="muted">Est. driving time</span></div>
      <div><strong><span class="verdict ${worst.level}">${worst.label}</span></strong><span class="muted">Overall trip verdict</span></div>
    `;

    const grid = document.getElementById("routeWaypoints");
    grid.innerHTML = "";
    waypoints.forEach((wp) => {
      const meta = weatherService.describeCode(wp.weather.current.weather_code);
      const label = wp.isOrigin ? origin.name : wp.isDest ? dest.name : "Along route";
      const card = document.createElement("div");
      card.className = "waypoint-card";
      card.innerHTML = `
        <strong>${label}</strong>
        <span class="verdict ${wp.verdict.level}">${wp.verdict.label}</span>
        <span><i class="ph-fill ${meta.icon}" aria-hidden="true"></i> ${meta.label}</span>
        <span>${weatherService.formatTemp(wp.weather.current.temperature_2m)} · ${Math.round(wp.weather.current.wind_speed_10m)} ${weatherService.windUnit()} wind</span>
      `;
      grid.appendChild(card);
    });
  }

  function init() {
    const form = document.getElementById("routeForm");
    const fromInput = document.getElementById("routeFrom");
    const toInput = document.getElementById("routeTo");
    const fromResults = document.createElement("ul");
    fromResults.className = "search-results";
    fromResults.id = "routeFromResults";
    fromResults.hidden = true;
    fromInput.parentElement.style.position = "relative";
    fromInput.parentElement.appendChild(fromResults);

    const toResults = document.createElement("ul");
    toResults.className = "search-results";
    toResults.id = "routeToResults";
    toResults.hidden = true;
    toInput.parentElement.style.position = "relative";
    toInput.parentElement.appendChild(toResults);

    attachLocationSearch(fromInput, fromResults, (loc) => { originLoc = loc; });
    attachLocationSearch(toInput, toResults, (loc) => { destLoc = loc; });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!originLoc || !destLoc) {
        alert("Pick an origin and destination from the suggestions list.");
        return;
      }
      const btn = document.getElementById("routeSubmit");
      btn.disabled = true;
      btn.textContent = "Planning…";
      try {
        await planRoute(originLoc, destLoc);
      } catch (err) {
        console.error(err);
        alert("Couldn't plan that route. Try different locations.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Plan route";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();

  return { planRoute, verdictFor };
})();
