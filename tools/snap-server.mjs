// Receives canvas snapshots from the app (?snap=...&post=1) and writes PNGs.
//   node tools/snap-server.mjs [outDir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? '.';
fs.mkdirSync(outDir, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') { res.statusCode = 404; return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { t, png, note } = JSON.parse(body);
      const b64 = png.replace(/^data:image\/png;base64,/, '');
      const file = path.join(outDir, `snap-${String(t).replace('.', '_')}s.png`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log(`wrote ${file}${note ? ' ' + note : ''}`);
    } catch (e) {
      console.error('bad payload:', e.message);
    }
    res.end('ok');
  });
}).listen(5299, () => console.log('snap-server on :5299'));
