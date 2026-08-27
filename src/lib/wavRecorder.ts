/**
 * Minimal Web Audio PCM recorder that always produces a complete 16 kHz mono
 * WAV file — MediaRecorder fragments (and iOS Safari's fragmented MP4) are
 * rejected by transcription models, so we encode the container ourselves.
 *
 * Optional voice-activity detection (VAD) lets callers run hands-free: the
 * recorder reports when speech starts and when the speaker has gone quiet, so
 * the UI can auto-stop and transcribe without a stop button.
 */
export interface VadOptions {
  /** RMS level above which audio counts as speech (0–1). */
  threshold?: number;
  /** Silence after speech before `onSilence` fires (ms). */
  silenceMs?: number;
  /** Fires once the first speech is detected. */
  onSpeechStart?: () => void;
  /** Fires once when the speaker has gone quiet after speaking. */
  onSilence?: () => void;
  /** Continuous input level (0–1) for meters. */
  onLevel?: (level: number) => void;
}

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private vad: VadOptions | null = null;
  private speechStarted = false;
  private silenceFired = false;
  private quietSince: number | null = null;

  async start(vad?: VadOptions) {
    this.vad = vad ?? null;
    this.speechStarted = false;
    this.silenceFired = false;
    this.quietSince = null;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      if (this.vad) this.analyse(data);
    };
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** True once the speaker has actually said something. */
  get hasSpeech() {
    return this.speechStarted;
  }

  private analyse(data: Float32Array) {
    const vad = this.vad!;
    const threshold = vad.threshold ?? 0.015;
    const silenceMs = vad.silenceMs ?? 1600;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    vad.onLevel?.(Math.min(1, rms * 8));

    if (rms > threshold) {
      this.quietSince = null;
      if (!this.speechStarted) {
        this.speechStarted = true;
        vad.onSpeechStart?.();
      }
      return;
    }
    if (!this.speechStarted || this.silenceFired) return;
    const now = Date.now();
    if (this.quietSince === null) {
      this.quietSince = now;
      return;
    }
    if (now - this.quietSince >= silenceMs) {
      this.silenceFired = true;
      vad.onSilence?.();
    }
  }


  /** Stops capture and returns the recording as a base64 WAV payload. */
  async stop(): Promise<{ base64: string; bytes: number }> {
    const sampleRate = this.ctx?.sampleRate ?? 48000;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    this.source?.disconnect();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;

    const pcm = downsample(concat(this.chunks), sampleRate, 16000);
    const wav = encodeWav(pcm, 16000);
    return { base64: toBase64(wav), bytes: wav.byteLength };
  }

  cancel() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    this.source?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.chunks = [];
    this.ctx = null;
    this.stream = null;
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}
