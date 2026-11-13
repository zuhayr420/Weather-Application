/**
 * weatherService.js
 * -----------------
 * The app's single data layer — and it runs entirely in the browser. There is
 * no server: every endpoint below is free, keyless and CORS-enabled, so the
 * whole app is just static files.
 *
 *   Weather / history / air quality ... Open-Meteo
 *   Search .......................... Open-Meteo geocoding (+ Nominatim fallback)
 *   Reverse geocoding ............... BigDataCloud (+ Nominatim fallback)
 *   Driving routes .................. OSRM demo server
 *
 * Modules never call `fetch` themselves; they read state from here and listen
 * for the `weatherUpdated` CustomEvent, so a location change is one request.
 */
const weatherService = (() => {
  const API = {
    forecast: "https://api.open-meteo.com/v1/forecast",
    archive: "https://archive-api.open-meteo.com/v1/archive",
    airQuality: "https://air-quality-api.open-meteo.com/v1/air-quality",
    geocode: "https://geocoding-api.open-meteo.com/v1/search",
    reverse: "https://api.bigdatacloud.net/data/reverse-geocode-client",
    nominatim: "https://nominatim.openstreetmap.org",
    route: "https://router.project-osrm.org/route/v1/driving",
  };

  const CACHE_TTL = 5 * 60 * 1000;
  const LOCATION_KEY = "wx.location";
  const SNAPSHOT_KEY = "wx.snapshot.v1";
  const REFRESH_INTERVAL = 10 * 60 * 1000;

  const state = {
    location: null, // { name, region, country, lat, lon }
    unit: localStorage.getItem("wx.unit") || "celsius", // "celsius" | "fahrenheit"
    current: null,
    hourly: null,
    daily: null,
    raw: null,
    lastFetch: 0,
    offline: false,
  };

  const cache = new Map(); // key -> { ts, data }

  /* ------------------------------------------------------------------ *
   * Networking
   * ------------------------------------------------------------------ */

  function query(params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") search.append(k, v);
    });
    return search.toString();
  }

  async function getJSON(url, { key, ttl = CACHE_TTL, timeout = 15000, retries = 1 } = {}) {
    if (key) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.ts < ttl) return hit.data;
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (key) cache.set(key, { ts: Date.now(), data });
        return data;
      } catch (err) {
        lastError = err;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  // Nominatim asks for at most one request per second. Only used as a fallback
  // for free-form queries ("Paris, Texas") and reverse lookups, and throttled.
  let nominatimLastCall = 0;
  async function nominatimJSON(pathAndQuery) {
    const wait = 1100 - (Date.now() - nominatimLastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nominatimLastCall = Date.now();
    return getJSON(`${API.nominatim}/${pathAndQuery}`, { retries: 0 });
  }

  /* ------------------------------------------------------------------ *
   * Weather
   * ------------------------------------------------------------------ */

  function forecastParams(lat, lon) {
    const imperial = state.unit === "fahrenheit";
    return {
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "is_day",
        "precipitation",
        "rain",
        "weather_code",
        "cloud_cover",
        "pressure_msl",
        "surface_pressure",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
        "uv_index",
      ].join(","),
      hourly: [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "precipitation_probability",
        "precipitation",
        "weather_code",
        "is_day",
        "wind_speed_10m",
        "wind_direction_10m",
        "uv_index",
        "visibility",
        "dew_point_2m",
        "cloud_cover",
        "surface_pressure",
        "pressure_msl",
      ].join(","),
      daily: [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "sunrise",
        "sunset",
        "precipitation_probability_max",
        "precipitation_sum",
        "uv_index_max",
        "wind_speed_10m_max",
      ].join(","),
      temperature_unit: imperial ? "fahrenheit" : "celsius",
      wind_speed_unit: imperial ? "mph" : "kmh",
      precipitation_unit: imperial ? "inch" : "mm",
      timezone: "auto",
      forecast_days: 7,
    };
  }

  function fetchForecast(lat, lon) {
    const key = `wx:${lat.toFixed(3)},${lon.toFixed(3)}:${state.unit}`;
    return getJSON(`${API.forecast}?${query(forecastParams(lat, lon))}`, { key });
  }

  /**
   * 5-year baseline for the same calendar date, for anomaly detection.
   * One archive request covering the whole range, filtered client-side.
   */
  async function fetchArchive(lat, lon, month, day) {
    const key = `archive:${lat.toFixed(2)},${lon.toFixed(2)}:${month}-${day}`;
    const today = new Date();
    const dates = [];
    for (let i = 1; i <= 5; i++) {
      const year = today.getFullYear() - i;
      const safeDay = Math.min(day, daysInMonth(year, month));
      dates.push(new Date(Date.UTC(year, month - 1, safeDay)).toISOString().slice(0, 10));
    }
    const start = dates[dates.length - 1];
    const end = dates[0];

    const data = await getJSON(
      `${API.archive}?${query({
        latitude: lat.toFixed(4),
        longitude: lon.toFixed(4),
        start_date: start,
        end_date: end,
        daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
        timezone: "auto",
      })}`,
      { key, ttl: 12 * 60 * 60 * 1000, timeout: 20000 }
    );

    const daily = data.daily || {};
    const out = { dates: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [] };
    (daily.time || []).forEach((iso, i) => {
      const [, m, d] = iso.split("-").map(Number);
      if (m !== month || d !== day) return;
      out.dates.push(iso);
      out.temperature_2m_max.push(daily.temperature_2m_max?.[i] ?? null);
      out.temperature_2m_min.push(daily.temperature_2m_min?.[i] ?? null);
      out.precipitation_sum.push(daily.precipitation_sum?.[i] ?? null);
    });
    return out;
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function fetchAirQuality(lat, lon) {
    const key = `aq:${lat.toFixed(3)},${lon.toFixed(3)}`;
    return getJSON(
      `${API.airQuality}?${query({
        latitude: lat.toFixed(4),
        longitude: lon.toFixed(4),
        current:
          "us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,dust,uv_index",
        hourly: "us_aqi,pm2_5,pm10",
        forecast_days: 2,
        timezone: "auto",
      })}`,
      { key }
    );
  }

  function fetchRoute(from, to) {
    const key = `route:${from.lat.toFixed(3)},${from.lon.toFixed(3)}-${to.lat.toFixed(3)},${to.lon.toFixed(3)}`;
    const url = `${API.route}/${from.lon},${from.lat};${to.lon},${to.lat}?${query({
      overview: "full",
      geometries: "geojson",
      steps: "false",
    })}`;
    return getJSON(url, { key, ttl: 10 * 60 * 1000, timeout: 20000 });
  }

  /* ------------------------------------------------------------------ *
   * Geocoding
   * ------------------------------------------------------------------ */

  const FEATURE_LABELS = {
    PPLC: "capital",
    PPLA: "city",
    PPLA2: "city",
    PPLA3: "town",
    PPLA4: "town",
    PPL: "town",
    PPLX: "suburb",
    PPLL: "village",
    ADM1: "region",
    ADM2: "county",
    ADM3: "district",
    AIRP: "airport",
    MT: "mountain",
    ISL: "island",
    LK: "lake",
    BAY: "bay",
    STRN: "strait",
    PARK: "park",
    RSTN: "station",
  };

  function fromOpenMeteo(item) {
    return {
      name: item.name,
      region: item.admin1 || "",
      country: item.country || "",
      type: FEATURE_LABELS[item.feature_code] || "place",
      lat: Number(item.latitude),
      lon: Number(item.longitude),
    };
  }

  function getPlaceCategory(type, category, addresstype) {
    const t = (type || addresstype || category || "").toLowerCase();
    // Roads, highways, avenues
    if (["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "highway", "road", "street", "pedestrian", "path", "track"].includes(t)) {
      return { label: "Road / Highway", icon: "ph-road-horizon" };
    }
    // Cities, towns, villages, suburbs
    if (["city", "town", "municipality"].includes(t)) {
      return { label: "City", icon: "ph-buildings" };
    }
    if (["village", "hamlet"].includes(t)) {
      return { label: "Village", icon: "ph-house-line" };
    }
    if (["suburb", "neighbourhood", "quarter"].includes(t)) {
      return { label: "Neighborhood", icon: "ph-map-pin" };
    }
    // Natural / Geographic landmarks
    if (["mountain", "peak", "volcano", "hill"].includes(t)) {
      return { label: "Mountain", icon: "ph-mountains" };
    }
    if (["valley", "canyon", "gorge", "pass"].includes(t)) {
      return { label: "Valley / Pass", icon: "ph-mountains" };
    }
    if (["lake", "river", "water", "bay", "sea", "ocean"].includes(t)) {
      return { label: "Waterbody", icon: "ph-drop" };
    }
    if (["landmark", "tourism", "attraction", "monument", "historic"].includes(t)) {
      return { label: "Landmark", icon: "ph-landmark" };
    }
    if (["aeroway", "airport", "aerodrome"].includes(t)) {
      return { label: "Airport", icon: "ph-airplane-tilt" };
    }
    if (["station", "railway", "halt"].includes(t)) {
      return { label: "Station", icon: "ph-train" };
    }
    return { label: t ? t.replace(/_/g, " ") : "Location", icon: "ph-map-pin" };
  }

  function fromNominatim(item) {
    const addr = item.address || {};
    const road = addr.road || addr.highway || addr.pedestrian || addr.street;
    
    // Choose the best primary title (Road name, Village, Town, Landmark, or City)
    const name =
      item.name ||
      road ||
      addr.village || addr.hamlet || addr.suburb ||
      addr.town || addr.city || addr.municipality ||
      (item.display_name || "").split(",")[0];

    const categoryInfo = getPlaceCategory(item.type, item.category, item.addresstype);

    // Build hierarchical subtitle: e.g. "Upper MG Marg, Gangtok, Sikkim, India"
    const subParts = [
      road && road !== name ? road : "",
      addr.suburb && addr.suburb !== name ? addr.suburb : "",
      addr.village && addr.village !== name ? addr.village : "",
      addr.town && addr.town !== name ? addr.town : "",
      addr.city && addr.city !== name ? addr.city : "",
      addr.county || addr.state_district || "",
      addr.state || addr.region || "",
      addr.country || ""
    ].filter(Boolean);

    if (subParts.length === 0 && item.display_name) {
      const parts = item.display_name.split(",").map(s => s.trim()).filter(s => s && s !== name);
      subParts.push(...parts.slice(0, 3));
    }

    const region = Array.from(new Set(subParts)).slice(0, 3).join(", ");

    return {
      name: name || "Unnamed location",
      region: region,
      country: addr.country || "",
      categoryLabel: categoryInfo.label,
      categoryIcon: categoryInfo.icon,
      type: item.type || item.addresstype || "place",
      lat: Number(item.lat),
      lon: Number(item.lon),
    };
  }

  function dedupe(locations, limit = 12) {
    const seen = new Set();
    return locations
      .filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lon) && loc.name)
      .filter((loc) => {
        const id = `${loc.name.toLowerCase()}|${loc.region.toLowerCase()}|${loc.country.toLowerCase()}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, limit);
  }

  async function geocodeSearch(queryText) {
    const text = (queryText || "").trim();
    if (text.length < 2) return [];
    const key = `geo:${text.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.data;

    let results = [];

    // 1. First query our backend geocode proxy (Deep Global Hybrid Engine)
    try {
      const backendResults = await getJSON(`/api/geocode?q=${encodeURIComponent(text)}`, { retries: 0, timeout: 8000 });
      if (Array.isArray(backendResults) && backendResults.length > 0) {
        results = backendResults.map(fromNominatim);
      }
    } catch (err) {
      console.warn("Backend geocode lookup failed, attempting direct providers", err);
    }

    // 2. Open-Meteo geocoding as complementary lookup
    if (results.length < 3) {
      try {
        const data = await getJSON(
          `${API.geocode}?${query({ name: text, count: 8, language: "en", format: "json" })}`,
          { timeout: 4000 }
        );
        const omResults = (data.results || []).map(fromOpenMeteo);
        results = results.concat(omResults);
      } catch (err) {
        console.warn("Open-Meteo geocoding fallback failed", err);
      }
    }

    // 3. Direct Nominatim fallback if results are still sparse or if running standalone
    if (results.length === 0) {
      try {
        const data = await nominatimJSON(
          `search?${query({ q: text, format: "jsonv2", addressdetails: 1, limit: 8, "accept-language": "en" })}`
        );
        results = results.concat((data || []).map(fromNominatim));
      } catch (err) {
        console.warn("Direct Nominatim search failed", err);
      }
    }

    const places = dedupe(results, 12);
    cache.set(key, { ts: Date.now(), data: places });
    return places;
  }

  async function reverseGeocode(lat, lon) {
    const key = `rev:${lat.toFixed(3)},${lon.toFixed(3)}`;
    try {
      const data = await getJSON(
        `${API.reverse}?${query({ latitude: lat, longitude: lon, localityLanguage: "en" })}`,
        { key, ttl: 24 * 60 * 60 * 1000 }
      );
      const name = data.city || data.locality || data.principalSubdivision || "Current location";
      return {
        name,
        region: data.locality && data.locality !== name ? data.locality : data.principalSubdivision || "",
        country: data.countryName || "",
        lat,
        lon,
      };
    } catch (err) {
      console.warn("BigDataCloud reverse geocoding failed", err);
    }

    const fallback = await nominatimJSON(
      `reverse?${query({ lat, lon, format: "jsonv2", "accept-language": "en" })}`
    );
    return fromNominatim(fallback);
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  function setStatus(loading, text) {
    const bar = document.getElementById("statusBar");
    const label = document.getElementById("statusText");
    if (!bar) return;
    bar.hidden = !loading;
    if (!loading) bar.classList.remove("status-bar--error");
    if (label && text) label.textContent = text;
  }

  function persistLocation(location) {
    try {
      localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
    } catch { /* storage full or blocked — not fatal */ }
  }

  function saveSnapshot() {
    if (!state.location || !state.raw) return;
    try {
      localStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({
          location: state.location,
          unit: state.unit,
          data: state.raw,
          ts: state.lastFetch || Date.now(),
        })
      );
    } catch { /* storage full or blocked — not fatal */ }
  }

  function applyData(data) {
    state.raw = data;
    state.current = data.current;
    state.hourly = data.hourly;
    state.daily = data.daily;
    state.lastFetch = Date.now();
    state.offline = false;
  }

  function emitUpdated(extra = {}) {
    document.dispatchEvent(
      new CustomEvent("weatherUpdated", {
        detail: { location: state.location, unit: state.unit, data: state.raw, ...extra },
      })
    );
  }

  /**
   * Paint the last successful forecast instantly (and when offline), then let
   * the caller refresh it. Returns the saved location, or null on first visit.
   */
  function restoreSnapshot() {
    let savedLocation = null;
    let snapshot = null;
    try {
      savedLocation = JSON.parse(localStorage.getItem(LOCATION_KEY) || "null");
      snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    } catch { /* corrupt storage — ignore */ }

    const usable =
      snapshot &&
      snapshot.unit === state.unit &&
      snapshot.data &&
      snapshot.data.current &&
      Date.now() - (snapshot.ts || 0) < 24 * 60 * 60 * 1000;

    if (usable) {
      state.location = snapshot.location;
      applyData(snapshot.data);
      state.lastFetch = snapshot.ts;
      emitUpdated({ cached: true });
    } else if (savedLocation) {
      state.location = savedLocation;
    }
    return state.location;
  }

  async function setLocation(location) {
    state.location = location;
    persistLocation(location);
    await refresh();
  }

  async function setUnit(unit) {
    if (unit === state.unit) return;
    state.unit = unit;
    localStorage.setItem("wx.unit", unit);
    if (state.location) await refresh();
    else document.dispatchEvent(new CustomEvent("unitChanged", { detail: { unit } }));
  }

  async function refresh({ quiet = false } = {}) {
    if (!state.location) return;
    const { lat, lon } = state.location;
    if (!quiet) setStatus(true, "Updating…");
    try {
      const data = await fetchForecast(lat, lon);
      applyData(data);
      saveSnapshot();
      setStatus(false);
      emitUpdated();
    } catch (err) {
      console.error("weatherService.refresh failed", err);
      state.offline = true;

      if (state.raw) {
        // Keep the last good forecast on screen and label it, rather than
        // blanking a working dashboard because one request failed.
        document.getElementById("statusBar")?.classList.add("status-bar--error");
        setStatus(true, navigator.onLine === false
          ? "Offline — showing the last update"
          : "Couldn't refresh — showing the last update");
        setTimeout(() => { if (state.offline) setStatus(false); }, 5000);
      } else {
        setStatus(false);
      }

      document.dispatchEvent(new CustomEvent("weatherError", { detail: { error: err } }));
    }
  }

  // Background refresh so an open tab stays current without user action.
  setInterval(() => {
    if (document.visibilityState === "visible" && state.location) refresh({ quiet: true });
  }, REFRESH_INTERVAL);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.location && Date.now() - state.lastFetch > REFRESH_INTERVAL) {
      refresh({ quiet: true });
    }
  });

  window.addEventListener("online", () => {
    if (state.location && state.offline) refresh({ quiet: true });
  });

  async function fetchWeatherAt(lat, lon) {
    return fetchForecast(lat, lon);
  }

  /* ------------------------------------------------------------------ *
   * WMO weather codes
   * ------------------------------------------------------------------ */

  const WMO = {
    0: { label: "Clear sky", icon: "ph-sun", night: "ph-moon", group: "clear" },
    1: { label: "Mainly clear", icon: "ph-sun", night: "ph-cloud-moon", group: "clear" },
    2: { label: "Partly cloudy", icon: "ph-cloud-sun", night: "ph-cloud-moon", group: "clear" },
    3: { label: "Overcast", icon: "ph-cloud", night: "ph-cloud", group: "fog" },
    45: { label: "Fog", icon: "ph-cloud-fog", night: "ph-cloud-fog", group: "fog" },
    48: { label: "Rime fog", icon: "ph-cloud-fog", night: "ph-cloud-fog", group: "fog" },
    51: { label: "Light drizzle", icon: "ph-cloud-drizzle", night: "ph-cloud-drizzle", group: "rain" },
    53: { label: "Drizzle", icon: "ph-cloud-drizzle", night: "ph-cloud-drizzle", group: "rain" },
    55: { label: "Dense drizzle", icon: "ph-cloud-drizzle", night: "ph-cloud-drizzle", group: "rain" },
    56: { label: "Freezing drizzle", icon: "ph-cloud-drizzle", night: "ph-cloud-drizzle", group: "snow" },
    57: { label: "Dense freezing drizzle", icon: "ph-cloud-drizzle", night: "ph-cloud-drizzle", group: "snow" },
    61: { label: "Slight rain", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "rain" },
    63: { label: "Rain", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "rain" },
    65: { label: "Heavy rain", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "rain" },
    66: { label: "Freezing rain", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "snow" },
    67: { label: "Heavy freezing rain", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "snow" },
    71: { label: "Slight snow", icon: "ph-cloud-snow", night: "ph-cloud-snow", group: "snow" },
    73: { label: "Snow", icon: "ph-cloud-snow", night: "ph-cloud-snow", group: "snow" },
    75: { label: "Heavy snow", icon: "ph-cloud-snow", night: "ph-cloud-snow", group: "snow" },
    77: { label: "Snow grains", icon: "ph-cloud-snow", night: "ph-cloud-snow", group: "snow" },
    80: { label: "Slight showers", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "rain" },
    81: { label: "Showers", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "rain" },
    82: { label: "Violent showers", icon: "ph-cloud-rain", night: "ph-cloud-rain", group: "storm" },
    85: { label: "Snow showers", icon: "ph-cloud-snow", night: "ph-cloud-snow", group: "snow" },
    86: { label: "Heavy snow showers", icon: "ph-cloud-snow", night: "ph-cloud-snow", group: "snow" },
    95: { label: "Thunderstorm", icon: "ph-cloud-lightning", night: "ph-cloud-lightning", group: "storm" },
    96: { label: "Thunderstorm, hail", icon: "ph-cloud-lightning", night: "ph-cloud-lightning", group: "storm" },
    99: { label: "Severe thunderstorm, hail", icon: "ph-cloud-lightning", night: "ph-cloud-lightning", group: "storm" },
  };

  function describeCode(code, isDay = true) {
    const meta = WMO[code] || { label: "Unknown", icon: "ph-cloud", night: "ph-cloud", group: "clear" };
    return {
      label: meta.label,
      icon: isDay ? meta.icon : meta.night,
      group: meta.group,
      code,
    };
  }

  /* ------------------------------------------------------------------ *
   * Units + time formatting
   *
   * Open-Meteo with `timezone=auto` returns local wall-clock strings with no
   * offset ("2026-10-26T14:00"). Parsing those with `new Date()` would treat
   * them as the visitor's timezone, so every label in the app is formatted
   * from the string itself. `localNow` shifts the clock by the location's
   * UTC offset so "now" comparisons happen in the location's own time.
   * ------------------------------------------------------------------ */

  function unitSymbol() {
    return state.unit === "fahrenheit" ? "°F" : "°C";
  }
  function windUnit() {
    return state.unit === "fahrenheit" ? "mph" : "km/h";
  }
  function precipUnit() {
    return state.unit === "fahrenheit" ? "in" : "mm";
  }
  function formatTemp(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return `${Math.round(value)}°`;
  }

  function localNow(data) {
    const offset = Number(data?.utc_offset_seconds || 0);
    return new Date(Date.now() + offset * 1000);
  }

  function wallClock(data) {
    // "YYYY-MM-DDTHH:MM" in the location's timezone
    return localNow(data).toISOString().slice(0, 16);
  }

  function localDateLabel(data) {
    return localNow(data).toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  function nowHourIndex(data) {
    if (!data?.hourly?.time?.length) return 0;
    const target = wallClock(data).slice(0, 13) + ":00";
    const idx = data.hourly.time.findIndex((t) => t >= target);
    return idx < 0 ? data.hourly.time.length - 1 : idx;
  }

  function formatClock(iso, { withMinutes = true } = {}) {
    const time = String(iso || "").split("T")[1] || "";
    const [hStr, mStr] = time.split(":");
    const hours = Number(hStr);
    if (hStr === undefined || Number.isNaN(hours)) return "—";
    const suffix = hours < 12 ? "AM" : "PM";
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    const minutes = withMinutes && mStr && mStr !== "00" ? `:${mStr}` : "";
    return `${hour12}${minutes} ${suffix}`;
  }

  function formatWeekday(iso) {
    const [y, m, d] = String(iso || "").split("T")[0].split("-").map(Number);
    if (!y || !m || !d) return "—";
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], {
      weekday: "short",
      timeZone: "UTC",
    });
  }

  function formatShortDate(iso) {
    const [y, m, d] = String(iso || "").split("T")[0].split("-").map(Number);
    if (!y || !m || !d) return "—";
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  return {
    state,
    API,
    geocodeSearch,
    reverseGeocode,
    setLocation,
    setUnit,
    refresh,
    restoreSnapshot,
    fetchArchive,
    fetchAirQuality,
    fetchRoute,
    fetchWeatherAt,
    describeCode,
    unitSymbol,
    windUnit,
    precipUnit,
    formatTemp,
    localNow,
    wallClock,
    localDateLabel,
    nowHourIndex,
    formatClock,
    formatWeekday,
    formatShortDate,
    setStatus,
  };
})();
