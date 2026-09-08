// Screen recorder: captures the output canvas (and the audio input, when the
// analyser has one) with MediaRecorder and downloads the file on stop: .mp4
// (H.264 + AAC) where the browser can mux it (Chrome 126+), .webm otherwise.
// What is recorded is exactly what the projector shows: the panel is DOM.

export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  error: string | null = null;

  constructor(private canvas: HTMLCanvasElement, private audio: () => MediaStream | null) {}

  get recording(): boolean {
    return this.rec?.state === 'recording';
  }

  /** Seconds since the recording started, 0 when idle. */
  get elapsed(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  toggle() {
    if (this.recording) this.stop();
    else this.start();
  }

  start() {
    if (this.rec) return;
    this.error = null;
    try {
      const stream = this.canvas.captureStream(60);
      const audioTracks = this.audio()?.getAudioTracks() ?? [];
      for (const t of audioTracks) stream.addTrack(t);
      const candidates = audioTracks.length > 0
        ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4',
           'video/webm;codecs=vp9,opus', 'video/webm']
        : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m));
      this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
      this.chunks = [];
      this.rec.ondataavailable = (ev) => { if (ev.data.size > 0) this.chunks.push(ev.data); };
      this.rec.onstop = () => this.download();
      this.rec.onerror = () => { this.error = 'error al grabar'; this.rec = null; };
      this.rec.start(1000);
      this.startedAt = performance.now();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.rec = null;
    }
  }

  stop() {
    this.rec?.stop();
  }

  private download() {
    const type = this.rec?.mimeType || 'video/webm';
    this.rec = null;
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vv3-${stamp}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}
