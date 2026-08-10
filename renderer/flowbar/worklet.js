// AudioWorklet processor: forwards raw Float32 mono frames + an RMS level
// for the live waveform. Runs on the audio thread.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._batch = [];
    this._batchLen = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      const frame = new Float32Array(input[0]);
      this._batch.push(frame);
      this._batchLen += frame.length;
      // Post ~every 1024 samples (≈21 ms at 48 kHz) to limit message traffic.
      if (this._batchLen >= 1024) {
        const merged = new Float32Array(this._batchLen);
        let off = 0;
        for (const f of this._batch) {
          merged.set(f, off);
          off += f.length;
        }
        let sum = 0;
        for (let i = 0; i < merged.length; i++) sum += merged[i] * merged[i];
        const rms = Math.sqrt(sum / merged.length);
        this.port.postMessage({ samples: merged, rms }, [merged.buffer]);
        this._batch = [];
        this._batchLen = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
