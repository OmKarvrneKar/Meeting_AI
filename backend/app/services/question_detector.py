import asyncio
import logging
import os
import re
from typing import Optional
import openai

logger = logging.getLogger(__name__)

# Question words that strongly indicate an interrogative sentence
QUESTION_KEYWORDS = frozenset([
    "what", "why", "how", "when", "where", "who", "which", "whom", "whose",
    "can", "could", "would", "should", "will", "shall", "may", "might",
    "is", "are", "was", "were", "do", "does", "did", "have", "has", "had",
])

# Regex: sentence ends with question mark
RE_QUESTION_MARK = re.compile(r"\?\s*$")

# Regex: starts with a question keyword (case-insensitive)
RE_STARTS_WITH_KEYWORD = re.compile(
    r"^\s*(" + "|".join(QUESTION_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


class QuestionDetector:
    """
    Two-layer question detection:
      1. Rule-based (fast, no API call)
      2. LLM-based fallback for ambiguous sentences
    Returns (is_question: bool, confidence: float)
    """

    def __init__(self, llm_threshold: float = 0.5):
        self._llm_threshold = llm_threshold
        self._client: Optional[openai.AsyncOpenAI] = None
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            self._client = openai.AsyncOpenAI(api_key=api_key)

    # ------------------------------------------------------------------ #
    # Public synchronous entry point (wraps async logic)
    # ------------------------------------------------------------------ #
    def detect(self, sentence: str) -> tuple[bool, float]:
        """
        Synchronous wrapper used in the hot path.
        Returns (is_question, confidence).
        Rule-based only — fast, zero latency.
        LLM classification is scheduled asynchronously if ambiguous.
        """
        is_q, confidence, needs_llm = self._rule_based(sentence)
        if needs_llm:
            # Fire-and-forget: we don't block the pipeline.
            # If LLM says it IS a question, it fires via the callback approach.
            # For MVP, we trust rule-based + return current result.
            # LLM fallback is useful for analytics / future improvement.
            asyncio.create_task(self._llm_classify_log(sentence))
        return is_q, confidence

    async def detect_async(self, sentence: str) -> tuple[bool, float]:
        """
        Fully async version — awaits LLM fallback when needed.
        Use this if you want LLM classification to gate the answer.
        """
        is_q, confidence, needs_llm = self._rule_based(sentence)
        if needs_llm and self._client:
            is_q, confidence = await self._llm_classify(sentence)
        return is_q, confidence

    # ------------------------------------------------------------------ #
    # Layer 1: Rule-based detection
    # ------------------------------------------------------------------ #
    def _rule_based(self, sentence: str) -> tuple[bool, float, bool]:
        """
        Returns (is_question, confidence, needs_llm_fallback).
        High confidence → skip LLM.
        Low/medium confidence → schedule LLM.
        """
        text = sentence.strip()
        if not text:
            return False, 0.0, False

        has_qmark = bool(RE_QUESTION_MARK.search(text))
        starts_with_kw = bool(RE_STARTS_WITH_KEYWORD.match(text))

        # Strong signal: question mark present
        if has_qmark:
            return True, 0.95, False

        # Medium signal: starts with question word
        if starts_with_kw:
            return True, 0.75, False

        # Weak signal: contains question word somewhere in sentence
        words = set(re.findall(r"\b\w+\b", text.lower()))
        common = words & QUESTION_KEYWORDS
        if common and len(text.split()) <= 15:
            # Short sentence with question keyword — likely a question
            return True, 0.55, True  # Ask LLM to confirm

        return False, 0.1, False

    # ------------------------------------------------------------------ #
    # Layer 2: LLM-based classification
    # ------------------------------------------------------------------ #
    async def _llm_classify(self, sentence: str) -> tuple[bool, float]:
        if not self._client:
            return False, 0.1

        try:
            response = await self._client.chat.completions.create(
                model="gpt-4o-mini",  # Fast, cheap, good for classification
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a sentence classifier. "
                            "Respond with exactly one word: YES or NO.\n"
                            "YES = the sentence is a question (direct or indirect).\n"
                            "NO = the sentence is not a question."
                        ),
                    },
                    {"role": "user", "content": f'Sentence: "{sentence}"'},
                ],
                max_tokens=5,
                temperature=0,
            )
            answer = response.choices[0].message.content.strip().upper()
            is_q = answer.startswith("YES")
            confidence = 0.9 if is_q else 0.85
            logger.debug(f"LLM classifier: {sentence!r} → {answer}")
            return is_q, confidence
        except Exception as e:
            logger.warning(f"LLM question classification failed: {e}")
            return False, 0.1

    async def _llm_classify_log(self, sentence: str):
        """Fire-and-forget LLM call used for logging/analytics."""
        try:
            result = await self._llm_classify(sentence)
            logger.debug(f"Background LLM classification result: {result}")
        except Exception:
            pass
