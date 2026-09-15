"""Measure the pipeline on this machine.

    uv run bench.py                        # sdxs at its default size
    uv run bench.py --model sdxs --sizes 384x256,512x320,768x448 --n 40
    uv run bench.py --all                  # every model at its default size

Prints per-stage ms and frames per second with a synthetic input (a
gradient with a disc), which is enough for timing. First run per size
also converts the Core ML packages.
"""

from __future__ import annotations

import argparse
import time

import numpy as np

from models import MODELS, parse_size
from pipeline import Pipeline


def synthetic(w: int, h: int) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.stack([xx / w, yy / h, 0.5 + 0.5 * np.sin(xx / 23)], -1)
    disc = ((xx - w / 2) ** 2 + (yy - h / 2) ** 2) < (min(w, h) / 4) ** 2
    img[disc] = [0.9, 0.85, 0.7]
    return (img * 255).astype(np.uint8)


def bench(model: str, size: str, n: int, steps: int = 1):
    spec = MODELS[model]
    w, h = parse_size(size)
    pipe = Pipeline(spec, w, h, print)
    pipe.params.steps = steps
    pipe.params.prompt = "a dense forest at dusk, cinematic"
    pipe.set_prompt(pipe.params.prompt)
    img = synthetic(w, h)
    for _ in range(3):
        pipe.process(img)
    tms = []
    t0 = time.perf_counter()
    for _ in range(n):
        _, tm = pipe.process(img)
        tms.append(tm)
    wall = time.perf_counter() - t0
    enc = np.mean([t.encode for t in tms]) * 1000
    un = np.mean([t.unet for t in tms]) * 1000
    dec = np.mean([t.decode for t in tms]) * 1000
    tot = np.mean([t.total for t in tms]) * 1000
    print(f"| {model} | {size} | {steps} | {enc:.1f} | {un:.1f} | {dec:.1f} | {tot:.1f} | {n / wall:.1f} |", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="sdxs", choices=list(MODELS))
    ap.add_argument("--sizes", default=None, help="comma-separated WxH list")
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--steps", type=int, default=1)
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    print("| modelo | tamaño | pasos | enc ms | unet ms | dec ms | total ms | fps |")
    print("|---|---|---|---|---|---|---|---|")
    if a.all:
        for k, s in MODELS.items():
            bench(k, a.sizes or s.default_size, a.n, a.steps)
    else:
        for s in (a.sizes or MODELS[a.model].default_size).split(","):
            bench(a.model, s.strip(), a.n, a.steps)
