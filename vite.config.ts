import { defineConfig, type Plugin } from 'vite';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// The assets folder: assets/input holds the sources the app can load (served
// under /media, listed at /media/manifest.json), assets/output receives the
// screen recordings. Both are gitignored. src/sources/assets.ts is the client.
const ASSETS = path.resolve(__dirname, 'assets');
const INPUT = path.join(ASSETS, 'input');
const OUTPUT = path.join(ASSETS, 'output');
const MEDIA_RE = /\.(mp4|mov|webm|m4v|jpg|jpeg|png|webp)$/i;
const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

function safeName(raw: string): string | null {
  const name = path.basename(decodeURIComponent(raw));
  return name && !name.startsWith('.') ? name : null;
}

/** Static file with Range support, so videos can seek. */
function serveFile(file: string, req: IncomingMessage, res: ServerResponse) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(file).pipe(res);
  }
}

function assetsPlugin(): Plugin {
  return {
    name: 'vv3-assets',
    configureServer(server) {
      fs.mkdirSync(INPUT, { recursive: true });
      fs.mkdirSync(OUTPUT, { recursive: true });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/media/manifest.json') {
          const names = fs.readdirSync(INPUT).filter((n) => MEDIA_RE.test(n)).sort();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          return res.end(JSON.stringify(names));
        }
        if (url.pathname.startsWith('/media/')) {
          const name = safeName(url.pathname.slice('/media/'.length));
          const file = name && path.join(INPUT, name);
          if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
          return serveFile(file, req, res);
        }
        if (req.method === 'POST' && url.pathname === '/__assets/recording') {
          const name = safeName(url.searchParams.get('name') ?? '');
          if (!name) { res.statusCode = 400; return res.end('name?'); }
          const out = fs.createWriteStream(path.join(OUTPUT, name));
          req.pipe(out);
          out.on('finish', () => res.end(name));
          out.on('error', () => { res.statusCode = 500; res.end(); });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/__assets/open') {
          const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
          execFile(opener, [ASSETS], () => res.end('ok'));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({ plugins: [assetsPlugin()] });
