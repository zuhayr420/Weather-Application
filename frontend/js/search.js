/**
 * search.js
 * ---------
 * A single reusable autocomplete component, attached to any <input> +
 * results <ul>. Used by the header search, route planner, commute planner,
 * and micro-weather comparison field.
 */
function attachLocationSearch(inputEl, resultsEl, onSelect, { debounceMs = 180 } = {}) {
  let timer = null;
  let items = [];
  let activeIndex = -1;
  let currentReqId = 0;

  function closeResults() {
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    activeIndex = -1;
    inputEl.setAttribute("aria-expanded", "false");
  }

  function renderResults(list) {
    items = list;
    resultsEl.innerHTML = "";
    if (!list.length) {
      resultsEl.innerHTML = `<li style="padding:10px 14px;color:var(--text-muted);font-size:0.85rem;text-align:center;">No matching locations found</li>`;
      resultsEl.hidden = false;
      inputEl.setAttribute("aria-expanded", "true");
      return;
    }
    list.forEach((loc, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = `${inputEl.id}-opt-${i}`;
      li.className = "search-result-item";

      const iconClass = loc.categoryIcon || "ph-map-pin";
      const catLabel = loc.categoryLabel || "Place";
      const meta = [loc.region, loc.country].filter(Boolean).join(", ");

      li.innerHTML = `
        <div class="result-row">
          <div class="result-icon-box">
            <i class="ph-bold ${iconClass}"></i>
          </div>
          <div class="result-text-col">
            <div class="result-title-line">
              <span class="result-name">${escapeHtml(loc.name)}</span>
              <span class="result-badge">${escapeHtml(catLabel)}</span>
            </div>
            <span class="result-meta">${escapeHtml(meta || loc.displayName || "")}</span>
          </div>
        </div>
      `;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select(loc);
      });
      resultsEl.appendChild(li);
    });
    resultsEl.hidden = false;
    inputEl.setAttribute("aria-expanded", "true");
  }

  function select(loc) {
    inputEl.value = loc.name;
    closeResults();
    onSelect(loc);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { closeResults(); return; }

    const reqId = ++currentReqId;
    timer = setTimeout(async () => {
      try {
        const results = await weatherService.geocodeSearch(q);
        if (reqId === currentReqId) {
          renderResults(results);
        }
      } catch (err) {
        if (reqId === currentReqId) {
          console.error("search failed", err);
          closeResults();
        }
      }
    }, debounceMs);
  });

  inputEl.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown") {
      if (resultsEl.hidden) return;
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlight();
    } else if (e.key === "ArrowUp") {
      if (resultsEl.hidden) return;
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer);
      const target = activeIndex >= 0 ? items[activeIndex] : items[0];
      if (target) {
        select(target);
      } else {
        const q = inputEl.value.trim();
        if (q.length >= 2) {
          resultsEl.innerHTML = `<li class="search-loading" style="padding:10px 14px;color:var(--text-muted);font-size:0.85rem;display:flex;align-items:center;gap:8px;"><div class="spinner" style="width:12px;height:12px;border-width:1.5px;"></div>Finding "${escapeHtml(q)}"…</li>`;
          resultsEl.hidden = false;
          inputEl.setAttribute("aria-expanded", "true");
          try {
            const results = await weatherService.geocodeSearch(q);
            if (results && results.length > 0) {
              select(results[0]);
            } else {
              resultsEl.innerHTML = `<li style="padding:10px 14px;color:var(--text-muted);font-size:0.85rem;text-align:center;">No matching locations found for "${escapeHtml(q)}"</li>`;
            }
          } catch (err) {
            closeResults();
          }
        }
      }
    } else if (e.key === "Escape") {
      closeResults();
    }
  });

  function highlight() {
    [...resultsEl.children].forEach((li, i) => li.classList.toggle("active", i === activeIndex));
    resultsEl.setAttribute("aria-activedescendant", items[activeIndex] ? `${inputEl.id}-opt-${activeIndex}` : "");
  }

  document.addEventListener("click", (e) => {
    if (!resultsEl.contains(e.target) && e.target !== inputEl) closeResults();
  });

  return { close: closeResults };
}

// --- Header search + geolocation -------------------------------------------
(() => {
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  const locateBtn = document.getElementById("locateBtn");

  attachLocationSearch(input, results, (loc) => {
    weatherService.setLocation(loc);
  });

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by this browser.");
      return;
    }
    weatherService.setStatus(true, "Locating…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const loc = await weatherService.reverseGeocode(latitude, longitude);
          input.value = loc.name;
          await weatherService.setLocation(loc);
        } catch (err) {
          console.error(err);
          weatherService.setStatus(false);
        }
      },
      (err) => {
        console.error(err);
        weatherService.setStatus(false);
        alert("Couldn't get your location. Please allow location access and try again.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // First paint: show the last viewed place immediately, then refresh it.
  // Only a first-time visitor gets the geolocation prompt — after that we
  // respect wherever they last looked.
  async function bootstrap() {
    const fallback = { name: "New York", region: "New York", country: "United States", lat: 40.7128, lon: -74.006 };

    const restored = weatherService.restoreSnapshot();
    if (restored) {
      await weatherService.refresh({ quiet: true });
      return;
    }

    if (!navigator.geolocation) {
      await weatherService.setLocation(fallback);
      return;
    }

    // Never leave the dashboard empty while the permission prompt sits open:
    // show a default place, then upgrade if the browser answers.
    const useFallback = async () => {
      if (weatherService.state.location) return;
      await weatherService.setLocation(fallback);
    };
    const fallbackTimer = setTimeout(useFallback, 5000);

    weatherService.setStatus(true, "Locating…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        clearTimeout(fallbackTimer);
        try {
          const loc = await weatherService.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          input.value = loc.name;
          await weatherService.setLocation(loc);
        } catch {
          await useFallback();
        }
      },
      async () => {
        clearTimeout(fallbackTimer);
        await useFallback();
      },
      { timeout: 6000, maximumAge: 5 * 60 * 1000 }
    );
  }

  // Run after every module has attached its weatherUpdated listener.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    setTimeout(bootstrap, 0);
  }
})();
