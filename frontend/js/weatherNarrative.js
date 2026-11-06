/**
 * weatherNarrative.js — the plain-English summary at the top of the page.
 * Derived entirely from the forecast already in memory; no extra requests.
 */
(() => {
  const container = document.getElementById("narrative-text");

  const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

  function cardinal(degrees) {
    if (degrees === null || degrees === undefined) return "";
    return COMPASS[Math.round(degrees / 45) % 8];
  }

  function greeting(hour) {
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    if (hour >= 17 && hour < 21) return "Good evening";
    return "Still up";
  }

  function render(location, data) {
    if (!container || !data?.current || !data.hourly || !data.daily) return;

    const cur = data.current;
    const hourly = data.hourly;
    const daily = data.daily;
    const meta = weatherService.describeCode(cur.weather_code, cur.is_day === 1);
    const localNow = weatherService.localNow(data);
    const hour = localNow.getUTCHours();
    const temp = weatherService.formatTemp(cur.temperature_2m);
    const feels = weatherService.formatTemp(cur.apparent_temperature);
    const place = location?.name ? ` in ${location.name}` : "";

    const sentences = [];
    sentences.push(`${greeting(hour)}${place}. ${meta.label} and ${temp} right now, feeling closer to ${feels}.`);

    // Wind, only worth mentioning when it is noticeable.
    const wind = Math.round(cur.wind_speed_10m);
    const gust = Math.round(cur.wind_gusts_10m ?? 0);
    const windThreshold = weatherService.state.unit === "fahrenheit" ? 10 : 16;
    if (wind >= windThreshold) {
      const gustText = gust > wind + 8 ? `, gusting to ${gust}` : "";
      sentences.push(
        `Wind is coming from the ${cardinal(cur.wind_direction_10m)} at ${wind}${gustText} ${weatherService.windUnit()}.`
      );
    }

    // Rain outlook for the next 12 hours.
    const start = weatherService.nowHourIndex(data);
    const probs = hourly.precipitation_probability.slice(start, start + 12);
    const values = probs.filter((v) => v !== null && v !== undefined);
    if (values.length) {
      const peak = Math.max(...values);
      const peakIndex = start + probs.indexOf(peak);
      if (peak >= 50) {
        sentences.push(`Rain is likely around ${weatherService.formatClock(hourly.time[peakIndex])}, peaking near ${Math.round(peak)}%.`);
      } else if (peak >= 25) {
        sentences.push(`There is a ${Math.round(peak)}% chance of rain later today.`);
      } else {
        sentences.push("No meaningful rain expected over the next 12 hours.");
      }
    }

    // Tomorrow, on its own line of thought.
    if (daily.temperature_2m_max?.length > 1) {
      const tomorrow = weatherService.describeCode(daily.weather_code[1], true);
      sentences.push(
        `Tomorrow looks ${tomorrow.label.toLowerCase()}, ${weatherService.formatTemp(daily.temperature_2m_max[1])} high and ${weatherService.formatTemp(daily.temperature_2m_min[1])} low.`
      );
    }

    const uv = daily.uv_index_max?.[0] ?? cur.uv_index;
    if (uv >= 6) {
      const label = uv >= 11 ? "extreme" : uv >= 8 ? "very high" : "high";
      sentences.push(`UV index reaches ${Math.round(uv)} (${label}) — sun protection is worth it.`);
    }

    container.textContent = sentences.join(" ");
  }

  document.addEventListener("weatherUpdated", (e) => render(e.detail.location, e.detail.data));
})();
