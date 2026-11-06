/**
 * intelligence.js — the Intelligence Dashboard.
 * All 6 modules listen for `weatherUpdated` rather than fetching independently,
 * keeping the shared data layer as the single source of truth.
 */

/* ---------------------------------------------------------------------
   Accordion mechanics (main panel + each sub-section)
--------------------------------------------------------------------- */
(() => {
  const mainToggle = document.getElementById("intelMainToggle");
  const mainBody = document.getElementById("intelBody");
  mainToggle.addEventListener("click", () => {
    const expanded = mainToggle.getAttribute("aria-expanded") === "true";
    mainToggle.setAttribute("aria-expanded", String(!expanded));
    mainBody.classList.toggle("collapsed", expanded);
  });

  document.querySelectorAll(".accordion > .accordion-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      const panel = document.getElementById(btn.getAttribute("aria-controls"));
      panel.classList.toggle("collapsed", expanded);
      // Charts drawn inside a collapsed panel need a redraw once it has size.
      if (!expanded) {
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent("panelOpened", { detail: { id: panel.id } }));
        }, 60);
      }
    });
  });

  mainToggle.addEventListener("click", () => {
    if (mainToggle.getAttribute("aria-expanded") === "true") {
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("panelOpened", { detail: { id: "intelBody" } }));
      }, 60);
    }
  });
})();

/* ---------------------------------------------------------------------
   1. "What should I do?" recommendation engine — pure rules, no AI text.
--------------------------------------------------------------------- */
(() => {
  const grid = document.getElementById("recoGrid");

  function verdictBadge(level) {
    return { good: "Good", caution: "Caution", warning: "Warning" }[level];
  }
  function verdictIcon(level) {
    return { good: "ph-check-circle", caution: "ph-warning", warning: "ph-warning-octagon" }[level];
  }

  function buildRecommendations(data) {
    const c = data.current;
    const dailyUv = data.daily.uv_index_max?.[0] ?? 0;
    const precipProb = data.daily.precipitation_probability_max?.[0] ?? 0;
    const meta = weatherService.describeCode(c.weather_code);
    const windKmh = weatherService.state.unit === "fahrenheit" ? c.wind_speed_10m * 1.60934 : c.wind_speed_10m;
    const tempC = weatherService.state.unit === "fahrenheit" ? (c.temperature_2m - 32) / 1.8 : c.temperature_2m;

    const out = [];

    // Outdoors
    out.push({
      title: "Outdoors", icon: "ph-tree",
      level: meta.group === "storm" ? "warning" : (meta.group === "rain" || meta.group === "snow" || windKmh > 40) ? "caution" : "good",
      text: meta.group === "storm" ? "Thunderstorms nearby — better to stay in." :
        meta.group === "rain" ? "Wet conditions — bring rain gear if heading out." :
        meta.group === "snow" ? "Snow underway — watch for slick surfaces." :
        windKmh > 40 ? "Strong winds — secure loose items outdoors." :
        "Pleasant conditions for time outside.",
    });

    // Running
    const heatIndexBad = tempC > 30;
    out.push({
      title: "Running", icon: "ph-person-simple-run",
      level: meta.group === "storm" ? "warning" : (heatIndexBad || meta.group === "rain" || tempC < -5) ? "caution" : "good",
      text: meta.group === "storm" ? "Skip the run — lightning risk." :
        heatIndexBad ? "High heat — run early morning or evening, hydrate well." :
        tempC < -5 ? "Very cold — layer up and watch footing on ice." :
        meta.group === "rain" ? "Damp roads — wear grippy shoes." :
        "Good conditions for a run.",
    });

    // Travel
    out.push({
      title: "Travel", icon: "ph-car",
      level: meta.group === "storm" || meta.group === "snow" ? "warning" : (meta.group === "rain" || meta.group === "fog" || windKmh > 50) ? "caution" : "good",
      text: meta.group === "storm" ? "Delays likely — check road and flight status." :
        meta.group === "snow" ? "Snow may slow travel — allow extra time." :
        meta.group === "fog" ? "Reduced visibility — drive with care." :
        meta.group === "rain" ? "Wet roads — leave extra following distance." :
        "Typical travel conditions expected.",
    });

    // Umbrella
    out.push({
      title: "Umbrella", icon: "ph-umbrella",
      level: precipProb > 60 ? "warning" : precipProb > 30 ? "caution" : "good",
      text: precipProb > 60 ? `${Math.round(precipProb)}% chance of rain — bring one.` :
        precipProb > 30 ? `${Math.round(precipProb)}% chance of rain — worth packing.` :
        "Low chance of rain today.",
    });

    // Clothing
    let clothing;
    if (tempC >= 26) clothing = { level: "good", text: "Light, breathable clothing recommended." };
    else if (tempC >= 16) clothing = { level: "good", text: "Light layers should be comfortable." };
    else if (tempC >= 5) clothing = { level: "caution", text: "A jacket or warm layer is a good idea." };
    else clothing = { level: "warning", text: "Bundle up — heavy coat, hat, and gloves." };
    out.push({ title: "Clothing", icon: "ph-t-shirt", ...clothing });

    // Comfort (humidity + temp combined)
    const humidity = c.relative_humidity_2m;
    let comfort;
    if (tempC > 28 && humidity > 60) comfort = { level: "warning", text: "Hot and humid — limit exertion, stay hydrated." };
    else if (tempC < 0) comfort = { level: "caution", text: "Cold air — exposed skin can chill fast." };
    else if (humidity > 80) comfort = { level: "caution", text: "Muggy conditions likely." };
    else comfort = { level: "good", text: "Comfortable outdoor conditions overall." };
    out.push({ title: "Comfort", icon: "ph-smiley", ...comfort });

    return out;
  }

  function render(data) {
    grid.innerHTML = "";
    buildRecommendations(data).forEach((r) => {
      const card = document.createElement("div");
      card.className = "reco-card";
      card.innerHTML = `
        <div class="reco-title"><i class="ph ${r.icon}"></i> ${r.title}
          <span class="verdict ${{ good: "safe", caution: "moderate", warning: "dangerous" }[r.level]}" style="margin-left:auto;">
            ${verdictBadge(r.level)}
          </span>
        </div>
        <div class="reco-text">${r.text}</div>
      `;
      grid.appendChild(card);
    });
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.data));
})();

