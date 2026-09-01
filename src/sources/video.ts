// Source clip -> texture. Muted + loop so autoplay is allowed everywhere.
// Supports playback speed and looping a short region ("stay on these 2 s").

import * as THREE from 'three';

export class VideoSource {
  readonly element: HTMLVideoElement;
  readonly texture: THREE.VideoTexture;
  ready = false;
  /** Loop region start in seconds, null = whole clip. */
  loopStart: number | null = null;
  loopLength = 2;
  private nudge: number;

  constructor(url: string, startAt: number | null = null) {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    this.element = v;
    this.texture = new THREE.VideoTexture(v);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    v.addEventListener('loadedmetadata', () => {
      // Never open on the clip's title card: start somewhere inside it.
      // ?seek=<seconds> pins it for reproducible tests.
      const seek = new URLSearchParams(location.search).get('seek');
      if (startAt !== null) v.currentTime = startAt;
      else if (Number.isFinite(v.duration) && v.duration > 10) {
        if (seek !== null) v.currentTime = Number(seek);
        else v.currentTime = (0.05 + Math.random() * 0.85) * v.duration;
      }
    });
    v.addEventListener('canplay', () => {
      this.ready = true;
      v.play().catch(() => {});
    });
    v.addEventListener('timeupdate', () => {
      if (this.loopStart !== null && v.currentTime > this.loopStart + this.loopLength) {
        v.currentTime = this.loopStart;
      }
    });
    // A seek can interrupt play(), and some browsers refuse autoplay in a tab
    // opened without a gesture. Keep nudging until it actually runs.
    this.nudge = window.setInterval(() => {
      if (!v.paused) {
        window.clearInterval(this.nudge);
        return;
      }
      if (v.readyState >= 2) v.play().catch(() => {});
    }, 1500);
    const kick = () => {
      if (v.paused) v.play().catch(() => {});
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
  }

  setSpeed(rate: number) {
    this.element.playbackRate = Math.min(4, Math.max(0.0625, rate));
  }

  /** Toggle looping a region starting at the current moment. */
  toggleLoop(lengthSeconds: number): boolean {
    if (this.loopStart === null) {
      this.loopStart = this.element.currentTime;
      this.loopLength = lengthSeconds;
      return true;
    }
    this.loopStart = null;
    return false;
  }

  dispose() {
    window.clearInterval(this.nudge);
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    this.texture.dispose();
  }
}
