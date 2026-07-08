import React, { useState, useRef, useEffect, useCallback } from "react";

const SAMPLE_RATE = 16000;
const CHUNK_INTERVAL_MS = 100; // Send audio every 100ms
const CHUNK_SIZE = 4096;

export default function AudioRecorder({
  onAudioChunk,
  onRecordingStart,
  onRecordingStop,
  sessionReady,
  sessionState,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [permissionError, setPermissionError] = useState(null);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const workletNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const levelTimerRef = useRef(null);
  const chunkBufferRef = useRef([]);
  const chunkTimerRef = useRef(null);

  // ─── Audio Level Meter ────────────────────────────────────────────────
  const startLevelMeter = useCallback(() => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      setAudioLevel(Math.min(100, (avg / 128) * 100));
      levelTimerRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // ─── Float32 → Int16 PCM conversion ──────────────────────────────────
  const float32ToInt16 = (float32Array) => {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  };

  // ─── Flush buffered audio chunks ──────────────────────────────────────
  const flushChunks = useCallback(() => {
    if (chunkBufferRef.current.length === 0) return;
    const totalLen = chunkBufferRef.current.reduce((s, c) => s + c.length, 0);
    const merged = new Int16Array(totalLen);
    let offset = 0;
    for (const chunk of chunkBufferRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    chunkBufferRef.current = [];
    onAudioChunk(merged.buffer);
  }, [onAudioChunk]);

  // ─── Start recording ──────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      onRecordingStart();

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // Analyser for level meter
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      if (audioCtx.audioWorklet) {
        await audioCtx.audioWorklet.addModule("/audio-processor.worklet.js");
        const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
        });
        workletNodeRef.current = workletNode;
        workletNode.port.onmessage = (e) => {
          chunkBufferRef.current.push(new Int16Array(e.data));
        };
        source.connect(workletNode);
      } else {
        const processor = audioCtx.createScriptProcessor(CHUNK_SIZE, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0);
          chunkBufferRef.current.push(float32ToInt16(float32));
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
      }

      // Flush chunks at regular intervals
      chunkTimerRef.current = setInterval(flushChunks, CHUNK_INTERVAL_MS);

      startLevelMeter();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access error:", err);
      if (err.name === "NotAllowedError") {
        setPermissionError("Microphone access denied. Please allow mic access and try again.");
      } else {
        setPermissionError(`Could not access microphone: ${err.message}`);
      }
    }
  }, [onRecordingStart, flushChunks, startLevelMeter]);

  // ─── Stop recording ───────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    clearInterval(chunkTimerRef.current);
    cancelAnimationFrame(levelTimerRef.current);

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    chunkBufferRef.current = [];
    setAudioLevel(0);
    setIsRecording(false);
    onRecordingStop();
  }, [onRecordingStop]);

  const handleToggle = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  useEffect(() => {
    return () => stopRecording();
  }, []); // eslint-disable-line

  const isConnecting = sessionState === "connecting";

  return (
    <div className="audio-recorder">
      <div className="recorder-controls">
        <button
          className={`record-btn ${isRecording ? "recording" : ""} ${isConnecting ? "connecting" : ""}`}
          onClick={handleToggle}
          disabled={isConnecting}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          {isConnecting ? (
            <span className="btn-spinner" />
          ) : isRecording ? (
            <StopIcon />
          ) : (
            <MicIcon />
          )}
          <span className="btn-label">
            {isConnecting ? "Connecting…" : isRecording ? "Stop" : "Start Meeting"}
          </span>
        </button>

        {isRecording && (
          <div className="level-meter" aria-label={`Audio level: ${Math.round(audioLevel)}%`}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className={`level-bar ${audioLevel > (i / 12) * 100 ? "active" : ""}`}
                style={{ animationDelay: `${i * 30}ms` }}
              />
            ))}
          </div>
        )}
      </div>

      {permissionError && (
        <div className="permission-error">
          <span>🎙 {permissionError}</span>
        </div>
      )}
    </div>
  );
}

const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-2 15.9A8 8 0 0 0 20 11h-2a6 6 0 0 1-12 0H4a8 8 0 0 0 10 7.9V21H8v2h8v-2h-6v-2.1z" />
  </svg>
);

const StopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