/* ---------------------------------------------------------------------
   2. Smart Commute Forecast
--------------------------------------------------------------------- */
(() => {
  const form = document.getElementById("commuteForm");
  const fromInput = document.getElementById("commuteFrom");
  const toInput = document.getElementById("commuteTo");
  const departInput = document.getElementById("commuteDepart");
  const returnInput = document.getElementById("commuteReturn");
  const saveBtn = document.getElementById("commuteSave");
  const savedWrap = document.getElementById("savedRoutes");
  const resultsWrap = document.getElementById("commuteResults");

  let commuteOrigin = null;
  let commuteDest = null;

  const fromResults = document.createElement("ul");
  fromResults.className = "search-results"; fromResults.hidden = true;
  fromInput.parentElement.style.position = "relative";
  fromInput.parentElement.appendChild(fromResults);
  const toResults = document.createElement("ul");
  toResults.className = "search-results"; toResults.hidden = true;
  toInput.parentElement.style.position = "relative";
  toInput.parentElement.appendChild(toResults);

  attachLocationSearch(fromInput, fromResults, (loc) => { commuteOrigin = loc; });
  attachLocationSearch(toInput, toResults, (loc) => { commuteDest = loc; });

  const STORAGE_KEY = "wx.savedRoutes";
  function loadSaved() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
  function saveSaved(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }

  function renderSaved() {
    const list = loadSaved();
    savedWrap.innerHTML = "";
    list.forEach((r, i) => {
      const chip = document.createElement("div");
      chip.className = "fav-chip";
      chip.innerHTML = `<button style="background:none;border:none;color:inherit;cursor:pointer;">${r.origin.name} → ${r.dest.name}</button>
        <button aria-label="Remove saved route"><i class="ph ph-x"></i></button>`;
      chip.querySelector("button").addEventListener("click", () => {
        commuteOrigin = r.origin; commuteDest = r.dest;
        fromInput.value = r.origin.name; toInput.value = r.dest.name;
        departInput.value = r.depart || ""; returnInput.value = r.ret || "";
        runForecast();
      });
      chip.querySelectorAll("button")[1].addEventListener("click", () => {
        const l = loadSaved(); l.splice(i, 1); saveSaved(l); renderSaved();
      });
      savedWrap.appendChild(chip);
    });
  }
  renderSaved();

  saveBtn.addEventListener("click", () => {
    if (!commuteOrigin || !commuteDest) { alert("Pick an origin and destination first."); return; }
    const list = loadSaved();
    list.push({ origin: commuteOrigin, dest: commuteDest, depart: departInput.value, ret: returnInput.value });
    saveSaved(list);
    renderSaved();
  });

  function slotFor(hourly, timeStr, baseDateIso, dayOffset = 0) {
    if (!timeStr) return null;
    const base = new Date(baseDateIso);
    const [h, m] = timeStr.split(":").map(Number);
    base.setDate(base.getDate() + dayOffset);
    base.setHours(h, m, 0, 0);
    let bestIdx = 0, bestDiff = Infinity;
    hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t) - base);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    });
    return bestIdx;
  }

  function renderSlot(label, weather) {
    const meta = weatherService.describeCode(weather.current.weather_code);
    const verdict = routePlanner.verdictFor(weather);
    const div = document.createElement("div");
    div.className = "commute-slot";
    div.innerHTML = `
      <span>${label}</span>
      <i class="ph-fill ${meta.icon}"></i>
      <span>${meta.label}, ${weatherService.formatTemp(weather.current.temperature_2m)}, wind ${Math.round(weather.current.wind_speed_10m)} ${weatherService.windUnit()}</span>
      <span class="verdict ${verdict.level}">${verdict.label}</span>
    `;
    return div;
  }

  async function runForecast() {
    if (!commuteOrigin || !commuteDest) { alert("Pick an origin and destination from the suggestions."); return; }
    resultsWrap.innerHTML = '<p class="muted">Fetching commute forecast…</p>';
    try {
      const [originWx, destWx] = await Promise.all([
        weatherService.fetchWeatherAt(commuteOrigin.lat, commuteOrigin.lon),
        weatherService.fetchWeatherAt(commuteDest.lat, commuteDest.lon),
      ]);
      resultsWrap.innerHTML = "";

      const depart = departInput.value;
      const ret = returnInput.value;
      const today = originWx.hourly.time[0];
      // A return time earlier than departure means the trip comes back tomorrow.
      const returnDayOffset = depart && ret && ret <= depart ? 1 : 0;

      if (depart) {
        const idx = slotFor(originWx.hourly, depart, today);
        const h = originWx.hourly;
        const meta = weatherService.describeCode(h.weather_code[idx]);
        const synthetic = { current: {
          weather_code: h.weather_code[idx], temperature_2m: h.temperature_2m[idx],
          wind_speed_10m: h.wind_speed_10m[idx],
        } };
        resultsWrap.appendChild(Object.assign(document.createElement("h3"), { textContent: `Departing ${commuteOrigin.name} at ${depart}`, style: "font-size:0.85rem;margin:8px 0 4px;color:var(--text-muted);" }));
        resultsWrap.appendChild(renderSlot(commuteOrigin.name, synthetic));
      }
      if (ret) {
        const idx = slotFor(destWx.hourly, ret, today, returnDayOffset);
        const h = destWx.hourly;
        const synthetic = { current: {
          weather_code: h.weather_code[idx], temperature_2m: h.temperature_2m[idx],
          wind_speed_10m: h.wind_speed_10m[idx],
        } };
        const dayNote = returnDayOffset ? " (next day)" : "";
        resultsWrap.appendChild(Object.assign(document.createElement("h3"), { textContent: `Returning from ${commuteDest.name} at ${ret}${dayNote}`, style: "font-size:0.85rem;margin:12px 0 4px;color:var(--text-muted);" }));
        resultsWrap.appendChild(renderSlot(commuteDest.name, synthetic));
      }
      if (!depart && !ret) {
        resultsWrap.appendChild(renderSlot(commuteOrigin.name, originWx));
        resultsWrap.appendChild(renderSlot(commuteDest.name, destWx));
      }
    } catch (err) {
      console.error(err);
      resultsWrap.innerHTML = '<p class="muted">Couldn\'t build a commute forecast for that route.</p>';
    }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); runForecast(); });
})();

