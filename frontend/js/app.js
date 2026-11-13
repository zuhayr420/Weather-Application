/**
 * app.js — renders the primary weather views whenever `weatherUpdated` fires.
 *
 * All times come from weatherService's formatters, which read Open-Meteo's
 * local wall-clock strings, so a forecast for Tokyo shows Tokyo's hours even
 * when you are in London.
 */
(() => {
  const els = {
    name: document.getElementById("locationName"),
    date: document.getElementById("locationDate"),
    icon: document.getElementById("currentIcon"),
    temp: document.getElementById("currentTemp"),
    condition: document.getElementById("currentCondition"),
    feels: document.getElementById("feelsLike"),
    humidity: document.getElementById("statHumidity"),
    wind: document.getElementById("statWind"),
    pressure: document.getElementById("statPressure"),
    clouds: document.getElementById("statClouds"),
    sunrise: document.getElementById("statSunrise"),
    sunset: document.getElementById("statSunset"),
    hourlyStrip: document.getElementById("hourlyStrip"),
    dailyList: document.getElementById("dailyList"),
    bgOverlay: document.getElementById("bgOverlay"),
    chartMetric: document.getElementById("chartMetric"),
  };

  let trendChart = null;

  function renderCurrent(loc, data) {
    const cur = data.current;
    const meta = weatherService.describeCode(cur.weather_code, cur.is_day === 1);
    els.name.textContent = [loc.name, loc.region].filter(Boolean).join(", ");

    els.date.textContent = weatherService.localDateLabel(data);

    els.icon.className = `ph-fill ${meta.icon} current-icon`;
    els.temp.textContent = weatherService.formatTemp(cur.temperature_2m);
    els.condition.textContent = meta.label;
    els.feels.textContent = `Feels like ${weatherService.formatTemp(cur.apparent_temperature)}`;

    els.humidity.textContent = `${Math.round(cur.relative_humidity_2m)}%`;
    els.wind.textContent = `${Math.round(cur.wind_speed_10m)} ${weatherService.windUnit()}`;
    els.pressure.textContent = `${Math.round(cur.pressure_msl)} hPa`;
    els.clouds.textContent = `${Math.round(cur.cloud_cover)}%`;

    if (data.daily?.sunrise?.[0]) {
      els.sunrise.textContent = weatherService.formatClock(data.daily.sunrise[0]);
      els.sunset.textContent = weatherService.formatClock(data.daily.sunset[0]);
    }

    els.bgOverlay.className = `bg-overlay cond-${meta.group}`;
    document.title = `${weatherService.formatTemp(cur.temperature_2m)} ${meta.label} · ${loc.name} — Meridian`;
  }

  function renderHourly(data) {
    const h = data.hourly;
    const startIdx = weatherService.nowHourIndex(data);
    els.hourlyStrip.innerHTML = "";

    for (let i = startIdx; i < startIdx + 24 && i < h.time.length; i++) {
      const meta = weatherService.describeCode(h.weather_code[i], h.is_day?.[i] !== 0);
      const div = document.createElement("div");
      div.className = "hour-item";
      div.innerHTML = `
        <span class="hour-time">${i === startIdx ? "Now" : weatherService.formatClock(h.time[i])}</span>
        <i class="ph-fill ${meta.icon}" aria-hidden="true"></i>
        <span class="hour-temp">${weatherService.formatTemp(h.temperature_2m[i])}</span>
        <span class="hour-precip">${Math.round(h.precipitation_probability?.[i] ?? 0)}%</span>
      `;
      els.hourlyStrip.appendChild(div);
    }
  }

  function renderDaily(data) {
    const d = data.daily;
    els.dailyList.innerHTML = "";
    d.time.forEach((t, i) => {
      const meta = weatherService.describeCode(d.weather_code[i], true);
      const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : weatherService.formatWeekday(t);
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="day-name">${label}</span>
        <i class="ph-fill ${meta.icon}" aria-hidden="true"></i>
        <span class="day-desc">${meta.label}${d.precipitation_probability_max ? ` · ${Math.round(d.precipitation_probability_max[i])}% rain` : ""}</span>
        <span class="day-temps"><span class="hi">${weatherService.formatTemp(d.temperature_2m_max[i])}</span> <span class="lo">${weatherService.formatTemp(d.temperature_2m_min[i])}</span></span>
      `;
      els.dailyList.appendChild(li);
    });
  }

  function nextHours(data, count) {
    const h = data.hourly;
    const startIdx = weatherService.nowHourIndex(data);
    return {
      labels: h.time.slice(startIdx, startIdx + count).map((t) => weatherService.formatClock(t)),
      temp: h.temperature_2m.slice(startIdx, startIdx + count),
      precip: h.precipitation.slice(startIdx, startIdx + count),
      wind: h.wind_speed_10m.slice(startIdx, startIdx + count),
    };
  }

  if (window.Chart) {
    Chart.defaults.font.family = '"Times New Roman", Times, Georgia, serif';
  }

  function renderChart(data) {
    const metric = els.chartMetric.value;
    const { labels, temp, precip, wind } = nextHours(data, 24);
    const series = { temperature: temp, precipitation: precip, wind: wind }[metric];
    const config = {
      temperature: { label: `Temperature (${weatherService.unitSymbol()})`, color: "#2563eb" },
      precipitation: { label: `Precipitation (${weatherService.precipUnit()})`, color: "#0ea5e9" },
      wind: { label: `Wind speed (${weatherService.windUnit()})`, color: "#8b5cf6" },
    }[metric];

    const ctx = document.getElementById("trendChart").getContext("2d");
    const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim() || config.color;
    const gridColor = getComputedStyle(document.body).getPropertyValue("--border").trim();
    const textColor = getComputedStyle(document.body).getPropertyValue("--text-muted").trim();

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: metric === "precipitation" ? "bar" : "line",
      data: {
        labels,
        datasets: [{
          label: config.label,
          data: series,
          borderColor: accent,
          backgroundColor: metric === "precipitation" ? accent + "aa" : accent + "22",
          fill: metric !== "precipitation",
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: { family: '"Times New Roman", Times, Georgia, serif', size: 13 },
            bodyFont: { family: '"Times New Roman", Times, Georgia, serif', size: 12 },
          }
        },
        scales: {
          x: {
            ticks: {
              color: textColor,
              maxTicksLimit: 8,
              font: { family: '"Times New Roman", Times, Georgia, serif', size: 11 }
            },
            grid: { color: gridColor }
          },
          y: {
            ticks: {
              color: textColor,
              font: { family: '"Times New Roman", Times, Georgia, serif', size: 11 }
            },
            grid: { color: gridColor }
          },
        },
      },
    });
  }

  els.chartMetric.addEventListener("change", () => {
    if (weatherService.state.raw) renderChart(weatherService.state.raw);
  });

  document.addEventListener("weatherUpdated", (e) => {
    const { location, data } = e.detail;
    if (!location || !data?.current) return;
    renderCurrent(location, data);
    renderHourly(data);
    renderDaily(data);
    renderChart(data);
  });

  document.addEventListener("weatherError", () => {
    if (!weatherService.state.raw) {
      els.condition.textContent = "Couldn't load weather. Check your connection.";
    }
  });

  // Re-render chart when theme changes so grid/axis colors stay legible.
  document.addEventListener("themeChanged", () => {
    if (weatherService.state.raw) renderChart(weatherService.state.raw);
  });
})();
