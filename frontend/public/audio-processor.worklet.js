class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this._bufferLen = 0;
    this._targetSize = 4096;
  }

  _appendBuffer(input) {
    if (this._bufferLen === 0) {
      this._buffer = input.slice();
      this._bufferLen = this._buffer.length;
      return;
    }

    const merged = new Float32Array(this._bufferLen + input.length);
    merged.set(this._buffer, 0);
    merged.set(input, this._bufferLen);
    this._buffer = merged;
    this._bufferLen = merged.length;
  }

  _emitChunk() {
    if (this._bufferLen < this._targetSize) return;

    const chunk = this._buffer.subarray(0, this._targetSize);
    const remaining = this._buffer.subarray(this._targetSize);
    this._buffer = remaining.slice();
    this._bufferLen = this._buffer.length;

    const int16 = new Int16Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this.port.postMessage(int16.buffer, [int16.buffer]);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData) return true;

    this._appendBuffer(channelData);
    while (this._bufferLen >= this._targetSize) {
      this._emitChunk();
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
