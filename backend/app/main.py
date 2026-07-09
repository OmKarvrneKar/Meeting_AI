import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.websocket import router as ws_router
from app.services.rag_service import rag_service
from app.db import init_db

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
        
    await init_db()
    
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


@app.post("/upload-context")
async def upload_context(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    try:
        chunks = await rag_service.ingest_pdf(file)
        return {"status": "success", "chunks_ingested": chunks}
    except Exception as e:
        logger.error(f"Error ingesting PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
