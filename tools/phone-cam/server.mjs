// Phone camera link: serves the phone page over HTTPS (phones only allow
// camera access on secure origins) and relays WebRTC signaling between phones
// and the visuals page. Video never passes through here - it flows phone ->
// laptop directly over the LAN via WebRTC.
//
//   node tools/phone-cam/server.mjs [port]     default 5276
//
// One port speaks both HTTP and HTTPS (first byte 0x16 = TLS handshake):
// the visuals page on http://localhost uses plain ws://, the phones use
// https:// + wss://. The certificate is signed by a local CA created on the
// first run; a phone that installs that CA (GET /ca.crt) stops warning. The
// leaf is re-issued whenever the laptop's LAN addresses change, the CA stays.
//
// Signaling protocol (JSON over /signal):
//   phone  -> hello {role:'phone', id, name}      screen -> hello {role:'screen'}
//   server -> welcome {id, urls}
//   server -> screens [id...]  (to phones)        server -> phones [{id,name}...]  (to screens)
//   phone  -> offer {to, sdp}     relayed as offer {from, name, sdp}
//   screen -> answer {to, sdp}    relayed as answer {from, sdp}
//   either -> ice {to, candidate} relayed as ice {from, candidate}
//   phone  -> macro {name, value}  relayed to every screen as macro {from, name, value}
//   screen -> macros {values}      relayed to every phone (pad follows the screen)

import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { createServer as createTcp } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 5276);

// --- certificates: local CA (once) + leaf for the current LAN addresses -----
const certDir = join(here, '.cert');
const caKey = join(certDir, 'ca.key');
const caCert = join(certDir, 'ca.crt');
const keyPath = join(certDir, 'key.pem');
const certPath = join(certDir, 'cert.pem');
const sansPath = join(certDir, 'sans.txt');
const openssl = (args) => {
  try {
    execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error('openssl failed:', String(e.stderr));
    throw e;
  }
};

function lanIps() {
  const ips = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }
  return ips;
}
const lanUrls = () => lanIps().map((ip) => `https://${ip}:${port}/`);

mkdirSync(certDir, { recursive: true });
if (!existsSync(caCert)) {
  const cnf = join(certDir, 'ca.cnf');
  writeFileSync(cnf, [
    '[req]', 'distinguished_name=dn', 'x509_extensions=v3', 'prompt=no',
    '[dn]', 'CN=video-visuals phone-cam CA',
    '[v3]', 'basicConstraints=critical,CA:TRUE', 'keyUsage=critical,keyCertSign,cRLSign',
    'subjectKeyIdentifier=hash',
  ].join('\n'));
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
    '-keyout', caKey, '-out', caCert, '-config', cnf]);
  console.log('local CA created in', certDir, '- install /ca.crt on the phones once');
}
// Leaf: SAN must list the IPs the phones type, so re-issue when they change
// (also while running: the laptop may join the venue Wi-Fi after startup).
// Validity <= 825 days and extendedKeyUsage=serverAuth are what iOS demands.
let currentSans = '';
function ensureLeaf() {
  const ips = lanIps();
  const sans = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  if (sans === currentSans) return false;
  // Mid-switch there is no LAN address: keep the old leaf, still report the change.
  if (!ips.length && currentSans) { currentSans = sans; return true; }
  if (!existsSync(certPath) || !existsSync(sansPath) || readFileSync(sansPath, 'utf8') !== sans) {
    const cnf = join(certDir, 'leaf.cnf');
    const csr = join(certDir, 'leaf.csr');
    writeFileSync(cnf, [
      '[req]', 'distinguished_name=dn', 'prompt=no',
      '[dn]', 'CN=video-visuals phone-cam',
      '[ext]', 'basicConstraints=CA:FALSE', 'keyUsage=digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth', `subjectAltName=${sans}`,
    ].join('\n'));
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', csr, '-config', cnf]);
    // Explicit serial path: without it LibreSSL derives one by cutting the CA
    // path at its first dot ("/Users/lluis.suros/..." -> "/Users/lluis.srl").
    openssl(['x509', '-req', '-in', csr, '-CA', caCert, '-CAkey', caKey,
      '-CAserial', join(certDir, 'ca.srl'), '-CAcreateserial',
      '-days', '825', '-out', certPath, '-extfile', cnf, '-extensions', 'ext']);
    writeFileSync(sansPath, sans);
    console.log('server certificate issued for', sans);
  }
  currentSans = sans;
  return true;
}
ensureLeaf();

