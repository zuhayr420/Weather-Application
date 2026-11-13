/**
 * mapLayers.js — Leaflet base map plus weather overlays.
 *
 * Everything here is keyless:
 *  - Radar / nowcast ............ RainViewer tiles (animated loop)
 *  - Satellite .................. Esri World Imagery
 *  - Temperature / wind / clouds  a coarse field built from an Open-Meteo
 *                                 grid sample around the current view
 *
 * The field layers fetch a 5×5 grid of points in a single Open-Meteo request
 * and draw translucent circles, so they pan and zoom with the map without any
 * tile server or API key.
 */
(() => {
  const mapEl = document.getElementById("map");
  if (!mapEl || typeof L === "undefined") return;

  const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
  const GRID_SIZE = 5;
  const GRID_CACHE_TTL = 10 * 60 * 1000;
  const MIN_ZOOM_FOR_FIELD = 4;

  const FIELDS = {
    temp: {
      label: "Temperature",
      current: "temperature_2m",
      stops: [[-20, "#312e81"], [-5, "#2563eb"], [5, "#22d3ee"], [15, "#34d399"], [25, "#fbbf24"], [35, "#f97316"], [45, "#b91c1c"]],
      value: (v) => (weatherService.state.unit === "fahrenheit" ? (v * 9) / 5 + 32 : v),
      format: (v) => `${Math.round(v)}${weatherService.unitSymbol()}`,
      opacity: 0.34,
    },
    wind: {
      label: "Wind",
      current: "wind_speed_10m",
      stops: [[0, "#0ea5e9"], [10, "#22c55e"], [25, "#eab308"], [40, "#f97316"], [60, "#7c3aed"], [90, "#4c1d95"]],
      value: (v) => (weatherService.state.unit === "fahrenheit" ? v * 0.621371 : v),
      format: (v) => `${Math.round(v)} ${weatherService.windUnit()}`,
      opacity: 0.32,
    },
    clouds: {
      label: "Cloud cover",
      current: "cloud_cover",
      stops: [[0, "#ffffff"], [35, "#cbd5e1"], [70, "#94a3b8"], [100, "#475569"]],
      value: (v) => v,
      format: (v) => `${Math.round(v)}%`,
      opacity: 0.4,
    },
  };

  const map = L.map(mapEl, { zoomControl: true, attributionControl: true })
    .setView([40.7128, -74.006], 6);

  const baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  let radarFrames = [];
  let radarTimer = null;
  let radarRun = 0;
  let satellite = null;
  let gridLayer = null;
  let gridKind = null;
  let gridToken = 0;
  let gridTimer = null;
  let legendControl = null;
  let noteControl = null;
  let marker = null;
  let focusedLocation = null;
  const gridCache = new Map();

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function colorFor(stops, value) {
    if (value === null || value === undefined) return "#94a3b8";
    if (value <= stops[0][0]) return stops[0][1];
    if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (let i = 1; i < stops.length; i++) {
      const [hi, hiColor] = stops[i];
      const [lo, loColor] = stops[i - 1];
      if (value <= hi) {
        const t = (value - lo) / (hi - lo);
        const a = hexToRgb(loColor);
        const b = hexToRgb(hiColor);
        const mix = a.map((c, k) => Math.round(c + (b[k] - c) * t));
        return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
      }
    }
    return stops[stops.length - 1][1];
  }

  function removeControl(control) {
    if (control) map.removeControl(control);
    return null;
  }

  function clearField() {
    gridToken += 1;
    clearTimeout(gridTimer);
    if (gridLayer) {
      map.removeLayer(gridLayer);
      gridLayer = null;
    }
    gridKind = null;
    legendControl = removeControl(legendControl);
    noteControl = removeControl(noteControl);
  }

  function stopRadar() {
    radarRun += 1;
    clearTimeout(radarTimer);
    radarTimer = null;
    const stale = [];
    map.eachLayer((layer) => {
      if (layer._isRadar) stale.push(layer);
    });
    stale.forEach((layer) => map.removeLayer(layer));
  }

  function clearAllOverlays() {
    stopRadar();
    if (satellite) {
      map.removeLayer(satellite);
      satellite = null;
    }
    clearField();
  }

  /* ------------------------------------------------------------------ *
   * Radar + satellite
   * ------------------------------------------------------------------ */

  async function startRadar() {
    if (!radarFrames.length) {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      if (!res.ok) throw new Error(`Radar unavailable (${res.status})`);
      const json = await res.json();
      radarFrames = [...(json.radar?.past || []), ...(json.radar?.nowcast || [])];
    }
    if (!radarFrames.length) throw new Error("No radar frames available");

    stopRadar();
    const run = radarRun;
    let index = radarFrames.length - 1;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const frameLayer = (frame) =>
      L.tileLayer(`https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        attribution: "Radar &copy; RainViewer",
        opacity: 0.6,
      });

    const showNext = () => {
      if (run !== radarRun) return;
      const layer = frameLayer(radarFrames[index % radarFrames.length]);
      layer._isRadar = true;
      layer.addTo(map);

      const stale = [];
      map.eachLayer((other) => {
        if (other._isRadar && other !== layer) stale.push(other);
      });
      stale.forEach((other) => map.removeLayer(other));

      if (reduceMotion) return;
      index += 1;
      radarTimer = setTimeout(showNext, 700);
    };
    showNext();
  }

  /* ------------------------------------------------------------------ *
   * Grid field layers (temperature / wind / cloud cover)
   * ------------------------------------------------------------------ */

  function boundsKey(bounds) {
    return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]
      .map((n) => n.toFixed(2))
      .join(",");
  }

  async function fetchGrid(bounds, fieldKey) {
    const key = `${fieldKey}:${boundsKey(bounds)}`;
    const hit = gridCache.get(key);
    if (hit && Date.now() - hit.ts < GRID_CACHE_TTL) return hit.data;

    const latStep = (bounds.getNorth() - bounds.getSouth()) / (GRID_SIZE - 1);
    const lonStep = (bounds.getEast() - bounds.getWest()) / (GRID_SIZE - 1);
    const lats = [];
    const lons = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        lats.push((bounds.getSouth() + latStep * i).toFixed(3));
        lons.push((bounds.getWest() + lonStep * j).toFixed(3));
      }
    }

    const field = FIELDS[fieldKey];
    const url =
      `${FORECAST_API}?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
      `&current=${field.current}&timezone=UTC`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Grid request failed (${res.status})`);
    const json = await res.json();
    const data = Array.isArray(json) ? json : [json];
    gridCache.set(key, { ts: Date.now(), data });
    return data;
  }

  function renderGrid(bounds, data, fieldKey) {
    const field = FIELDS[fieldKey];
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const radius = ((latSpan * 111000) / (GRID_SIZE - 1)) * 0.95;

    gridLayer = L.layerGroup();

    data.forEach((point) => {
      const raw = point.current?.[field.current];
      if (raw === null || raw === undefined) return;
      const value = field.value(raw);
      const opacity =
        fieldKey === "clouds" ? 0.03 + (Math.max(0, Math.min(100, value)) / 100) * field.opacity : field.opacity;
      L.circle([point.latitude, point.longitude], {
        radius,
        stroke: false,
        fillColor: colorFor(field.stops, value),
        fillOpacity: opacity,
        interactive: false,
      }).addTo(gridLayer);
    });

    gridLayer.addTo(map);

    const stops = field.stops;
    legendControl = L.control({ position: "bottomright" });
    legendControl.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      const gradient = stops
        .map(([v, c], i) => {
          const pct = (i / (stops.length - 1)) * 100;
          return `${c} ${pct}%`;
        })
        .join(", ");
      div.innerHTML = `
        <div class="map-legend-title">${field.label}</div>
        <div class="map-legend-bar" style="background: linear-gradient(90deg, ${gradient})"></div>
        <div class="map-legend-range">
          <span>${field.format(stops[0][0])}</span>
          <span>${field.format(stops[stops.length - 1][0])}</span>
        </div>
      `;
      return div;
    };
    legendControl.addTo(map);
  }

  async function refreshField() {
    if (!gridKind) return;
    const fieldKey = gridKind;
    const bounds = map.getBounds();

    if (map.getZoom() < MIN_ZOOM_FOR_FIELD) {
      if (gridLayer) {
        map.removeLayer(gridLayer);
        gridLayer = null;
      }
      if (!noteControl) {
        noteControl = L.control({ position: "bottomleft" });
        noteControl.onAdd = () => {
          const div = L.DomUtil.create("div", "map-note");
          div.textContent = "Zoom in to load the live weather field.";
          return div;
        };
        noteControl.addTo(map);
      }
      return;
    }

    noteControl = removeControl(noteControl);
    const token = ++gridToken;

    try {
      const data = await fetchGrid(bounds, fieldKey);
      if (token !== gridToken || gridKind !== fieldKey) return;

      if (gridLayer) map.removeLayer(gridLayer);
      legendControl = removeControl(legendControl);
      renderGrid(bounds, data, fieldKey);
    } catch (err) {
      console.warn("Weather field failed", err);
      if (token === gridToken) {
        noteControl = removeControl(noteControl);
        noteControl = L.control({ position: "bottomleft" });
        noteControl.onAdd = () => {
          const div = L.DomUtil.create("div", "map-note");
          div.textContent = "Couldn't load this layer right now.";
          return div;
        };
        noteControl.addTo(map);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Layer switching
   * ------------------------------------------------------------------ */

  async function setLayer(kind) {
    clearAllOverlays();

    if (kind === "satellite") {
      satellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles &copy; Esri", maxZoom: 19 }
      ).addTo(map);
      return;
    }

    if (kind === "radar") {
      try {
        await startRadar();
      } catch (err) {
        console.warn("Radar layer failed", err);
        noteControl = L.control({ position: "bottomleft" });
        noteControl.onAdd = () => {
          const div = L.DomUtil.create("div", "map-note");
          div.textContent = "Radar is unavailable right now.";
          return div;
        };
        noteControl.addTo(map);
      }
      return;
    }

    if (FIELDS[kind]) {
      gridKind = kind;
      await refreshField();
    }
  }

  document.getElementById("layerToggles")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    document.querySelectorAll("#layerToggles .chip").forEach((chip) => {
      chip.classList.toggle("active", chip === btn);
      chip.setAttribute("aria-pressed", String(chip === btn));
    });
    setLayer(btn.dataset.layer);
  });

  map.on("moveend", () => {
    if (!gridKind) return;
    clearTimeout(gridTimer);
    gridTimer = setTimeout(refreshField, 450);
  });

  // Stop the radar loop while the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopRadar();
    } else if (document.querySelector('#layerToggles .chip[data-layer="radar"]')?.classList.contains("active")) {
      startRadar().catch(() => {});
    }
  });

  setLayer("radar");

  document.addEventListener("weatherUpdated", (e) => {
    const { lat, lon } = e.detail.location;
    if (lat === undefined || lon === undefined) return;

    marker?.remove();
    marker = L.marker([lat, lon]).addTo(map);

    // Only recenter when the place actually changes, so silent background
    // refreshes never yank the map away from where the user panned.
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (key !== focusedLocation) {
      focusedLocation = key;
      map.setView([lat, lon], 8);
    }
  });

  window.__weatherMap = map;
  window.__weatherBaseLayer = baseLayer;
})();