/* ---------------------------------------------------------------------
   3. Precipitation Timeline — dual-axis chart, next 12 hours
--------------------------------------------------------------------- */
(() => {
  let chart = null;
  function render(data) {
    const h = data.hourly;
    const start = weatherService.nowHourIndex(data);
    const labels = h.time.slice(start, start + 12).map((t) => weatherService.formatClock(t));
    const prob = h.precipitation_probability.slice(start, start + 12);
    const amount = h.precipitation.slice(start, start + 12);

    const ctx = document.getElementById("precipChart").getContext("2d");
    const gridColor = getComputedStyle(document.body).getPropertyValue("--border").trim();
    const textColor = getComputedStyle(document.body).getPropertyValue("--text-muted").trim();
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Chance of rain (%)", data: prob, backgroundColor: "#0ea5e988", yAxisID: "y" },
          { type: "line", label: `Amount (${weatherService.precipUnit()})`, data: amount, borderColor: "#2563eb", yAxisID: "y1", tension: 0.35, pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: textColor }, grid: { display: false } },
          y: { position: "left", min: 0, max: 100, ticks: { color: textColor }, grid: { color: gridColor } },
          y1: { position: "right", min: 0, ticks: { color: textColor }, grid: { display: false } },
        },
        plugins: { legend: { labels: { color: textColor } } },
      },
    });

    const maxProb = Math.max(...prob);
    const totalAmount = amount.reduce((a, b) => a + b, 0);
    let summary;
    const unit = weatherService.precipUnit();
    if (maxProb < 20) summary = "Little to no rain expected over the next 12 hours.";
    else if (totalAmount < 0.1) summary = `A ${maxProb}% chance of a passing shower, but little accumulation expected.`;
    else if (maxProb < 50) summary = `A chance of light rain, peaking around ${maxProb}%, with roughly ${totalAmount.toFixed(1)} ${unit} total expected.`;
    else summary = `Rain likely, peaking around ${maxProb}%, with about ${totalAmount.toFixed(1)} ${unit} expected over the next 12 hours.`;
    document.getElementById("precipSummary").textContent = summary;
  }
  document.addEventListener("weatherUpdated", (e) => render(e.detail.data));
  document.addEventListener("themeChanged", () => {
    if (weatherService.state.raw) render(weatherService.state.raw);
  });
  document.addEventListener("panelOpened", (e) => {
    if ((e.detail.id === "panel-precip" || e.detail.id === "intelBody") && weatherService.state.raw) {
      render(weatherService.state.raw);
    }
  });
})();

