import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import routers
from routes import weather

app = FastAPI(title="Real-Time Weather API")

# Configure CORS
frontend_url = os.getenv("FRONTEND_URL", "*")
origins = [frontend_url] if frontend_url != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(weather.router, prefix="/api")

@app.get("/api/health")
async def health_check():
    """Backend health check endpoint."""
    return {"status": "ok", "message": "Weather API is running"}

# Serve static files for the frontend if the frontend directory exists
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend')
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
