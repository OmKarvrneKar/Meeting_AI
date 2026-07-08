import logging
import time
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

MAX_CONTEXT_TOKENS = 400   # Conservative budget for context in prompt
AVG_CHARS_PER_TOKEN = 4    # Rough approximation


@dataclass
class TranscriptEntry:
    text: str
    timestamp: float = field(default_factory=time.monotonic)
    is_final: bool = True


class ContextManager:
    """
    Maintains a rolling window of transcript entries.
    Provides context-building for the LLM prompt.
    """

    def __init__(self, window_seconds: int = 60):
        self._window_seconds = window_seconds
        self._buffer: deque[TranscriptEntry] = deque()
        self._last_final_text: str = ""

    def add_transcript(self, text: str, is_final: bool = True):
        """
        Add a transcript segment to the buffer.
        Partial results are held separately and replaced on final.
        Final results are committed to the rolling buffer.
        """
        if not text.strip():
            return

        if not is_final:
            # Don't add partial results to the committed buffer
            # (they'll come back as final shortly)
            return

        # Avoid duplicate consecutive entries (Deepgram sometimes re-sends)
        if text == self._last_final_text:
            return

        self._last_final_text = text
        entry = TranscriptEntry(text=text, is_final=True)
        self._buffer.append(entry)
        self._evict_old_entries()
        logger.debug(f"Buffer size: {len(self._buffer)} entries")

    def get_recent_transcript(self) -> str:
        """Return the rolling window transcript as a single string."""
        self._evict_old_entries()
        return " ".join(e.text for e in self._buffer).strip()

    def build_context(self, question: str) -> str:
        """
        Build the context string for the LLM.
        Trims to MAX_CONTEXT_TOKENS worth of characters.
        """
        self._evict_old_entries()
        transcript = self.get_recent_transcript()

        if not transcript:
            return f"Question asked in a meeting: {question}"

        # Trim transcript to budget
        max_chars = MAX_CONTEXT_TOKENS * AVG_CHARS_PER_TOKEN
        if len(transcript) > max_chars:
            transcript = "..." + transcript[-max_chars:]

        context = (
            f"[Recent meeting conversation — last {self._window_seconds} seconds]\n"
            f"{transcript}\n\n"
            f"[Question just asked]\n"
            f"{question}"
        )
        return context

    def clear(self):
        """Reset the buffer (e.g. on session restart)."""
        self._buffer.clear()
        self._last_final_text = ""

    def _evict_old_entries(self):
        """Remove entries older than the rolling window."""
        cutoff = time.monotonic() - self._window_seconds
        while self._buffer and self._buffer[0].timestamp < cutoff:
            self._buffer.popleft()

    @property
    def entry_count(self) -> int:
        return len(self._buffer)