/* ---------------------------------------------------------------------
   4. Advanced Feels-Like Intelligence
--------------------------------------------------------------------- */
(() => {
  const body = document.getElementById("feelsBody");

  function toF(c) { return c * 9 / 5 + 32; }
  function toC(f) { return (f - 32) * 5 / 9; }

  // Rothfusz regression heat index (inputs in °F, RH in %)
  function heatIndexF(tF, rh) {
    let hi = 0.5 * (tF + 61 + (tF - 68) * 1.2 + rh * 0.094);
    if ((hi + tF) / 2 >= 80) {
      hi = -42.379 + 2.04901523 * tF + 10.14333127 * rh - 0.22475541 * tF * rh
        - 0.00683783 * tF * tF - 0.05481717 * rh * rh + 0.00122874 * tF * tF * rh
        + 0.00085282 * tF * rh * rh - 0.00000199 * tF * tF * rh * rh;
    }
    return hi;
  }

  // Canadian wind chill standard (T in °C, wind in km/h)
  function windChillC(tC, windKmh) {
    return 13.12 + 0.6215 * tC - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * tC * Math.pow(windKmh, 0.16);
  }

  function render(data) {
    const c = data.current;
    const unit = weatherService.state.unit;
    const tempC = unit === "fahrenheit" ? toC(c.temperature_2m) : c.temperature_2m;
    const windKmh = unit === "fahrenheit" ? c.wind_speed_10m * 1.60934 : c.wind_speed_10m;
    const rh = c.relative_humidity_2m;

    let feelsC, mode;
    if (tempC > 27 && rh > 40) {
      const hiF = heatIndexF(toF(tempC), rh);
      feelsC = toC(hiF);
      mode = "Heat Index";
    } else if (tempC < 10 && windKmh > 4.8) {
      feelsC = windChillC(tempC, windKmh);
      mode = "Wind Chill";
    } else {
      feelsC = tempC;
      mode = "Standard";
    }

    const actualDisplay = unit === "fahrenheit" ? c.temperature_2m : tempC;
    const feelsDisplay = unit === "fahrenheit" ? toF(feelsC) : feelsC;
    const delta = feelsDisplay - actualDisplay;

    const dewPoint = data.hourly.dew_point_2m?.[hourIndexNow(data)] ?? null;
    const visibility = data.hourly.visibility?.[hourIndexNow(data)] ?? null;
    const uv = c.uv_index ?? data.hourly.uv_index?.[hourIndexNow(data)] ?? 0;

    let comfort;
    if (Math.abs(delta) < 2) comfort = "Feels about the same as the actual temperature.";
    else if (delta > 0) comfort = mode === "Heat Index" ? "Humidity is making it feel noticeably hotter." : "Feels warmer than the thermometer suggests.";
    else comfort = mode === "Wind Chill" ? "Wind is making it feel noticeably colder." : "Feels cooler than the thermometer suggests.";

    body.innerHTML = `
      <div class="feels-hero">
        <div>
          <div class="muted">${mode} mode</div>
          <div class="feels-delta">${delta >= 0 ? "+" : ""}${Math.round(delta)}${weatherService.unitSymbol()}</div>
          <div class="muted">${weatherService.formatTemp(actualDisplay)} actual → ${weatherService.formatTemp(feelsDisplay)} feels like</div>
        </div>
      </div>
      <p class="summary-text">${comfort}</p>
      <div class="factor-grid">
        <div class="factor"><span class="factor-label">Humidity</span><span class="factor-value">${Math.round(rh)}%</span></div>
        <div class="factor"><span class="factor-label">UV index</span><span class="factor-value">${uv?.toFixed ? uv.toFixed(1) : uv}</span></div>
        <div class="factor"><span class="factor-label">Dew point</span><span class="factor-value">${dewPoint !== null ? weatherService.formatTemp(dewPoint) : "—"}</span></div>
        <div class="factor"><span class="factor-label">Visibility</span><span class="factor-value">${visibility !== null ? (visibility / 1000).toFixed(1) + " km" : "—"}</span></div>
      </div>
    `;
  }

  function hourIndexNow(data) {
    return weatherService.nowHourIndex(data);
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.data));
})();

