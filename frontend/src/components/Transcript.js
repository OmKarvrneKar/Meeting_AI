import React, { useEffect, useRef } from "react";

export default function Transcript({ entries, partialText }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);

  // Auto-scroll to bottom as new entries arrive
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, partialText]);

  return (
    <div className="transcript-panel">
      <div className="panel-header">
        <span className="panel-title">Live Transcript</span>
        {entries.length > 0 && (
          <span className="entry-count">{entries.length} segments</span>
        )}
      </div>

      <div className="transcript-body" ref={containerRef}>
        {entries.length === 0 && !partialText && (
          <div className="transcript-empty">
            <div className="empty-icon">🎙</div>
            <p>Start the meeting to see live transcription here.</p>
            <p className="empty-hint">Questions will be automatically detected and highlighted.</p>
          </div>
        )}

        {entries.map((entry) => (
          <TranscriptEntry key={entry.id} entry={entry} />
        ))}

        {partialText && (
          <div className="transcript-entry partial">
            <span className="entry-text">{partialText}</span>
            <span className="partial-indicator">…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function TranscriptEntry({ entry }) {
  const time = entry.timestamp
    ? entry.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  return (
    <div className={`transcript-entry ${entry.isQuestion ? "is-question" : ""}`}>
      <span className="entry-time">{time}</span>
      <span className="entry-text">
        {entry.isQuestion && <span className="question-badge">Q</span>}
        {entry.text}
      </span>
    </div>
  );
}
