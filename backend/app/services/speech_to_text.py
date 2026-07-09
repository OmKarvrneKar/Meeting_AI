import asyncio
import json
import logging
import os
from typing import Callable, Awaitable
import websockets

logger = logging.getLogger(__name__)

DEEPGRAM_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2"
    "&language=en-US"
    "&punctuate=true"
    "&interim_results=true"
    "&utterance_end_ms=1000"
    "&vad_events=true"
    "&diarize=true"
    "&encoding=linear16"
    "&sample_rate=16000"
    "&channels=1"
)

TranscriptCallback = Callable[[str, bool, int], Awaitable[None]]


class DeepgramStreamingService:
    """
    Manages a persistent WebSocket connection to Deepgram's streaming API.
    Fires `on_transcript(text, is_final)` for every result.
    """

    def __init__(self, on_transcript: TranscriptCallback):
        self._api_key = os.getenv("DEEPGRAM_API_KEY", "")
        if not self._api_key:
            raise EnvironmentError("DEEPGRAM_API_KEY is not set")
        self._on_transcript = on_transcript
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._recv_task: asyncio.Task | None = None
        self._closed = False

    async def connect(self):
        """Open connection to Deepgram and start the receiver loop."""
        headers = {"Authorization": f"Token {self._api_key}"}
        self._ws = await websockets.connect(
            DEEPGRAM_URL,
            additional_headers=headers,
            ping_interval=10,
            ping_timeout=20,
        )
        self._recv_task = asyncio.create_task(self._receive_loop())
        logger.info("Connected to Deepgram streaming API")

    async def send_audio(self, chunk: bytes):
        """Forward raw PCM audio bytes to Deepgram."""
        if self._ws and not self._closed:
            try:
                await self._ws.send(chunk)
            except websockets.ConnectionClosed:
                logger.warning("Deepgram connection closed while sending audio")
                self._closed = True

    async def close(self):
        """Gracefully close the Deepgram connection."""
        self._closed = True
        if self._ws:
            try:
                # Send CloseStream message per Deepgram docs
                await self._ws.send(json.dumps({"type": "CloseStream"}))
                await asyncio.sleep(0.3)
                await self._ws.close()
            except Exception:
                pass
        if self._recv_task:
            self._recv_task.cancel()
        logger.info("Deepgram connection closed")

    async def _receive_loop(self):
        """Continuously read messages from Deepgram and dispatch callbacks."""
        try:
            async for raw in self._ws:
                if self._closed:
                    break
                await self._handle_message(raw)
        except websockets.ConnectionClosed as e:
            if not self._closed:
                logger.warning(f"Deepgram connection closed unexpectedly: {e}")
        except Exception as e:
            logger.error(f"Deepgram receive error: {e}")

    async def _handle_message(self, raw: str | bytes):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        msg_type = msg.get("type", "")

        if msg_type == "Results":
            channel = msg.get("channel", {})
            alternatives = channel.get("alternatives", [])
            if not alternatives:
                return

            transcript = alternatives[0].get("transcript", "").strip()
            if not transcript:
                return

            is_final = msg.get("is_final", False)
            speech_final = msg.get("speech_final", False)

            speaker = 0
            words = alternatives[0].get("words", [])
            if words and "speaker" in words[0]:
                speaker = words[0]["speaker"]

            await self._on_transcript(transcript, is_final or speech_final, speaker)

        elif msg_type == "UtteranceEnd":
            logger.debug("Deepgram: UtteranceEnd received")

        elif msg_type == "SpeechStarted":
            logger.debug("Deepgram: SpeechStarted")

        elif msg_type == "Metadata":
            logger.info(f"Deepgram metadata: {msg}")

        elif msg_type == "Error":
            logger.error(f"Deepgram error message: {msg}")
