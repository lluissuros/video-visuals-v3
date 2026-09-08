// Live cameras as one catalogue: the laptop's own cameras (built-in, USB,
// anything the OS lists) and phones connected through the phone-cam link.
// Two consumers share it - the film source (MediaManager) and the silhouette
// tracker - so each stream is opened once and refcounted. Remote phones get a
// stable <video> element per phone: when the phone reconnects only its
// srcObject changes, so textures bound to the element stay valid.

import { RemoteCameras } from './remote';

export interface LiveSource {
  /** `local:<deviceId>` or `remote:<phoneId>`. */
  id: string;
  name: string;
  kind: 'local' | 'remote';
}

interface Opened {
  element: HTMLVideoElement;
  stream: MediaStream | null;
  refs: number;
}

export const DEFAULT_LOCAL = 'local:default';

function makeVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  return v;
}

export class LiveSources {
  readonly remote: RemoteCameras;
  error: string | null = null;
  private locals: { id: string; name: string }[] = [{ id: DEFAULT_LOCAL, name: 'cámara del portátil' }];
  private opened = new Map<string, Opened>();
  private listeners = new Set<() => void>();

  constructor(phoneHost: string) {
    this.remote = new RemoteCameras(phoneHost);
    this.remote.onChange = () => this.syncRemote();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.enumerate());
  }

  start() {
    this.remote.start();
    this.enumerate();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  list(): LiveSource[] {
    return [
      ...this.locals.map((l) => ({ ...l, kind: 'local' as const })),
      ...[...this.remote.phones.values()].map((p) => ({
        id: `remote:${p.id}`,
        name: p.name + (p.stream ? '' : ' (sin vídeo)'),
        kind: 'remote' as const,
      })),
    ];
  }

  /** The element carrying this source right now, if open. */
  element(id: string): HTMLVideoElement | null {
    return this.opened.get(id)?.element ?? null;
  }

  /** Open (or share) a source. Local cameras ask for permission the first time. */
  async acquire(id: string): Promise<HTMLVideoElement | null> {
    const cur = this.opened.get(id);
    if (cur) {
      cur.refs++;
      return cur.element;
    }
    const entry: Opened = { element: makeVideo(), stream: null, refs: 1 };
    this.opened.set(id, entry);
    if (id.startsWith('remote:')) {
      this.attach(entry, this.remote.phones.get(id.slice(7))?.stream ?? null);
      return entry.element;
    }
    try {
      const deviceId = id.slice(6);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId === 'default' ? { facingMode: 'user' } : { deviceId: { exact: deviceId } }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      this.attach(entry, stream);
      this.error = null;
      this.enumerate(); // labels become visible once permission exists
      return entry.element;
    } catch (e) {
      this.opened.delete(id);
      this.error = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  release(id: string) {
    const cur = this.opened.get(id);
    if (!cur || --cur.refs > 0) return;
    if (id.startsWith('local:')) cur.stream?.getTracks().forEach((t) => t.stop());
    cur.element.srcObject = null;
    this.opened.delete(id);
  }

  private attach(entry: Opened, stream: MediaStream | null) {
    if (entry.stream === stream) return;
    entry.stream = stream;
    entry.element.srcObject = stream;
    if (stream) entry.element.play().catch(() => {});
  }

  private syncRemote() {
    for (const [id, entry] of this.opened) {
      if (!id.startsWith('remote:')) continue;
      this.attach(entry, this.remote.phones.get(id.slice(7))?.stream ?? null);
    }
    this.emit();
  }

  private async enumerate() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput' && d.label && d.deviceId);
      this.locals = [
        { id: DEFAULT_LOCAL, name: 'cámara del portátil' },
        ...cams.map((d, i) => ({ id: `local:${d.deviceId}`, name: d.label || `cámara ${i + 1}` })),
      ];
    } catch { /* no mediaDevices: default entry only */ }
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
