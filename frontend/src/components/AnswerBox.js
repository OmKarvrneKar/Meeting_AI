import React, { useEffect, useRef } from "react";

export default function AnswerBox({ answers }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [answers]);

  return (
    <div className="answer-panel">
      <div className="panel-header">
        <span className="panel-title">AI Answers</span>
        {answers.length > 0 && (
          <span className="entry-count">{answers.length} answers</span>
        )}
      </div>

      <div className="answer-body">
        {answers.length === 0 && (
          <div className="transcript-empty">
            <div className="empty-icon">✦</div>
            <p>AI answers will appear here when questions are detected.</p>
            <p className="empty-hint">
              Ask questions naturally — ending with "?" or starting with "What", "How", "Why", etc.
            </p>
          </div>
        )}

        {answers.map((item) => (
          <AnswerCard key={item.id} item={item} />
        ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function AnswerCard({ item }) {
  const showLoading = item.loading && !item.answer;
  const showStreaming = item.streaming && !item.loading;

  return (
    <div className={`answer-card ${item.loading ? "loading" : "loaded"}`}>
      <div className="answer-question">
        <span className="answer-q-icon">?</span>
        <span>{item.question}</span>
      </div>

      <div className="answer-body-content">
        {showLoading ? (
          <div className="answer-loading">
            <div className="loading-dots">
              <span /><span /><span />
            </div>
            <span className="loading-label">Generating answer…</span>
          </div>
        ) : (
          <div className={`answer-text ${showStreaming ? "streaming" : ""}`}>
            <span className="answer-ai-icon">✦</span>
            <p>
              {item.answer}
              {showStreaming && <span className="stream-cursor">▋</span>}
            </p>
          </div>
        )}
      </div>

      <div className="answer-footer">
        <span className="answer-tag">AI Generated</span>
      </div>
    </div>
  );
}
