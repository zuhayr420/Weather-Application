/**
 * theme.js — dark/light theme toggle and °C/°F unit toggle, both persisted.
 */
(() => {
  const themeToggle = document.getElementById("themeToggle");
  const unitToggle = document.getElementById("unitToggle");
  const body = document.body;

  function applyTheme(theme) {
    body.dataset.theme = theme;
    localStorage.setItem("wx.theme", theme);
    const icon = themeToggle.querySelector("i");
    icon.className = theme === "dark" ? "ph ph-sun" : "ph ph-moon";
    themeToggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
    document.dispatchEvent(new CustomEvent("themeChanged", { detail: { theme } }));
  }

  const savedTheme =
    localStorage.getItem("wx.theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    applyTheme(body.dataset.theme === "dark" ? "light" : "dark");
  });

  function applyUnitLabel(unit) {
    unitToggle.textContent = unit === "fahrenheit" ? "°F" : "°C";
  }
  applyUnitLabel(weatherService.state.unit);

  unitToggle.addEventListener("click", async () => {
    const next = weatherService.state.unit === "fahrenheit" ? "celsius" : "fahrenheit";
    applyUnitLabel(next);
    await weatherService.setUnit(next);
  });
})();
