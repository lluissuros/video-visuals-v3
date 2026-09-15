"""WebSocket bridge between the webapp and the Core ML pipeline.

    uv run server.py [--port 8776] [--model sdxs] [--size 512x288]

Protocol (one client is the normal case; several are allowed):
  browser -> server, binary:  u32 LE frame id + JPEG of the source, already
                              cropped to the working size
  browser -> server, text:    {"type":"params", ...any Params field}
                              {"type":"model", "model": key, "size": "WxH"}
                              {"type":"reset"}
  server -> browser, binary:  u32 LE frame id (the one it came from) + JPEG
  server -> browser, text:    {"type":"status", ...} twice a second

Only the newest frame waits for the model (a one-slot mailbox); anything
older is dropped, so the latency never grows.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import threading
import time
import traceback

import cv2
import numpy as np
from websockets.asyncio.server import serve

from models import DEFAULT_MODEL, MODELS, parse_size, sizes_for
from pipeline import Params, Pipeline, Timings

JPEG_Q = 88


class FakePipeline:
    """No model: hue-rotates the frame after a fixed delay. Exercises the whole
    transport and the webapp side while weights download or on any machine."""

    def __init__(self, spec, w, h, say):
        self.w, self.h = w, h
        self.params = Params()
        say(f"fake {spec.key} {w}x{h} listo")

    def set_prompt(self, text):
        pass

    def reset(self):
        pass

    def process(self, rgb):
        t0 = time.perf_counter()
        time.sleep(0.06)
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        hsv[..., 0] = (hsv[..., 0].astype(int) + int(90 * self.params.strength)) % 180
        out = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
        cv2.putText(out, f"FAKE {self.params.prompt[:24]}", (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        tm = Timings(unet=0.06, total=time.perf_counter() - t0)
        return out, tm


class Service:
    def __init__(self, model: str, size: str | None, fake: bool = False):
        self.fake = fake
        self.model_key = model
        self.size = size or MODELS[model].default_size
        self.params = Params()
        self.pipeline: Pipeline | None = None
        self.loading = ""
        self.error = ""
        self.want_reset = False
        self.want_reload = True

        self._cv = threading.Condition()
        self._mailbox: tuple[int, bytes] | None = None
        self._dropped = 0
        self.clients: set = set()
        self.loop: asyncio.AbstractEventLoop | None = None

        self._times: list[float] = []      # wall time per processed frame
        self._last_tm = None
        self.fps = 0.0
        threading.Thread(target=self._worker, name="inference", daemon=True).start()

    # ------------------------------------------------------------ inbound
    def put_frame(self, frame_id: int, jpeg: bytes):
        with self._cv:
            if self._mailbox is not None:
                self._dropped += 1
            self._mailbox = (frame_id, jpeg)
            self._cv.notify()

    def handle_text(self, msg: str):
        try:
            m = json.loads(msg)
        except json.JSONDecodeError:
            return
        t = m.get("type")
        if t == "params":
            for k, v in m.items():
                if k == "type" or not hasattr(self.params, k):
                    continue
                cur = getattr(self.params, k)
                setattr(self.params, k, type(cur)(v))
            if self.pipeline:
                self.pipeline.params = self.params
                if "prompt" in m:
                    threading.Thread(target=self.pipeline.set_prompt, args=(self.params.prompt,), daemon=True).start()
        elif t == "model":
            model = m.get("model", self.model_key)
            if model not in MODELS:
                return
            size = m.get("size") or (self.size if model == self.model_key else MODELS[model].default_size)
            if size not in sizes_for(MODELS[model]):
                size = MODELS[model].default_size
            if model != self.model_key or size != self.size:
                self.model_key, self.size = model, size
                self.want_reload = True
                with self._cv:
                    self._cv.notify()
        elif t == "reset":
            self.want_reset = True

    # ------------------------------------------------------------- worker
    def _say(self, msg: str):
        self.loading = msg
        print(msg, flush=True)
        self._push_status()

    def _worker(self):
        while True:
            try:
                if self.want_reload:
                    self.want_reload = False
                    self.pipeline = None
                    self.error = ""
                    self._times.clear()
                    spec = MODELS[self.model_key]
                    w, h = parse_size(self.size)
                    cls = FakePipeline if self.fake else Pipeline
                    self.pipeline = cls(spec, w, h, self._say)
                    self.pipeline.params = self.params
                    self.pipeline.set_prompt(self.params.prompt)
                    self.loading = ""
                    self._push_status()
                with self._cv:
                    while self._mailbox is None and not self.want_reload:
                        self._cv.wait(timeout=0.5)
                    if self.want_reload:
                        continue
                    frame_id, jpeg = self._mailbox
                    self._mailbox = None
                if self.pipeline is None:
                    continue
                if self.want_reset:
                    self.want_reset = False
                    self.pipeline.reset()
                t0 = time.perf_counter()
                bgr = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
                if bgr is None:
                    continue
                if bgr.shape[1] != self.pipeline.w or bgr.shape[0] != self.pipeline.h:
                    bgr = cv2.resize(bgr, (self.pipeline.w, self.pipeline.h), interpolation=cv2.INTER_AREA)
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                out, tm = self.pipeline.process(rgb)
                ok, enc = cv2.imencode(".jpg", cv2.cvtColor(out, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])
                if not ok:
                    continue
                tm.decode_in = 0.0
                tm.total = time.perf_counter() - t0
                self._last_tm = tm
                self._times.append(time.perf_counter())
                self._times = [t for t in self._times if t > time.perf_counter() - 2.0]
                self.fps = len(self._times) / 2.0
                self._broadcast(frame_id.to_bytes(4, "little") + enc.tobytes())
            except Exception as e:  # keep serving; the client shows the error
                self.error = f"{type(e).__name__}: {e}"
                self.loading = ""
                traceback.print_exc()
                self._push_status()
                if self.pipeline is None:
                    time.sleep(1.0)

    # ----------------------------------------------------------- outbound
    def status(self) -> dict:
        tm = self._last_tm
        spec = MODELS[self.model_key]
        return {
            "type": "status",
            "ready": self.pipeline is not None and not self.loading,
            "loading": self.loading,
            "error": self.error,
            "model": self.model_key,
            "size": self.size,
            "sizes": sizes_for(spec),
            "models": [{"key": k, "label": s.label} for k, s in MODELS.items()],
            "fps": round(self.fps, 1),
            "ms": {
                "encode": round(tm.encode * 1000, 1), "unet": round(tm.unet * 1000, 1),
                "decode": round(tm.decode * 1000, 1), "total": round(tm.total * 1000, 1),
            } if tm else None,
            "dropped": self._dropped,
            "params": self.params.__dict__,
        }

    def _broadcast(self, data):
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self._send_all, data)

    def _push_status(self):
        self._broadcast(json.dumps(self.status()))

    def _send_all(self, data):
        for ws in list(self.clients):
            asyncio.ensure_future(self._send_one(ws, data))

    async def _send_one(self, ws, data):
        try:
            await ws.send(data)
        except Exception:
            self.clients.discard(ws)

    # ------------------------------------------------------------- server
    async def handler(self, ws):
        self.clients.add(ws)
        try:
            await ws.send(json.dumps(self.status()))
            async for msg in ws:
                if isinstance(msg, bytes):
                    if len(msg) > 4:
                        self.put_frame(int.from_bytes(msg[:4], "little"), msg[4:])
                else:
                    self.handle_text(msg)
        finally:
            self.clients.discard(ws)

    async def status_loop(self):
        while True:
            await asyncio.sleep(0.5)
            if self.clients:
                self._send_all(json.dumps(self.status()))

    async def run(self, host: str, port: int):
        self.loop = asyncio.get_running_loop()
        async with serve(self.handler, host, port, max_size=8 * 1024 * 1024, compression=None):
            print(f"vv3-ai listening on ws://{host}:{port}  model={self.model_key} size={self.size}", flush=True)
            await self.status_loop()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8776)
    ap.add_argument("--model", default=DEFAULT_MODEL, choices=list(MODELS))
    ap.add_argument("--size", default=None)
    ap.add_argument("--fake", action="store_true", help="no model: hue-rotate frames (transport test)")
    a = ap.parse_args()
    asyncio.run(Service(a.model, a.size, a.fake).run(a.host, a.port))
