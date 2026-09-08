// Receives phone cameras over WebRTC. The phone page (tools/phone-cam) makes
// the offer; this side answers and hands the incoming MediaStream to whoever
// listens. Signaling goes through the phone-cam server; video comes straight
// from the phone over the LAN (no STUN/TURN, host candidates only).
// Reconnects to the server forever, like the granulizer client.

export interface RemotePhone {
  id: string;
  name: string;
  stream: MediaStream | null;
}

export class RemoteCameras {
  readonly phones = new Map<string, RemotePhone>();
  /** URLs the phones should open, as reported by the server. */
  urls: string[] = [];
  connected = false;
  onChange: (() => void) | null = null;
  /** A phone moved its macro pad. */
  onMacro: ((name: string, value: number) => void) | null = null;
  private ws: WebSocket | null = null;
  private pcs = new Map<string, RTCPeerConnection>();
  private myId = '';
  private sentMacros = '';
  private macrosDue = 0;

  constructor(private host: string) {}

  start() {
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(`ws://${this.host}/signal`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      ws.send(JSON.stringify({ type: 'hello', role: 'screen' }));
      this.onChange?.();
    };
    ws.onclose = () => {
      this.connected = false;
      for (const id of [...this.phones.keys()]) this.drop(id);
      this.onChange?.();
      window.setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => this.handle(JSON.parse(ev.data));
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private async handle(msg: any) {
    switch (msg.type) {
      case 'welcome':
        this.myId = msg.id;
        this.urls = msg.urls ?? [];
        this.onChange?.();
        break;
      case 'urls':
        this.urls = msg.urls ?? [];
        this.onChange?.();
        break;
      case 'phones': {
        const present = new Set<string>((msg.phones as RemotePhone[]).map((p) => p.id));
        for (const id of [...this.phones.keys()]) if (!present.has(id)) this.drop(id);
        for (const p of msg.phones as RemotePhone[]) {
          const cur = this.phones.get(p.id);
          if (cur) cur.name = p.name;
          else {
            this.phones.set(p.id, { id: p.id, name: p.name, stream: null });
            this.sentMacros = '';   // newcomer: next syncMacros pushes the pad values
          }
        }
        this.onChange?.();
        break;
      }
      case 'offer':
        await this.answer(msg.from, msg.name, msg.sdp);
        break;
      case 'ice':
        if (msg.candidate) this.pcs.get(msg.from)?.addIceCandidate(msg.candidate).catch(() => {});
        break;
      case 'macro':
        if (typeof msg.name === 'string' && typeof msg.value === 'number') this.onMacro?.(msg.name, msg.value);
        break;
    }
  }

  private async answer(id: string, name: string, sdp: RTCSessionDescriptionInit) {
    this.pcs.get(id)?.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pcs.set(id, pc);
    const phone = this.phones.get(id) ?? { id, name, stream: null };
    this.phones.set(id, phone);
    pc.ontrack = (ev) => {
      phone.stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.onChange?.();
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.send({ type: 'ice', to: id, candidate: ev.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.pcs.get(id) === pc) {
          this.pcs.delete(id);
          phone.stream = null;
          this.onChange?.();
        }
      }
    };
    await pc.setRemoteDescription(sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    this.send({ type: 'answer', to: id, sdp: pc.localDescription });
  }

  /** Push the pad macros to every phone when they changed or a phone joined.
   *  Call once per frame; sends at most ~20 times a second. */
  syncMacros(values: Record<string, number>, now = performance.now()) {
    if (!this.connected || this.phones.size === 0 || now < this.macrosDue) return;
    const key = Object.values(values).map((v) => v.toFixed(3)).join(',');
    if (key === this.sentMacros) return;
    this.sentMacros = key;
    this.macrosDue = now + 50;
    this.send({ type: 'macros', values });
  }

  private drop(id: string) {
    this.pcs.get(id)?.close();
    this.pcs.delete(id);
    this.phones.delete(id);
  }

  get id(): string {
    return this.myId;
  }
}
