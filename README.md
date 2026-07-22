# MeetMind — Real-Time AI Meeting Assistant

A production-ready MVP that captures live audio, transcribes speech in real time using **Deepgram**, detects questions automatically, and generates instant AI answers with **OpenAI GPT-4o** — all displayed in a live React UI.

```
Audio Input → Deepgram STT → Transcript Buffer → Question Detector → Context Builder → GPT-4o → UI
```

---

## Architecture Overview

```
meeting-ai-assistant/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, lifespan
│   │   ├── websocket.py         # WS router, MeetingSession orchestrator
│   │   └── services/
│   │       ├── speech_to_text.py    # Deepgram streaming client
│   │       ├── question_detector.py # Rule-based + LLM fallback detection
│   │       ├── context_manager.py   # 60-second rolling transcript buffer
│   │       └── llm_service.py       # OpenAI GPT-4o answer generation
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/
    ├── src/
    │   ├── App.js               # Root component, WebSocket management
    │   └── components/
    │       ├── AudioRecorder.js # Mic capture, PCM streaming
    │       ├── Transcript.js    # Live scrolling transcript
    │       └── AnswerBox.js     # AI answer cards with loading state
    ├── public/index.html
    ├── package.json
    └── .env.example
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.11+ | [python.org](https://python.org) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| npm | 9+ | Bundled with Node.js |

You also need API keys:
- **Deepgram** — Free tier at [console.deepgram.com](https://console.deepgram.com) (includes $200 credit)
- **OpenAI** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## Setup Instructions

### Step 1 — Clone / Unzip the project

```bash
cd meeting-ai-assistant
```

### Step 2 — Backend Setup

```bash
cd backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate          # macOS/Linux
# venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
```

**Edit `backend/.env`:**
```env
DEEPGRAM_API_KEY=your_deepgram_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o
```

### Step 3 — Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Configure environment (optional — defaults work out of the box)
cp .env.example .env
```

---

## Running Locally

### Terminal 1 — Start the Backend

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

You should see:
```
INFO: Meeting AI Assistant backend starting up...
INFO: Uvicorn running on http://0.0.0.0:8000
```

Verify health:
```bash
curl http://localhost:8000/health
# {"status":"ok","deepgram_configured":true,"openai_configured":true}
```

### Terminal 2 — Start the Frontend

```bash
cd frontend
npm start
```

Browser opens automatically at **http://localhost:3000**

---

## How to Use

1. Open **http://localhost:3000** in Chrome or Firefox (Safari has WebAudio limitations)
2. Click **"Start Meeting"** — allow microphone access when prompted
3. Speak naturally. You'll see live transcription on the left panel
4. Ask a question (e.g. *"What is the best way to handle async errors in Python?"*)
5. The question is **highlighted in blue** in the transcript
6. An **AI answer card** appears on the right within 1–3 seconds

### Question Detection Triggers

The system detects questions via two layers:

**Layer 1 — Rule-Based (instant, zero latency):**
- Sentence ends with `?`
- Starts with: what, why, how, when, where, who, which, can, could, should, will, is, are, do, does, have, etc.

**Layer 2 — LLM Fallback (gpt-4o-mini, ~200ms):**
- Fires asynchronously for ambiguous sentences
- Used for implicit questions like "Tell me about X" or "Explain Y"

---

## Example Test Flow

Speak these sentences to test the full pipeline:

```
"We need to discuss the Q3 roadmap today."
"The team has been working on the new authentication system."
"What is the recommended approach for rate limiting an API?"     ← triggers answer
"I think we should consider using Redis for caching."
"How long does it typically take to set up a Redis cluster?"    ← triggers answer
"Can you explain the difference between horizontal and vertical scaling?"  ← triggers answer
```

---

## WebSocket Message Protocol

### Client → Server
| Type | Payload | Description |
|------|---------|-------------|
| binary | `ArrayBuffer` (Int16 PCM) | Raw audio chunks |
| text | `{"type": "stop"}` | Stop session |

