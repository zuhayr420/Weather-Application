"""
Root-level entry point for deployment platforms (Railway, Render, Heroku, Docker, etc.)
This file lives at the repo root and imports the FastAPI app from backend/main.py.
"""
import os
import sys

# Ensure root directory is on sys.path
root_dir = os.path.dirname(os.path.abspath(__file__))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from backend.main import app  # noqa: F401 — re-exported for uvicorn

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
