// Runtime configuration, all overridable from the URL:
//
//   ?video=/media/other.mp4        source clip
//   ?ws=192.168.1.40:8765          granulizer bridge (music machine on the LAN)
//   ?structure=gz|sim|clock        what drives the wave cycle
//   ?audio=1|0                     external audio analysis on/off
//   ?camera=1                      performer-tracking prototype on
//   ?res=0.5                       feedback buffer scale (lower = faster on the M1)

const q = new URLSearchParams(window.location.search);

export type StructureMode = 'gz' | 'sim' | 'clock';

export const config = {
  videoUrl: q.get('video') ?? '/media/almodovar-red.mp4',
  bridgeHost: q.get('ws') ?? 'localhost:8765',
  structure: (q.get('structure') ?? 'sim') as StructureMode,
  audioEnabled: q.get('audio') !== '0',
  cameraEnabled: q.get('camera') === '1',
  /** Feedback buffer resolution relative to the canvas. */
  resScale: Number(q.get('res') ?? '0.5'),
  paletteSize: 5,
  /** Seconds between palette re-extractions. */
  paletteInterval: 4,
  /** Scene length in clock mode, seconds. */
  clockSceneSeconds: 45,
  /** ?scene=N forces a scene (1-based) and starts with HOLD on. */
  scene: q.get('scene') !== null ? Number(q.get('scene')) - 1 : null,
};
