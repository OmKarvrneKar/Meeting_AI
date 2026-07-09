import logging
import os
from typing import AsyncGenerator, Optional
import openai

from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert AI meeting assistant. 
Your job is to answer questions that arise during live meetings.

Rules:
- Answer in 2–3 sentences maximum. Be direct and precise.
- Use the conversation context provided to inform your answer.
- If the context doesn't contain relevant information, answer from general knowledge.
- Speak naturally, as if you're a knowledgeable colleague.
- Never say "Based on the context" or "According to the transcript" — just answer.
- If the question is unclear, give the most reasonable interpretation.
"""

ANSWER_PROMPT_TEMPLATE = """{context}

Answer the question above concisely (2–3 sentences max). Be direct."""


class LLMService:
    """
    Generates concise answers using OpenAI GPT-4o.
    Optimized for low latency in a live meeting context.
    """

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise EnvironmentError("OPENAI_API_KEY is not set")
        self._client = openai.AsyncOpenAI(api_key=api_key)
        self._model = os.getenv("OPENAI_MODEL", "gpt-4o")

    async def generate_answer(
        self,
        question: str,
        context: str,
        max_tokens: int = 150,
    ) -> str:
        """
        Generate a concise answer for the given question with conversation context.
        Returns the answer string.
        Raises on API failure (caller should handle).
        """
        rag_context = rag_service.retrieve_context(question)
        if rag_context:
            context = f"{context}\n\n[Reference Document Context]\n{rag_context}"
            
        user_message = ANSWER_PROMPT_TEMPLATE.format(context=context)

        logger.info(f"Generating answer for: {question!r}")

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                max_tokens=max_tokens,
                temperature=0.3,    # Low temp for factual, consistent answers
                top_p=0.9,
                frequency_penalty=0.1,
                presence_penalty=0.0,
                timeout=8.0,        # Hard timeout to stay within 3s UX target
            )

            answer = response.choices[0].message.content.strip()
            usage = response.usage
            logger.info(
                f"Answer generated | tokens: {usage.total_tokens} | "
                f"model: {self._model}"
            )
            return answer

        except openai.APITimeoutError:
            logger.error("OpenAI API timed out")
            raise RuntimeError("Answer generation timed out. Please try again.")

        except openai.RateLimitError:
            logger.error("OpenAI rate limit hit")
            raise RuntimeError("Rate limit reached. Please wait a moment.")

        except openai.APIConnectionError as e:
            logger.error(f"OpenAI connection error: {e}")
            raise RuntimeError("Connection to AI service failed.")

        except openai.APIStatusError as e:
            logger.error(f"OpenAI API error {e.status_code}: {e.message}")
            raise RuntimeError(f"AI service error: {e.message}")

    async def generate_answer_stream(
        self,
        question: str,
        context: str,
        max_tokens: int = 150,
    ) -> AsyncGenerator[str, None]:
        """
        Stream answer tokens for the given question with conversation context.
        Yields content deltas as they arrive.
        """
        rag_context = rag_service.retrieve_context(question)
        if rag_context:
            context = f"{context}\n\n[Reference Document Context]\n{rag_context}"

        user_message = ANSWER_PROMPT_TEMPLATE.format(context=context)

        logger.info(f"Streaming answer for: {question!r}")

        try:
            stream = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                max_tokens=max_tokens,
                temperature=0.3,
                top_p=0.9,
                frequency_penalty=0.1,
                presence_penalty=0.0,
                timeout=8.0,
                stream=True,
            )

            async for event in stream:
                if not event.choices:
                    continue
                delta = event.choices[0].delta.content
                if delta:
                    yield delta

        except openai.APITimeoutError:
            logger.error("OpenAI API timed out")
            raise RuntimeError("Answer generation timed out. Please try again.")

        except openai.RateLimitError:
            logger.error("OpenAI rate limit hit")
            raise RuntimeError("Rate limit reached. Please wait a moment.")

        except openai.APIConnectionError as e:
            logger.error(f"OpenAI connection error: {e}")
            raise RuntimeError("Connection to AI service failed.")

        except openai.APIStatusError as e:
            logger.error(f"OpenAI API error {e.status_code}: {e.message}")
            raise RuntimeError(f"AI service error: {e.message}")

    async def classify_question(self, sentence: str) -> Optional[bool]:
        """
        Standalone LLM question classification.
        Returns True/False/None (None = API error).
        """
        try:
            response = await self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "Respond YES if the sentence is a question, NO if not. One word only.",
                    },
                    {"role": "user", "content": sentence},
                ],
                max_tokens=3,
                temperature=0,
            )
            answer = response.choices[0].message.content.strip().upper()
            return answer.startswith("YES")
        except Exception as e:
            logger.warning(f"LLM question classification failed: {e}")
            return None

    async def extract_action_item(self, sentence: str) -> Optional[str]:
        try:
            response = await self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "Extract the specific task or action item from the text. If there is no action item, respond with 'NONE'. Respond concisely with just the task.",
                    },
                    {"role": "user", "content": sentence},
                ],
                max_tokens=30,
                temperature=0,
            )
            answer = response.choices[0].message.content.strip()
            if answer.upper() == "NONE":
                return None
            return answer
        except Exception as e:
            logger.warning(f"LLM action item extraction failed: {e}")
            return None

    async def translate_text(self, text: str, target_language: str = "Spanish") -> Optional[str]:
        try:
            response = await self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": f"Translate the following text to {target_language}. Respond ONLY with the translated text.",
                    },
                    {"role": "user", "content": text},
                ],
                max_tokens=100,
                temperature=0,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"LLM translation failed: {e}")
            return None