/* ---------------------------------------------------------------------
   5. Weather Anomaly Detection — vs 5-year historical baseline
--------------------------------------------------------------------- */
(() => {
  const body = document.getElementById("anomalyBody");

  function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function stdev(arr) {
    const m = mean(arr);
    return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
  }
  function zScore(value, arr) {
    const sd = stdev(arr);
    if (sd === 0) return 0;
    return (value - mean(arr)) / sd;
  }
  function badge(z) {
    if (z > 1) return { cls: "above", label: "Above normal" };
    if (z < -1) return { cls: "below", label: "Below normal" };
    return { cls: "normal", label: "Normal range" };
  }

  async function render(location, data) {
    body.innerHTML = '<p class="muted">Comparing against the last 5 years…</p>';
    try {
      // Compare the location's own calendar date, not the visitor's.
      const now = weatherService.localNow(data);
      const archive = await weatherService.fetchArchive(
        location.lat,
        location.lon,
        now.getUTCMonth() + 1,
        now.getUTCDate()
      );

      const isF = weatherService.state.unit === "fahrenheit";
      const toUnit = (c) => (isF ? c * 9 / 5 + 32 : c);
      const clean = (arr) => (arr || []).filter((v) => v !== null && v !== undefined);
      // The archive endpoint always answers in °C and mm, so convert if needed.
      const histMax = clean(archive.temperature_2m_max).map(toUnit);
      const histMin = clean(archive.temperature_2m_min).map(toUnit);
      const histPrecip = clean(archive.precipitation_sum).map((v) => (isF ? v / 25.4 : v));

      if (histMax.length < 2) {
        body.innerHTML = '<p class="muted">Not enough historical data for this location.</p>';
        return;
      }

      const todayMax = data.daily.temperature_2m_max[0];
      const todayMin = data.daily.temperature_2m_min[0];
      const todayPrecip = data.hourly.precipitation.slice(0, 24).reduce((a, b) => a + b, 0);

      const zMax = zScore(todayMax, histMax);
      const zMin = zScore(todayMin, histMin);
      const zPrecip = zScore(todayPrecip, histPrecip);

      const items = [
        { label: "High temp", z: zMax, value: weatherService.formatTemp(todayMax), avg: weatherService.formatTemp(mean(histMax)) },
        { label: "Low temp", z: zMin, value: weatherService.formatTemp(todayMin), avg: weatherService.formatTemp(mean(histMin)) },
        { label: "Precipitation", z: zPrecip, value: `${todayPrecip.toFixed(1)} ${weatherService.precipUnit()}`, avg: `${mean(histPrecip).toFixed(1)} ${weatherService.precipUnit()}` },
      ];

      body.innerHTML = `
        <div class="anomaly-grid">
          ${items.map((it) => {
            const b = badge(it.z);
            return `<div class="anomaly-item">
              <div class="muted">${it.label}</div>
              <div class="az">z = ${it.z.toFixed(2)}</div>
              <div class="muted">${it.value} vs. ${it.avg} avg</div>
              <span class="badge ${b.cls}">${b.label}</span>
            </div>`;
          }).join("")}
        </div>
        <p class="summary-text">Baseline built from ${histMax.length} years of Open‑Meteo Archive data for this calendar date.</p>
      `;
    } catch (err) {
      console.error(err);
      body.innerHTML = '<p class="muted">Couldn\'t load historical data right now.</p>';
    }
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.location, e.detail.data));
})();