// --- static page + info -------------------------------------------------------

function handle(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(here, 'index.html')));
  } else if (path === '/ca.crt') {
    // Inline, not attachment: iOS then offers it as a profile to install.
    res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert' });
    res.end(readFileSync(caCert));
  } else if (path === '/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ urls: lanUrls(), phones: [...clients.values()].filter((c) => c.role === 'phone').length }));
  } else {
    res.writeHead(404);
    res.end();
  }
}

// --- signaling relay ----------------------------------------------------------
/** @type {Map<import('ws').WebSocket, {id: string, role: 'phone'|'screen', name: string}>} */
const clients = new Map();
const wss = new WebSocketServer({ noServer: true });

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const byRole = (role) => [...clients].filter(([, c]) => c.role === role);
const find = (id) => [...clients].find(([, c]) => c.id === id)?.[0];

function broadcastPresence() {
  const phones = byRole('phone').map(([, c]) => ({ id: c.id, name: c.name }));
  const screens = byRole('screen').map(([, c]) => c.id);
  for (const [ws] of byRole('screen')) send(ws, { type: 'phones', phones });
  for (const [ws] of byRole('phone')) send(ws, { type: 'screens', screens });
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = clients.get(ws);
    if (msg.type === 'hello') {
      const role = msg.role === 'phone' ? 'phone' : 'screen';
      const id = (role === 'phone' && typeof msg.id === 'string' && msg.id) || Math.random().toString(36).slice(2, 10);
      // Same phone reconnecting (page reload): drop the stale socket.
      const old = find(id);
      if (old && old !== ws) { clients.delete(old); old.close(); }
      clients.set(ws, { id, role, name: String(msg.name ?? role).slice(0, 24) });
      send(ws, { type: 'welcome', id, urls: lanUrls() });
      broadcastPresence();
      console.log(`${role} ${id} (${clients.get(ws).name}) joined`);
      return;
    }
    if (!me) return;
    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice') {
      const target = find(msg.to);
      if (target) send(target, { ...msg, from: me.id, name: me.name, to: undefined });
    } else if (msg.type === 'macro' && me.role === 'phone') {
      for (const [ws] of byRole('screen')) send(ws, { type: 'macro', from: me.id, name: msg.name, value: msg.value });
    } else if (msg.type === 'macros' && me.role === 'screen') {
      for (const [ws] of byRole('phone')) send(ws, { type: 'macros', values: msg.values });
    }
  });
  ws.on('close', () => {
    const me = clients.get(ws);
    if (!me) return;
    clients.delete(ws);
    console.log(`${me.role} ${me.id} left`);
    broadcastPresence();
  });
});

function upgrade(req, socket, head) {
  if (new URL(req.url, 'http://x').pathname !== '/signal') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
}

// --- one port, HTTP and HTTPS ---------------------------------------------------
const http = createHttp(handle).on('upgrade', upgrade);
const https = createHttps({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, handle)
  .on('upgrade', upgrade);

createTcp((socket) => {
  socket.once('data', (buf) => {
    socket.pause();
    socket.unshift(buf);
    (buf[0] === 0x16 ? https : http).emit('connection', socket);
    process.nextTick(() => socket.resume());
  });
  socket.on('error', () => {});
}).listen(port, '0.0.0.0', () => {
  console.log(`phone-cam on :${port}`);
  console.log('open on the phone (install /ca.crt once, or accept the warning):');
  for (const u of lanUrls()) console.log('  ' + u);
});

// Network change while running: new leaf, and every page learns the new URLs.
setInterval(() => {
  if (!ensureLeaf()) return;
  https.setSecureContext({ key: readFileSync(keyPath), cert: readFileSync(certPath) });
  const urls = lanUrls();
  for (const [ws] of clients) send(ws, { type: 'urls', urls });
  console.log('network changed, now on:', urls.length ? '' : 'no LAN address');
  for (const u of urls) console.log('  ' + u);
}, 3000);
