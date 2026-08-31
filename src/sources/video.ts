// Source clip -> texture. Muted + loop so autoplay is allowed everywhere.

import * as THREE from 'three';

export class VideoSource {
  readonly element: HTMLVideoElement;
  readonly texture: THREE.VideoTexture;
  ready = false;

  constructor(url: string) {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
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
      if (Number.isFinite(v.duration) && v.duration > 10) {
        v.currentTime = seek !== null
          ? Number(seek)
          : (0.05 + Math.random() * 0.85) * v.duration;
      }
    });
    v.addEventListener('canplay', () => {
      this.ready = true;
      v.play().catch(() => {
        // Autoplay refused: retry on the first gesture.
        const kick = () => {
          v.play().catch(() => {});
          window.removeEventListener('pointerdown', kick);
          window.removeEventListener('keydown', kick);
        };
        window.addEventListener('pointerdown', kick);
        window.addEventListener('keydown', kick);
      });
    });
  }

  dispose() {
    this.element.pause();
    this.element.removeAttribute('src');
    this.texture.dispose();
  }
}
