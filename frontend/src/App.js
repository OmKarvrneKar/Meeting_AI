import React, { useState, useEffect, useRef, useCallback } from "react";
import Transcript from "./components/Transcript";
import AnswerBox from "./components/AnswerBox";
import AudioRecorder from "./components/AudioRecorder";
import Login from "./components/Login";
import "./App.css";

const WS_URL = process.env.REACT_APP_WS_URL || "ws://localhost:8000/ws/meeting";

export default function App() {
  const [sessionState, setSessionState] = useState("idle"); // idle | connecting | ready | recording | error
  const [transcriptEntries, setTranscriptEntries] = useState([]);
  const [answers, setAnswers] = useState([]); // [{ question, answer, loading, streaming, id }]
  const [error, setError] = useState(null);
  const [partialText, setPartialText] = useState("");
  const [actionItems, setActionItems] = useState([]);
  const [sentiment, setSentiment] = useState(0);
  const [translations, setTranslations] = useState([]);
  const [meetingSummary, setMeetingSummary] = useState(null);
  
  const [user, setUser] = useState(null);
  const [wakeWords, setWakeWords] = useState("");
  const [isFlashing, setIsFlashing] = useState(false);

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
      // We don't close immediately so we can receive the summary.
      // Server will close the socket.
      setTimeout(() => {
          if (wsRef.current) {
              wsRef.current.close();
              wsRef.current = null;
          }
      }, 5000); // 5 sec timeout fallback
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
            { id: Date.now(), text: msg.text, isQuestion: false, timestamp: new Date(), speaker: msg.speaker },
          ]);
          
          if (wakeWords.trim().length > 0) {
             const words = wakeWords.split(',').map(w => w.trim().toLowerCase());
             const lowerText = msg.text.toLowerCase();
             if (words.some(w => lowerText.includes(w))) {
               setIsFlashing(true);
               try {
                 const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                 const oscillator = audioCtx.createOscillator();
                 oscillator.type = 'sine';
                 oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
                 oscillator.connect(audioCtx.destination);
                 oscillator.start();
                 oscillator.stop(audioCtx.currentTime + 0.1);
               } catch(e) {}
               setTimeout(() => setIsFlashing(false), 1000);
             }
          }
        } else {
          setPartialText(msg.text);
        }
        if (msg.sentiment !== undefined) {
          setSentiment(msg.sentiment);
        }
        break;
      }

      case "action_item": {
        setActionItems(prev => [...prev, msg.item]);
        break;
      }

      case "translation": {
        setTranslations(prev => [...prev, { original: msg.original, translated: msg.translated }]);
        break;
      }
      
      case "summary": {
        setMeetingSummary(msg.text);
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
    setActionItems([]);
    setTranslations([]);
    setMeetingSummary(null);
    setError(null);
  }, [connectWebSocket]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const res = await fetch("http://localhost:8000/upload-context", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Document uploaded successfully! Ingested ${data.chunks_ingested} chunks.`);
      } else {
        alert(`Error: ${data.detail}`);
      }
    } catch (err) {
      alert("Failed to upload document.");
    }
  };

  const handleExportMarkdown = () => {
    let md = "# Meeting Notes\n\n";
    md += "## Action Items\n";
    actionItems.forEach(item => md += `- ${item}\n`);
    md += "\n## Transcript\n";
    transcriptEntries.forEach(t => md += `**${t.timestamp.toLocaleTimeString()}** - ${t.text}\n`);
    md += "\n## Q&A\n";
    answers.forEach(a => md += `**Q:** ${a.question}\n**A:** ${a.answer}\n\n`);

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "meeting-notes.md";
    a.click();
    URL.revokeObjectURL(url);
  };

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

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className={`app ${isFlashing ? 'flash-alert' : ''}`}>
      <header className="app-header">
        <div className="header-left" style={{display: 'flex', alignItems: 'center'}}>
          <div className="logo">
            <span className="logo-icon">◉</span>
            <span className="logo-text">MeetMind</span>
          </div>
          <span className="logo-tagline">Real-Time AI Meeting Assistant</span>
          <div style={{marginLeft: "30px"}}>
             <input type="file" accept=".pdf" onChange={handleFileUpload} style={{display: 'none'}} id="pdf-upload" />
             <label htmlFor="pdf-upload" style={{
                 background: '#3b82f6', color: 'white', padding: '6px 12px', 
                 borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem'
             }}>Upload PDF (RAG Context)</label>
          </div>
          <div style={{marginLeft: "15px"}}>
             <button onClick={handleExportMarkdown} style={{
                 background: 'rgba(255,255,255,0.1)', color: 'white', padding: '6px 12px', 
                 borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', border: '1px solid rgba(255,255,255,0.2)',
                 backdropFilter: 'blur(10px)'
             }}>Export Notes (MD)</button>
          </div>
          <div style={{marginLeft: "15px"}}>
             <input 
               type="text" 
               placeholder="Wake words (e.g. John, Project)" 
               value={wakeWords}
               onChange={e => setWakeWords(e.target.value)}
               style={{
                 background: 'rgba(255,255,255,0.05)', color: 'white', padding: '6px 12px', 
                 borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)',
                 backdropFilter: 'blur(10px)', outline: 'none', fontSize: '0.85rem', width: '220px'
               }}
             />
          </div>
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
          <div style={{display: 'flex', gap: '1rem', marginBottom: '1rem'}}>
             <div style={{flex: 1, background: 'rgba(30,30,30,0.4)', backdropFilter: 'blur(12px)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)'}}>
               <h3 style={{marginTop: 0, fontSize: '0.9rem', color: '#888', textTransform: 'uppercase'}}>Sentiment</h3>
               <div style={{fontSize: '1.5rem', marginTop: '0.5rem'}}>
                 {sentiment > 0.3 ? '😊 Positive' : sentiment < -0.3 ? '😠 Negative' : '😐 Neutral'}
                 <span style={{fontSize: '1rem', marginLeft: '10px', color: '#888'}}>({sentiment.toFixed(2)})</span>
               </div>
             </div>
             
             <div style={{flex: 2, background: 'rgba(30,30,30,0.4)', backdropFilter: 'blur(12px)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)'}}>
               <h3 style={{marginTop: 0, fontSize: '0.9rem', color: '#888', textTransform: 'uppercase'}}>Action Items</h3>
               <ul style={{margin: 0, paddingLeft: '1.2rem', color: '#6ee7b7', marginTop: '0.5rem'}}>
                 {actionItems.length === 0 && <li style={{color: '#555', listStyle: 'none', marginLeft: '-1.2rem'}}>No action items detected...</li>}
                 {actionItems.map((item, i) => <li key={i}>{item}</li>)}
               </ul>
             </div>
          </div>
          
          <div style={{background: 'rgba(30,30,30,0.4)', backdropFilter: 'blur(12px)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)'}}>
            <h3 style={{marginTop: 0, fontSize: '0.9rem', color: '#888', textTransform: 'uppercase'}}>Live Spanish Translation</h3>
            <div style={{color: '#93c5fd', minHeight: '1.5rem', fontSize: '1.1rem', marginTop: '0.5rem'}}>
              {translations.length > 0 ? translations[translations.length - 1].translated : "Waiting for speech..."}
            </div>
          </div>
          
          {meetingSummary && (
            <div style={{background: 'rgba(30,30,30,0.4)', backdropFilter: 'blur(12px)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid rgba(168,85,247,0.3)', boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)'}}>
              <h3 style={{marginTop: 0, fontSize: '0.9rem', color: '#a855f7', textTransform: 'uppercase'}}>Post-Meeting Summary</h3>
              <div style={{color: '#e8eaf0', fontSize: '0.95rem', marginTop: '0.5rem', whiteSpace: 'pre-wrap'}}>
                {meetingSummary}
              </div>
            </div>
          )}

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
