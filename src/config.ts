// Runtime configuration, all overridable from the URL:
//
//   ?video=/media/other.mp4        source clip
//   ?ws=192.168.1.40:8765          granulizer bridge (music machine on the LAN)
//   ?structure=gz|sim|clock        what drives the wave cycle
//   ?audio=1|0                     external audio analysis on/off
//   ?camera=1                      performer-tracking prototype on
//   ?phone=192.168.1.40:5276       phone-cam server (tools/phone-cam), if not local
//   ?res=0.5                       feedback buffer scale (lower = faster on the M1)
//   ?hold=0                        let the sequencer change presets (default: HOLD on)
//   ?ai=127.0.0.1:8776             img2img service (ai/server.py), if not local

const q = new URLSearchParams(window.location.search);

export type StructureMode = 'gz' | 'sim' | 'clock';

export const config = {
  videoUrl: q.get('video') ?? '/media/almodovar-red.mp4',
  bridgeHost: q.get('ws') ?? 'localhost:8765',
  structure: (q.get('structure') ?? 'sim') as StructureMode,
  audioEnabled: q.get('audio') !== '0',
  cameraEnabled: q.get('camera') === '1',
  /** Signaling server for phone cameras (node tools/phone-cam/server.mjs). */
  phoneHost: q.get('phone') ?? 'localhost:5276',
  /** Local img2img service (ai/server.py). ?ai=host:port to move it. */
  aiHost: q.get('ai') ?? '127.0.0.1:8776',
  /** Feedback buffer resolution relative to the canvas. 1 = full res;
   *  drop to 0.5 on a weaker machine (the M1) if fps suffers. */
  resScale: Number(q.get('res') ?? '1'),
  paletteSize: 5,
  /** Seconds between palette re-extractions. */
  paletteInterval: 4,
  /** Preset length in clock mode, seconds. */
  clockSceneSeconds: 45,
  /** HOLD on at start: presets only change by hand. ?hold=0 lets the sequencer run. */
  hold: q.get('hold') !== '0',
  /** ?preset=N starts on saved preset N (1-based); default: the first one. */
  preset: q.get('preset') !== null ? Number(q.get('preset')) - 1 : 0,
  /** ?shader=N forces a generative shader (1-9) on top of any preset. */
  shader: q.get('shader') !== null ? Number(q.get('shader')) : null,
  /** Recording bitrate, Mbps. Grain and feedback detail need a lot; 60 is
   *  near-transparent at 1080p. ?recbps=N to change. */
  recMbps: Number(q.get('recbps') ?? '60'),
};
