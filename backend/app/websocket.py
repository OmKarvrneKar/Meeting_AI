import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
# pyrefly: ignore [missing-import]
from textblob import TextBlob

from app.services.speech_to_text import DeepgramStreamingService
from app.services.question_detector import QuestionDetector
from app.services.context_manager import ContextManager
from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter()

# WebSocket message types:
# - session_ready
# - transcript
# - question_detected
# - answer_loading
# - answer
# - answer_chunk
# - answer_done
# - error


class MeetingSession:
    """
    Manages one full meeting session per WebSocket connection.
    Coordinates: audio → STT → buffer → question detection → LLM → UI
    """

    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.context_manager = ContextManager(window_seconds=60)
        self.question_detector = QuestionDetector()
        self.llm_service = LLMService()
        self.stt_service = DeepgramStreamingService(
            on_transcript=self._handle_transcript
        )
        self._answer_lock = asyncio.Lock()
        self._pending_question: str | None = None
        self._debounce_task: asyncio.Task | None = None
        self._closed = False

    async def _send(self, payload: dict):
        """Safe send — silently drops if socket already closed."""
        if not self._closed:
            try:
                await self.websocket.send_text(json.dumps(payload))
            except Exception:
                self._closed = True

    async def _handle_transcript(self, text: str, is_final: bool, speaker: int = 0):
        """Called by Deepgram service for every partial/final transcript."""
        if not text.strip():
            return

        # Always push to context buffer
        self.context_manager.add_transcript(text, is_final=is_final)

        # Basic sentiment analysis using TextBlob
        sentiment_score = TextBlob(text).sentiment.polarity

        # Send live transcript update to frontend
        await self._send({
            "type": "transcript",
            "text": text,
            "is_final": is_final,
            "sentiment": sentiment_score,
            "speaker": speaker,
        })

        if is_final:
            asyncio.create_task(self._translate_and_send(text))
            await self._check_for_question(text)
            await self._check_for_action(text)

    async def _check_for_question(self, sentence: str):
        """Question detection with debounce to avoid duplicate triggers."""
        is_q, confidence = self.question_detector.detect(sentence)
        if not is_q:
            return

        logger.info(f"Question detected (confidence={confidence:.2f}): {sentence!r}")

        # Notify UI that a question was detected
        await self._send({
            "type": "question_detected",
            "question": sentence,
            "confidence": confidence,
        })

        # Debounce: cancel any pending answer task for closely grouped questions
        if self._debounce_task and not self._debounce_task.done():
            self._debounce_task.cancel()

        self._pending_question = sentence
        self._debounce_task = asyncio.create_task(self._debounced_answer(sentence))

    async def _debounced_answer(self, question: str, delay: float = 0.8):
        """Wait briefly in case more of the question arrives, then generate answer."""
        try:
            await asyncio.sleep(delay)
            if self._pending_question != question:
                return  # A newer question superseded this one
            await self._generate_answer(question)
        except asyncio.CancelledError:
            pass

    async def _generate_answer(self, question: str):
        async with self._answer_lock:
            await self._send({"type": "answer_loading", "question": question})
            try:
                context = self.context_manager.build_context(question)
                async for delta in self.llm_service.generate_answer_stream(
                    question=question,
                    context=context,
                ):
                    await self._send({
                        "type": "answer_chunk",
                        "question": question,
                        "delta": delta,
                    })
                await self._send({
                    "type": "answer_done",
                    "question": question,
                })
            except Exception as e:
                logger.error(f"LLM generation failed: {e}")
                await self._send({
                    "type": "error",
                    "message": f"Failed to generate answer: {str(e)}",
                    "code": "llm_error",
                })

    async def _translate_and_send(self, text: str):
        translation = await self.llm_service.translate_text(text, "Spanish")
        if translation:
            await self._send({
                "type": "translation",
                "original": text,
                "translated": translation,
            })

    async def _check_for_action(self, sentence: str):
        lower_sent = sentence.lower()
        if any(trigger in lower_sent for trigger in ["action item", "task", "remind me"]):
            action = await self.llm_service.extract_action_item(sentence)
            if action:
                logger.info(f"Action item detected: {action}")
                await self._send({
                    "type": "action_item",
                    "item": action,
                })

    async def _generate_summary(self):
        transcript = self.context_manager.get_recent_transcript()
        if len(transcript.strip()) < 20:
            return

        try:
            response = await self.llm_service._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant. Summarize the following meeting transcript in a few bullet points. Also list any action items clearly."},
                    {"role": "user", "content": transcript}
                ],
                max_tokens=300,
                temperature=0.5
            )
            summary = response.choices[0].message.content.strip()
            
            await self._send({"type": "summary", "text": summary})
            
            from app.db import save_meeting
            await save_meeting(transcript, summary)
            
        except Exception as e:
            logger.error(f"Summary generation failed: {e}")

    async def run(self):
        """Main session loop: receive audio chunks, feed to Deepgram."""
        try:
            await self.stt_service.connect()
            logger.info("Deepgram connection established")
            await self._send({"type": "session_ready"})

            async for chunk in self._audio_stream():
                await self.stt_service.send_audio(chunk)

        except WebSocketDisconnect:
            logger.info("Client disconnected")
        except Exception as e:
            logger.error(f"Session error: {e}")
            await self._send({
                "type": "error",
                "message": str(e),
                "code": "session_error",
            })
        finally:
            await self.stt_service.close()
            self._closed = True

    async def _audio_stream(self):
        """Generator that yields raw audio bytes from the WebSocket."""
        while True:
            try:
                data = await self.websocket.receive()
                if data.get("type") == "websocket.disconnect":
                    break
                if "bytes" in data:
                    yield data["bytes"]
                elif "text" in data:
                    # Control messages (e.g. {"type": "stop"})
                    msg = json.loads(data["text"])
                    if msg.get("type") == "stop":
                        logger.info("Client sent stop signal")
                        await self._generate_summary()
                        break
            except WebSocketDisconnect:
                break


@router.websocket("/ws/meeting")
async def meeting_websocket(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"New meeting session from {websocket.client}")
    session = MeetingSession(websocket)
    await session.run()
