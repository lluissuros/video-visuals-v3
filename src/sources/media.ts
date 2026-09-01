// Media catalogue and switching. Sources come from public/media/manifest.json
// (regenerate with tools/scan-media.sh) and from files dragged onto the window.
// Videos and still images both work; a different source changes the whole
// piece, so this is meant to be played with.

import * as THREE from 'three';
import { VideoSource } from './video';

export interface MediaItem {
  name: string;
  url: string;
  kind: 'video' | 'image';
}

export type MediaElement = HTMLVideoElement | HTMLImageElement;

const VIDEO_RE = /\.(mp4|mov|webm|m4v)$/i;

export class MediaManager {
  items: MediaItem[] = [];
  current: MediaItem | null = null;
  private video: VideoSource | null = null;
  private imageTex: THREE.Texture | null = null;
  private imageEl: HTMLImageElement | null = null;
  private speed = 1;

  /** Wired by main: receives the texture and the element (for the palette). */
  onSource: ((tex: THREE.Texture, el: MediaElement) => void) | null = null;
  onListChange: (() => void) | null = null;

  async init(defaultUrl: string) {
    try {
      const res = await fetch('/media/manifest.json');
      if (res.ok) {
        const names: string[] = await res.json();
        this.items = names.map((n) => ({
          name: n,
          url: `/media/${encodeURIComponent(n)}`,
          kind: VIDEO_RE.test(n) ? 'video' : 'image',
        }));
      }
    } catch { /* no manifest: default source only */ }
    if (this.items.length === 0) {
      this.items = [{
        name: defaultUrl.split('/').pop() ?? defaultUrl,
        url: defaultUrl,
        kind: 'video',
      }];
    }
    const wanted = this.items.find((i) => i.url === defaultUrl) ?? this.items[0];
    this.select(wanted);
    // The manifest fetch resolves after the panel is built: tell it the
    // catalogue exists, or the source selector starts empty.
    this.onListChange?.();
    this.watchDrops();
  }

  select(item: MediaItem, startAt: number | null = null) {
    this.disposeCurrent();
    this.current = item;
    this.onListChange?.();
    if (item.kind === 'video') {
      this.video = new VideoSource(item.url, startAt);
      this.video.setSpeed(this.speed);
      this.onSource?.(this.video.texture, this.video.element);
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = item.url;
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.imageTex = tex;
        this.imageEl = img;
        this.onSource?.(tex, img);
      };
    }
  }

  /** Drag a video or image from Finder onto the window. */
  private watchDrops() {
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const kind = file.type.startsWith('video') || VIDEO_RE.test(file.name)
        ? 'video' as const
        : file.type.startsWith('image')
          ? 'image' as const
          : null;
      if (!kind) return;
      const item: MediaItem = {
        name: file.name,
        url: URL.createObjectURL(file),
        kind,
      };
      this.items.push(item);
      this.onListChange?.();
      this.select(item);
    });
  }

  /** The element the palette extractor samples, if any is ready. */
  get element(): MediaElement | null {
    return this.video?.element ?? this.imageEl;
  }

  get videoSource(): VideoSource | null {
    return this.video;
  }

  setSpeed(rate: number) {
    this.speed = rate;
    this.video?.setSpeed(rate);
  }

  get speedRate(): number {
    return this.speed;
  }

  toggleLoop(lengthSeconds: number): boolean {
    return this.video?.toggleLoop(lengthSeconds) ?? false;
  }

  /** Change the loop length, live if a loop is running. */
  setLoopLength(lengthSeconds: number) {
    if (this.video) this.video.loopLength = lengthSeconds;
  }

  /** Restore a saved loop: seek there and start looping. */
  applyLoop(start: number | null, length: number) {
    if (!this.video) return;
    this.video.loopLength = length;
    this.video.loopStart = start;
    if (start !== null) this.video.element.currentTime = start;
  }

  get loopState(): { start: number | null; length: number } {
    return {
      start: this.video?.loopStart ?? null,
      length: this.video?.loopLength ?? 2,
    };
  }

  private disposeCurrent() {
    this.video?.dispose();
    this.video = null;
    this.imageTex?.dispose();
    this.imageTex = null;
    this.imageEl = null;
  }
}
