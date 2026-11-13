/**
 * favorites.js — star a location, quick-access bar, localStorage persistence.
 */
const favoritesManager = (() => {
  const STORAGE_KEY = "wx.favorites";
  const bar = document.getElementById("favoritesBar");
  const favBtn = document.getElementById("favoriteBtn");

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function save(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }

  let favorites = load();

  function keyFor(loc) { return `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`; }

  function isFavorite(loc) {
    return !!loc && favorites.some((f) => keyFor(f) === keyFor(loc));
  }

  function toggle(loc) {
    if (!loc) return;
    if (isFavorite(loc)) {
      favorites = favorites.filter((f) => keyFor(f) !== keyFor(loc));
    } else {
      favorites.push(loc);
    }
    save(favorites);
    render();
    updateStarButton(loc);
  }

  function updateStarButton(loc) {
    const active = isFavorite(loc);
    favBtn.classList.toggle("active", active);
    favBtn.setAttribute("aria-pressed", String(active));
    favBtn.querySelector("i").className = active ? "ph-fill ph-star" : "ph ph-star";
    favBtn.setAttribute("aria-label", active ? "Remove from favorites" : "Save this location to favorites");
  }

  function render() {
    bar.innerHTML = "";
    favorites.forEach((loc) => {
      const chip = document.createElement("div");
      chip.className = "fav-chip";
      const current = weatherService.state.location;
      if (current && keyFor(current) === keyFor(loc)) chip.classList.add("active");

      const btn = document.createElement("button");
      btn.style.background = "none";
      btn.style.border = "none";
      btn.style.padding = "0";
      btn.style.font = "inherit";
      btn.style.color = "inherit";
      btn.style.cursor = "pointer";
      btn.textContent = loc.name;
      btn.setAttribute("aria-label", `Show weather for ${loc.name}`);
      btn.addEventListener("click", () => weatherService.setLocation(loc));

      const remove = document.createElement("button");
      remove.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
      remove.setAttribute("aria-label", `Remove ${loc.name} from favorites`);
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        toggle(loc);
      });

      chip.appendChild(btn);
      chip.appendChild(remove);
      bar.appendChild(chip);
    });
  }

  favBtn.addEventListener("click", () => toggle(weatherService.state.location));

  document.addEventListener("weatherUpdated", (e) => {
    updateStarButton(e.detail.location);
    render();
  });

  render();

  return { isFavorite, toggle, list: () => favorites };
})();
