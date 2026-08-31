// Speaks the granulizer GUI bridge's WebSocket protocol without SuperCollider:
// broadcasts {type:'state'} at 20 Hz with a rotating turn over three fake
// songs, wave shapes as in granulizer-v3/lib/40-rotation.scd. For developing
// the visuals' gz mode when the engine (or the music machine) is not around.
//
//   node tools/mock-bridge.mjs [port]     default 8765, like the real bridge

import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] ?? 8765);
const wss = new WebSocketServer({ port });
const SONGS = ['uno', 'dos', 'tres'];
const CYCLE_S = 30;

let t0 = Date.now();
setInterval(() => {
  const phase = ((Date.now() - t0) / 1000 / CYCLE_S) % 1;
  const probs = SONGS.map((_, i) => {
    const ph = (phase + i / SONGS.length) % 1;
    return Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 2.5);
  });
  const index = probs.indexOf(Math.max(...probs));
  const state = {
    rotating: true,
    songsSounding: SONGS,
    turn: { name: SONGS[index], index, prob: probs[index], probs },
  };
  const msg = JSON.stringify({ type: 'state', state });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}, 50);

wss.on('connection', (c) => {
  console.log(`client connected (${wss.clients.size})`);
  c.send(JSON.stringify({ type: 'link', connected: true }));
});
console.log(`mock gz bridge on ws://localhost:${port}`);
