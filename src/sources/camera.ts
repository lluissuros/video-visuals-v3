// Webcam input for the performer-tracking prototype.

export class CameraSource {
  element: HTMLVideoElement | null = null;
  error: string | null = null;

  async start(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360, facingMode: 'user' },
        audio: false,
      });
      const v = document.createElement('video');
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      await v.play();
      this.element = v;
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  stop() {
    const stream = this.element?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.element = null;
  }
}
