# Contributing to Meridian Weather

Thank you for your interest in contributing to Meridian Weather. We welcome contributions from developers, designers, and meteorological enthusiasts!

---

## Code of Conduct

This project adheres to the Contributor Covenant [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## Getting Started

1. **Fork the Repository**: Click "Fork" at the top right of the repository page.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/Weather-Application.git
   cd Weather-Application
   ```
3. **Set up a Virtual Environment**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

---

## Development Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your improvements. Maintain the project's **Times New Roman** typographic guidelines and subtle, non-intrusive styling.
3. Run the test suite:
   ```bash
   pytest tests/ -v
   ```
4. Commit your changes using **Conventional Commits**:
   - `feat: add barometric trend alert indicators`
   - `fix: resolve coordinates inversion in route geocoder`
   - `docs: update deployment guidelines for Cloudflare Pages`
5. Push to your branch and open a **Pull Request**.

---

## Coding Guidelines

- **Python**: Follow PEP 8 guidelines. Keep backend routes asynchronous (`async def`) and include docstrings.
- **JavaScript**: Write standard modern ES6+ modules. Do not introduce bulky external frameworks (e.g. React/Vue) — Meridian is intentionally lightweight and dependency-minimal.
- **CSS**: Preserve CSS custom properties and the dual-theme token structure in `frontend/css/styles.css`.
