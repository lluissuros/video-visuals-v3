// Read-only client of granulizer-v3's existing GUI bridge
// (granulizer-v3/gui/bridge/index.mjs, WebSocket port 8765). The bridge
// broadcasts engine state to every connected page, so subscribing here needs
// no change on the granulizer side. Run the bridge on the music machine and
// point ?ws=<that-machine>:8765 at it from this one.
//
// Messages seen: {type:'state', state}, {type:'link', connected}, {type:'meta'}.
// state.turn is {name, index, prob, probs: number[], ...} or null;
// state.rotating says whether the cycle is actually turning.

import type { WaveState } from '../types';

const RETRY_MS = 3000;

export class GranulizerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private closed = false;
  state: WaveState = { waves: [], turnIndex: -1, turnProb: 0, live: false };
  connected = false;
  onUpdate: ((w: WaveState) => void) | null = null;

  constructor(host: string) {
    this.url = `ws://${host}`;
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      setTimeout(() => this.connect(), RETRY_MS);
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
    };
    this.ws.onmessage = (ev) => this.handle(ev.data);
    this.ws.onclose = () => {
      this.connected = false;
      this.push({ waves: [], turnIndex: -1, turnProb: 0, live: false });
      setTimeout(() => this.connect(), RETRY_MS);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private handle(raw: unknown) {
    if (typeof raw !== 'string') return;
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'link' && msg.connected === false) {
      this.push({ waves: [], turnIndex: -1, turnProb: 0, live: false });
      return;
    }
    if (msg.type !== 'state' || !msg.state) return;
    const st = msg.state;
    const turn = st.turn;
    const rotating = st.rotating === true;
    if (!rotating || !turn || !Array.isArray(turn.probs)) {
      this.push({ waves: [], turnIndex: -1, turnProb: 0, live: false });
      return;
    }
    this.push({
      waves: turn.probs.map((p: unknown) => clamp01(Number(p))),
      turnIndex: typeof turn.index === 'number' ? turn.index : -1,
      turnProb: clamp01(Number(turn.prob)),
      live: true,
    });
  }

  private push(w: WaveState) {
    this.state = w;
    this.onUpdate?.(w);
  }

  dispose() {
    this.closed = true;
    this.ws?.close();
  }
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
