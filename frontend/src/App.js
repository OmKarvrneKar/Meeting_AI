import React, { useState, useEffect, useRef, useCallback } from "react";
import Transcript from "./components/Transcript";
import AnswerBox from "./components/AnswerBox";
import AudioRecorder from "./components/AudioRecorder";
import "./App.css";

const WS_URL = process.env.REACT_APP_WS_URL || "ws://localhost:8000/ws/meeting";

export default function App() {
  const [sessionState, setSessionState] = useState("idle"); // idle | connecting | ready | recording | error
  const [transcriptEntries, setTranscriptEntries] = useState([]);
  const [answers, setAnswers] = useState([]); // [{ question, answer, loading, streaming, id }]
  const [error, setError] = useState(null);
  const [partialText, setPartialText] = useState("");

  const wsRef = useRef(null);
  const answerIdRef = useRef(0);

  // ─── WebSocket Management ──────────────────────────────────────────────
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setSessionState("connecting");
    setError(null);

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error("[WS] Failed to parse message", e);
      }
    };

    ws.onerror = (e) => {
      console.error("[WS] Error", e);
      setError("WebSocket connection error. Is the backend running?");
      setSessionState("error");
    };

    ws.onclose = (e) => {
      console.log("[WS] Closed", e.code, e.reason);
      if (sessionState !== "idle") {
        setSessionState("idle");
      }
    };
  }, []); // eslint-disable-line

  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
      wsRef.current.close();
      wsRef.current = null;
    }
    setSessionState("idle");
  }, []);

  // ─── Message Handler ───────────────────────────────────────────────────
  const handleServerMessage = useCallback((msg) => {
    switch (msg.type) {
      case "session_ready":
        setSessionState("ready");
        break;

      case "transcript": {
        if (msg.is_final) {
          setPartialText("");
          setTranscriptEntries((prev) => [
            ...prev,
            { id: Date.now(), text: msg.text, isQuestion: false, timestamp: new Date() },
          ]);
        } else {
          setPartialText(msg.text);
        }
        break;
      }

      case "question_detected": {
        // Mark the last matching transcript entry as a question
        setTranscriptEntries((prev) =>
          prev.map((entry) =>
            entry.text === msg.question
              ? { ...entry, isQuestion: true }
              : entry
          )
        );
        break;
      }

      case "answer_loading": {
        const id = ++answerIdRef.current;
        setAnswers((prev) => [
          ...prev,
          { id, question: msg.question, answer: "", loading: true, streaming: true },
        ]);
        break;
      }

      case "answer_chunk": {
        setAnswers((prev) =>
          prev.map((a) =>
            a.question === msg.question
              ? {
                  ...a,
                  answer: `${a.answer || ""}${msg.delta}`,
                  loading: false,
                  streaming: true,
                }
              : a
          )
        );
        break;
      }

      case "answer_done": {
        setAnswers((prev) =>
          prev.map((a) =>
            a.question === msg.question
              ? { ...a, loading: false, streaming: false }
              : a
          )
        );
        break;
      }

      case "answer": {
        setAnswers((prev) =>
          prev.map((a) =>
            a.question === msg.question && a.loading
              ? { ...a, answer: msg.answer, loading: false, streaming: false }
              : a
          )
        );
        break;
      }

      case "error":
        setError(msg.message);
        break;

      default:
        console.log("[WS] Unknown message type:", msg.type);
    }
  }, []);

  // ─── Audio chunk sender ────────────────────────────────────────────────
  const sendAudioChunk = useCallback((chunk) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(chunk);
    }
  }, []);

  // ─── Recording state sync ──────────────────────────────────────────────
  const handleRecordingStart = useCallback(() => {
    connectWebSocket();
    setSessionState("connecting");
    setTranscriptEntries([]);
    setAnswers([]);
    setPartialText("");
    setError(null);
  }, [connectWebSocket]);

  const handleRecordingStop = useCallback(() => {
    disconnectWebSocket();
  }, [disconnectWebSocket]);

  // ─── Session ready → tell AudioRecorder ───────────────────────────────
  const isSessionReady = sessionState === "ready" || sessionState === "recording";

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">◉</span>
            <span className="logo-text">MeetMind</span>
          </div>
          <span className="logo-tagline">Real-Time AI Meeting Assistant</span>
        </div>
        <div className="header-status">
          <StatusPill state={sessionState} />
        </div>
      </header>

      <main className="app-main">
        <div className="left-panel">
          <AudioRecorder
            onAudioChunk={sendAudioChunk}
            onRecordingStart={handleRecordingStart}
            onRecordingStop={handleRecordingStop}
            sessionReady={isSessionReady}
            sessionState={sessionState}
          />

          {error && (
            <div className="error-banner">
              <span className="error-icon">⚠</span>
              <span>{error}</span>
              <button onClick={() => setError(null)} className="error-dismiss">×</button>
            </div>
          )}

          <Transcript
            entries={transcriptEntries}
            partialText={partialText}
          />
        </div>

        <div className="right-panel">
          <AnswerBox answers={answers} />
        </div>
      </main>
    </div>
  );
}

function StatusPill({ state }) {
  const config = {
    idle: { label: "Idle", color: "gray" },
    connecting: { label: "Connecting...", color: "yellow" },
    ready: { label: "Ready", color: "blue" },
    recording: { label: "Live", color: "green", pulse: true },
    error: { label: "Error", color: "red" },
  };
  const { label, color, pulse } = config[state] || config.idle;
  return (
    <div className={`status-pill status-${color}`}>
      <span className={`status-dot ${pulse ? "pulse" : ""}`} />
      {label}
    </div>
  );
}
