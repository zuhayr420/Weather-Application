# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-14

### Added
- Deepest-level hybrid geocoding engine aggregating OpenStreetMap (Nominatim), Komoot Photon, Wikipedia MediaWiki, and Open-Meteo.
- Coordinate parsing engine supporting decimal GPS (`27.1822, 88.5033`) and cardinal notations (`40.7128N, 74.0060W`).
- Real-time weather dashboard with 24-hour hourly forecast strip, 7-day synoptic forecast, and dynamic Chart.js temperature/precipitation visualizer.
- Environmental air quality monitor with US AQI gauge and individual pollutant metrics ($\text{PM}_{2.5}$, $\text{PM}_{10}$, $\text{NO}_2$, $\text{SO}_2$, $\text{CO}$, $\text{O}_3$).
- Celestial tracking module with interactive SVG sun elevation arc, golden hour, blue hour, and celestial moon phases.
- Dynamic 360° wind compass with vector needle and Beaufort scale indicators.
- 3-hour barometric pressure tendency analyzer with meteorological change indicators.
- Interactive Leaflet radar map with animated RainViewer precipitation loop, satellite imagery, and weather field layers.
- OSRM driving route weather hazard analyzer with waypoint weather inspection.
- Real-time in-browser GPS journey tracker with breadcrumbs, heading, and altitude telemetry.
- 5-year climate anomaly detector comparing current conditions against Open-Meteo Historical Archive baselines.
- Single-page application architecture with dual deployment modes: Full-Stack FastAPI or Static Client-Only.
- PWA manifest and service worker shell caching.
- Continuous Integration workflow with Python 3.10–3.12 test matrix and CodeQL static security analysis.
- Editorial Times New Roman typography system with dual light glass and night slate themes.
