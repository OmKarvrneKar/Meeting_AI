import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.websocket import router as ws_router

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Meeting AI Assistant backend starting up...")
    required_keys = ["DEEPGRAM_API_KEY", "OPENAI_API_KEY"]
    missing = [k for k in required_keys if not os.getenv(k)]
    if missing:
        logger.warning(f"Missing environment variables: {missing}")
    yield
    logger.info("Meeting AI Assistant backend shutting down...")


app = FastAPI(
    title="Meeting AI Assistant",
    description="Real-time meeting transcription and AI-powered Q&A",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_router)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "deepgram_configured": bool(os.getenv("DEEPGRAM_API_KEY")),
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
    }