### Server → Client
| Type | Payload | Description |
|------|---------|-------------|
| `session_ready` | — | Deepgram connected, ready for audio |
| `transcript` | `{text, is_final}` | Live transcript update |
| `question_detected` | `{question, confidence}` | Question identified |
| `answer_loading` | `{question}` | LLM request started |
| `answer` | `{question, answer}` | Answer ready |
| `error` | `{message}` | Pipeline error |

---

## Performance Characteristics

| Stage | Target Latency | Implementation |
|-------|---------------|----------------|
| Audio → Deepgram | < 50ms | WebSocket binary streaming |
| Deepgram → Transcript | 200–400ms | Streaming with interim results |
| Question Detection (rule) | < 1ms | In-memory regex |
| Question Detection (LLM) | ~200ms | gpt-4o-mini, async background |
| Context Build | < 1ms | In-memory deque |
| LLM Answer Generation | 800ms–2s | GPT-4o, max_tokens=150, timeout=8s |
| **Total E2E** | **< 3 seconds** | Async pipeline, debounced trigger |

---

## Configuration

### Audio Settings (AudioRecorder.js)
```js
const SAMPLE_RATE = 16000;      // 16kHz mono — Deepgram optimal
const CHUNK_INTERVAL_MS = 100;  // Flush audio every 100ms
```

### Deepgram Parameters (speech_to_text.py)
```
model=nova-2           # Best accuracy/speed balance
punctuate=true         # Enables period/comma/question mark detection
interim_results=true   # Partial transcripts for live UI
utterance_end_ms=1000  # Silence timeout for utterance boundary
vad_events=true        # Voice activity detection
```

### LLM Parameters (llm_service.py)
```python
model="gpt-4o"
max_tokens=150         # Keeps answers to 2-3 sentences
temperature=0.3        # Low for factual consistency
timeout=8.0            # Hard cap to stay within UX target
```

### Context Window (context_manager.py)
```python
window_seconds=60      # Rolling 60-second transcript buffer
MAX_CONTEXT_TOKENS=400 # Trim context to ~400 tokens
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Mic access denied | Permission error shown under record button |
| Backend not running | Error banner shown in UI |
| WebSocket drops | Session resets, user can restart |
| Deepgram API failure | Error propagated to UI via `error` message |
| OpenAI timeout (>8s) | Error card shown instead of answer |
| OpenAI rate limit | Friendly error message in answer card |
| Empty transcript | Silently ignored, no false positives |

---

## Extending the MVP

### Add speaker diarization
```python
# In DEEPGRAM_URL, add:
"&diarize=true"
# Then parse msg["channel"]["alternatives"][0]["words"][i]["speaker"]
```

### Add answer streaming (token-by-token)
```python
# In llm_service.py, use stream=True
async for chunk in await client.chat.completions.create(..., stream=True):
    delta = chunk.choices[0].delta.content or ""
    await websocket.send_text(json.dumps({"type": "answer_chunk", "delta": delta}))
```

### Persist transcripts
```python
# In context_manager.py, swap deque for SQLite with aiosqlite
```

### Add meeting summary on stop
```python
# In websocket.py, on session end:
summary = await llm_service.summarize(context_manager.get_recent_transcript())
await send({"type": "summary", "text": summary})
```

---

## Troubleshooting

**"WebSocket connection error"**
- Ensure backend is running on port 8000
- Check CORS config in `main.py` matches your frontend URL

**"Microphone access denied"**
- Chrome: Settings → Privacy → Microphone → Allow localhost
- Must use HTTPS in production (or localhost for dev)

**No transcription appearing**
- Verify `DEEPGRAM_API_KEY` in `.env`
- Check backend logs for Deepgram connection errors
- Confirm microphone level meter is animating

**Questions not triggering answers**
- Speak clearly and end sentences with "?"
- Check backend logs for `Question detected` messages
- Verify `OPENAI_API_KEY` has available credits
