"""Hugging Face weights -> Core ML packages, cached under ai/models/.

One UNet package per (model, resolution): Core ML wants fixed shapes and the
paper behind streamdiffusion-mac (arXiv 2605.16259) found flexible shapes and
the Neural Engine both slower than a fixed-shape GPU program. The tiny VAE is
converted per resolution too (it is small; a few seconds each).

Run directly to pre-convert:  uv run convert.py --model sdxs --size 512x320
"""

from __future__ import annotations

import argparse
import gc
import time
from pathlib import Path
from typing import Callable

import coremltools as ct
import numpy as np
import torch

from models import MODELS, ModelSpec, parse_size, sizes_for

ROOT = Path(__file__).resolve().parent / "models"
COMPUTE = ct.ComputeUnit.CPU_AND_GPU
TARGET = ct.target.macOS15

Progress = Callable[[str], None]


def _say(progress: Progress | None, msg: str):
    (progress or print)(msg)


def model_dir(spec: ModelSpec) -> Path:
    d = ROOT / spec.key
    d.mkdir(parents=True, exist_ok=True)
    return d


def unet_path(spec: ModelSpec, w: int, h: int) -> Path:
    return model_dir(spec) / f"unet_{w}x{h}.mlpackage"


def vae_paths(spec: ModelSpec, w: int, h: int) -> tuple[Path, Path]:
    d = model_dir(spec)
    return d / f"vae_enc_{w}x{h}.mlpackage", d / f"vae_dec_{w}x{h}.mlpackage"


def _convert(traced, inputs, outputs, path: Path):
    ml = ct.convert(
        traced,
        inputs=inputs,
        outputs=outputs,
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        minimum_deployment_target=TARGET,
        compute_units=COMPUTE,
    )
    ml.save(str(path))
    del ml
    gc.collect()


class _UNetWrap(torch.nn.Module):
    def __init__(self, unet):
        super().__init__()
        self.unet = unet

    def forward(self, sample, timestep, encoder_hidden_states):
        return self.unet(sample, timestep, encoder_hidden_states, return_dict=False)[0]


def ensure_unet(spec: ModelSpec, w: int, h: int, progress: Progress | None = None) -> Path:
    path = unet_path(spec, w, h)
    if path.exists():
        return path
    from diffusers import UNet2DConditionModel

    t0 = time.time()
    _say(progress, f"convirtiendo UNet {spec.key} {w}x{h} a Core ML (medio minuto la primera vez)…")
    kw = {"variant": spec.variant} if spec.variant else {}
    if spec.lora:
        # Through the pipeline: it converts kohya-format LoRAs (Hyper-SD) and
        # the old diffusers format (LCM). UNet2DConditionModel.load_lora_adapter
        # silently loads nothing for either.
        from diffusers import StableDiffusionPipeline
        from huggingface_hub import hf_hub_download

        lrepo, lfile, lscale = spec.lora
        _say(progress, f"fusionando LoRA {lfile} (x{lscale})…")
        pipe = StableDiffusionPipeline.from_pretrained(
            spec.repo, torch_dtype=torch.float32, safety_checker=None, **kw)
        pipe.load_lora_weights(hf_hub_download(lrepo, lfile))
        pipe.fuse_lora(lora_scale=lscale)
        pipe.unload_lora_weights()
        unet = pipe.unet
        del pipe
    else:
        try:
            unet = UNet2DConditionModel.from_pretrained(spec.repo, subfolder="unet", torch_dtype=torch.float32, **kw)
        except Exception:
            unet = UNet2DConditionModel.from_pretrained(spec.repo, subfolder="unet", torch_dtype=torch.float32)
    unet.eval()
    hidden = unet.config.cross_attention_dim
    lw, lh = w // 8, h // 8
    ex = (
        torch.randn(1, 4, lh, lw),
        torch.tensor([500.0]),
        torch.randn(1, 77, hidden),
    )
    with torch.no_grad():
        traced = torch.jit.trace(_UNetWrap(unet), ex, strict=False)
    _convert(
        traced,
        inputs=[
            ct.TensorType(name="sample", shape=(1, 4, lh, lw), dtype=np.float16),
            ct.TensorType(name="timestep", shape=(1,), dtype=np.float16),
            ct.TensorType(name="encoder_hidden_states", shape=(1, 77, hidden), dtype=np.float16),
        ],
        outputs=[ct.TensorType(name="noise_pred", dtype=np.float16)],
        path=path,
    )
    del traced, unet
    gc.collect()
    _say(progress, f"UNet listo en {time.time() - t0:.0f}s: {path.name}")
    return path


def load_taesd(spec: ModelSpec):
    """The tiny VAE for this model: its own if it ships one, else madebyollin/taesd."""
    from diffusers import AutoencoderTiny

    if spec.taesd_repo:
        return AutoencoderTiny.from_pretrained(spec.taesd_repo, torch_dtype=torch.float32)
    return AutoencoderTiny.from_pretrained(spec.repo, subfolder="vae", torch_dtype=torch.float32)


def ensure_vae(spec: ModelSpec, w: int, h: int, progress: Progress | None = None) -> tuple[Path, Path]:
    enc_p, dec_p = vae_paths(spec, w, h)
    if enc_p.exists() and dec_p.exists():
        return enc_p, dec_p
    _say(progress, f"convirtiendo VAE {spec.key} {w}x{h}…")
    vae = load_taesd(spec).eval()
    lw, lh = w // 8, h // 8
    with torch.no_grad():
        if not enc_p.exists():
            traced = torch.jit.trace(vae.encoder, torch.randn(1, 3, h, w))
            _convert(
                traced,
                inputs=[ct.TensorType(name="image", shape=(1, 3, h, w), dtype=np.float16)],
                outputs=[ct.TensorType(name="latent", dtype=np.float16)],
                path=enc_p,
            )
        if not dec_p.exists():
            traced = torch.jit.trace(vae.decoder, torch.randn(1, 4, lh, lw))
            _convert(
                traced,
                inputs=[ct.TensorType(name="latent", shape=(1, 4, lh, lw), dtype=np.float16)],
                outputs=[ct.TensorType(name="image", dtype=np.float16)],
                path=dec_p,
            )
    del vae
    gc.collect()
    return enc_p, dec_p


def ensure_all(spec: ModelSpec, w: int, h: int, progress: Progress | None = None):
    ensure_vae(spec, w, h, progress)
    ensure_unet(spec, w, h, progress)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", default="sdxs", choices=list(MODELS))
    ap.add_argument("--size", default=None, help="WxH, or 'all' for every size the model accepts")
    a = ap.parse_args()
    spec = MODELS[a.model]
    sizes = sizes_for(spec) if a.size == "all" else [a.size or spec.default_size]
    for s in sizes:
        ensure_all(spec, *parse_size(s))
