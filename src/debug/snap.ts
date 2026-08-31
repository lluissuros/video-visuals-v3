// Headless verification hook. ?snap=6,18 captures the canvas at those times
// (right after a render, so no preserveDrawingBuffer needed) and parks each
// PNG as base64 in the DOM, where `chrome --headless --dump-dom` can read it.
// Inert without the query param.

const params = new URLSearchParams(location.search);
const times = (params.get('snap') ?? '')
  .split(',')
  .map(Number)
  .filter((t) => t > 0)
  .sort((a, b) => a - b);
const post = params.get('post') === '1';

let elapsed = 0;

/** Call right after engine.render() each frame. */
export function snapTick(
  canvas: HTMLCanvasElement,
  dt: number,
  info?: () => unknown,
) {
  if (times.length === 0) return;
  elapsed += dt;
  if (elapsed < times[0]) return;
  const t = times.shift()!;
  const payload = JSON.stringify({
    t,
    png: canvas.toDataURL('image/png'),
    note: info ? JSON.stringify(info()) : undefined,
  });
  if (post) {
    fetch('http://localhost:5299/', { method: 'POST', body: payload }).catch(() => {});
  } else {
    const pre = document.createElement('pre');
    pre.className = 'snap';
    pre.style.display = 'none';
    pre.textContent = payload;
    document.body.appendChild(pre);
  }
  if (times.length === 0 && post && params.get('autoclose') === '1') {
    setTimeout(() => window.close(), 500);
  }
}