/* ---------------------------------------------------------------------
   6. Micro-Weather Comparison — up to 4 locations
--------------------------------------------------------------------- */
(() => {
  const input = document.getElementById("compareInput");
  const results = document.getElementById("compareResults");
  const cardsWrap = document.getElementById("compareCards");
  const tableWrap = document.getElementById("compareTableWrap");
  const summaryEl = document.getElementById("compareSummary");

  let locations = []; // { loc, weather }
  const MAX = 4;

  attachLocationSearch(input, results, async (loc) => {
    if (locations.length >= MAX) { alert("You can compare up to 4 locations. Remove one first."); return; }
    if (locations.some((l) => l.loc.lat.toFixed(2) === loc.lat.toFixed(2) && l.loc.lon.toFixed(2) === loc.lon.toFixed(2))) return;
    input.value = "";
    try {
      const weather = await weatherService.fetchWeatherAt(loc.lat, loc.lon);
      locations.push({ loc, weather });
      render();
    } catch (err) {
      console.error(err);
    }
  });

  function removeAt(i) { locations.splice(i, 1); render(); }

  function render() {
    cardsWrap.innerHTML = "";
    locations.forEach((entry, i) => {
      const meta = weatherService.describeCode(entry.weather.current.weather_code);
      const card = document.createElement("div");
      card.className = "compare-card";
      card.innerHTML = `
        <button class="remove-compare" aria-label="Remove ${entry.loc.name} from comparison"><i class="ph ph-x"></i></button>
        <i class="ph-fill ${meta.icon}"></i>
        <div class="cc-name">${entry.loc.name}</div>
        <div class="cc-temp">${weatherService.formatTemp(entry.weather.current.temperature_2m)}</div>
        <div class="muted">${meta.label}</div>
      `;
      card.querySelector(".remove-compare").addEventListener("click", () => removeAt(i));
      cardsWrap.appendChild(card);
    });

    if (!locations.length) {
      tableWrap.innerHTML = "";
      summaryEl.textContent = "";
      return;
    }

    tableWrap.innerHTML = `
      <table class="compare-table">
        <thead><tr><th>Location</th><th>Temp</th><th>Feels like</th><th>Humidity</th><th>Wind</th><th>Cloud cover</th></tr></thead>
        <tbody>
          ${locations.map((e) => {
            const c = e.weather.current;
            return `<tr>
              <td>${e.loc.name}</td>
              <td>${weatherService.formatTemp(c.temperature_2m)}</td>
              <td>${weatherService.formatTemp(c.apparent_temperature)}</td>
              <td>${Math.round(c.relative_humidity_2m)}%</td>
              <td>${Math.round(c.wind_speed_10m)} ${weatherService.windUnit()}</td>
              <td>${Math.round(c.cloud_cover)}%</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;

    if (locations.length > 1) {
      const warmest = locations.reduce((a, b) => (b.weather.current.temperature_2m > a.weather.current.temperature_2m ? b : a));
      const coolest = locations.reduce((a, b) => (b.weather.current.temperature_2m < a.weather.current.temperature_2m ? b : a));
      const windiest = locations.reduce((a, b) => (b.weather.current.wind_speed_10m > a.weather.current.wind_speed_10m ? b : a));
      summaryEl.textContent = `${warmest.loc.name} is the warmest at ${weatherService.formatTemp(warmest.weather.current.temperature_2m)}, ${coolest.loc.name} is the coolest at ${weatherService.formatTemp(coolest.weather.current.temperature_2m)}, and ${windiest.loc.name} has the strongest wind at ${Math.round(windiest.weather.current.wind_speed_10m)} ${weatherService.windUnit()}.`;
    } else {
      summaryEl.textContent = "";
    }
  }

  // Seed comparison with the current location so the panel isn't empty.
  document.addEventListener("weatherUpdated", (e) => {
    if (locations.length === 0) {
      locations.push({ loc: e.detail.location, weather: e.detail.data });
      render();
    } else if (locations[0]?.loc && e.detail.location.name === locations[0].loc.name) {
      locations[0].weather = e.detail.data;
      render();
    }
  });
})();
