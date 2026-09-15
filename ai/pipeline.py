"""One-step img2img on Core ML, one frame at a time.

Per frame (after ochyai/streamdiffusion-mac, MIT):
  image -> tiny VAE encode -> blend with the previous denoised latent
  -> add FIXED noise at the timestep `strength` picks -> UNet, one step
  -> x0 = (x_t - sqrt(1-a) * eps) / sqrt(a) -> tiny VAE decode -> image.

The fixed noise and the latent feedback are what keep consecutive frames
from flickering; the prompt embedding is recomputed only when the text
changes and glides toward the new one over a few frames.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import coremltools as ct
import cv2
import numpy as np
import torch

from convert import COMPUTE, ensure_unet, ensure_vae, Progress
from models import ModelSpec


@dataclass
class Params:
    prompt: str = "a lush forest, cinematic, detailed"
    #: 0..1, how far from the source the model may go (the noising timestep).
    strength: float = 0.55
    #: 0..1, share of the previous denoised latent blended into the new input.
    feedback: float = 0.25
    seed: int = 42
    #: 1 is what these models were distilled for; 2-3 re-noise x0 at lower t.
    steps: int = 1
    #: Per-frame lerp toward a new prompt embedding (1 = jump).
    prompt_glide: float = 0.15
    #: 0..1, share of the (normalized) source latent folded INTO the noise.
    #: Not how these models were trained: with strength near 1 it gives dark,
    #: saturated blobs that follow the source. Kept as a glitch to explore.
    noise_mix: float = 0.0
    #: Warp the remembered latent along the source's optical flow before the
    #: feedback blend, so memory follows motion instead of leaving ghosts.
    #: Lets `feedback` go higher without drag. Dense flow (DIS) on the CPU.
    flow: bool = False


@dataclass
class Timings:
    decode_in: float = 0
    encode: float = 0
    unet: float = 0
    decode: float = 0
    total: float = 0
    extras: dict = field(default_factory=dict)


class Pipeline:
    def __init__(self, spec: ModelSpec, w: int, h: int, progress: Progress | None = None):
        self.spec, self.w, self.h = spec, w, h
        self.lw, self.lh = w // 8, h // 8
        self.params = Params()
        self._say = progress or (lambda m: None)
        self._load()

    # ------------------------------------------------------------------ setup
    def _load(self):
        from diffusers import DDPMScheduler
        from transformers import CLIPTextModel, CLIPTokenizer

        spec = self.spec
        enc_p, dec_p = ensure_vae(spec, self.w, self.h, self._say)
        unet_p = ensure_unet(spec, self.w, self.h, self._say)
        self._say(f"cargando {spec.key} {self.w}x{self.h}…")
        t0 = time.time()
        self.vae_enc = ct.models.MLModel(str(enc_p), compute_units=COMPUTE)
        self.vae_dec = ct.models.MLModel(str(dec_p), compute_units=COMPUTE)
        self.unet = ct.models.MLModel(str(unet_p), compute_units=COMPUTE)

        # Noise schedule: only alphas_cumprod and the prediction type matter.
        sched = DDPMScheduler.from_pretrained(spec.repo, subfolder="scheduler")
        self.alphas = sched.alphas_cumprod.numpy().astype(np.float32)
        self.pred_type = sched.config.prediction_type
        self.n_train = len(self.alphas)

        # Text encoder stays in torch (runs only when the prompt changes).
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.tokenizer = CLIPTokenizer.from_pretrained(spec.repo, subfolder="tokenizer")
        kw = {"variant": spec.variant} if spec.variant else {}
        try:
            te = CLIPTextModel.from_pretrained(spec.repo, subfolder="text_encoder", torch_dtype=torch.float16, **kw)
        except Exception:
            te = CLIPTextModel.from_pretrained(spec.repo, subfolder="text_encoder", torch_dtype=torch.float16)
        self.text_encoder = te.to(self.device).eval()

        self._prev_x0: np.ndarray | None = None
        self._prev_gray: np.ndarray | None = None
        self._dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self._noise: np.ndarray | None = None
        self._noise_seed = None
        self._embeds: np.ndarray | None = None
        self._target: np.ndarray | None = None
        self._prompt_text = None
        self.set_prompt(self.params.prompt)
        self._embeds = self._target.copy()
        self._say(f"{spec.key} {self.w}x{self.h} listo ({time.time() - t0:.1f}s de carga)")

    # --------------------------------------------------------------- controls
    def set_prompt(self, text: str):
        if text == self._prompt_text:
            return
        self._prompt_text = text
        ids = self.tokenizer(
            text, padding="max_length", max_length=self.tokenizer.model_max_length,
            truncation=True, return_tensors="pt",
        ).input_ids.to(self.device)
        with torch.no_grad():
            out = self.text_encoder(ids)[0]
        self._target = out.float().cpu().numpy().astype(np.float16)
        if self._embeds is None:
            self._embeds = self._target.copy()

    def reset(self):
        """Drop the latent memory; the next frame starts clean from the source."""
        self._prev_x0 = None
        self._prev_gray = None

    def _fixed_noise(self, seed: int) -> np.ndarray:
        if self._noise is None or self._noise_seed != seed:
            rng = np.random.RandomState(seed)
            self._noise = rng.randn(1, 4, self.lh, self.lw).astype(np.float32)
            self._noise_seed = seed
        return self._noise

    def _warp_memory(self, rgb: np.ndarray) -> np.ndarray | None:
        """Previous x0 moved to where the source moved. Flow at half image
        resolution, applied at latent resolution (1/8)."""
        lw, lh = self.w // 8, self.h // 8
        gray = cv2.cvtColor(cv2.resize(rgb, (self.w // 2, self.h // 2), interpolation=cv2.INTER_AREA),
                            cv2.COLOR_RGB2GRAY)
        prev_gray, self._prev_gray = self._prev_gray, gray
        if self._prev_x0 is None or prev_gray is None:
            return self._prev_x0
        # backward flow: for each current pixel, where it was in the previous frame
        flow = self._dis.calc(gray, prev_gray, None)
        flow = cv2.resize(flow, (lw, lh), interpolation=cv2.INTER_AREA) * (lw / gray.shape[1])
        ys, xs = np.mgrid[0:lh, 0:lw].astype(np.float32)
        mx, my = xs + flow[..., 0], ys + flow[..., 1]
        prev = self._prev_x0[0]
        warped = np.stack([cv2.remap(prev[c], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                           for c in range(prev.shape[0])])
        return warped[None].astype(np.float32)

    # ------------------------------------------------------------------ frame
    def process(self, rgb: np.ndarray) -> tuple[np.ndarray, Timings]:
        """uint8 RGB (h, w, 3) at the working size -> uint8 RGB (h, w, 3)."""
        p = self.params
        tm = Timings()
        t_start = time.perf_counter()

        # prompt glide
        if self._target is not None and self._embeds is not None:
            diff = self._target.astype(np.float32) - self._embeds.astype(np.float32)
            if np.abs(diff).max() > 1e-3:
                self._embeds = (self._embeds.astype(np.float32) + p.prompt_glide * diff).astype(np.float16)
            else:
                self._embeds = self._target

        img = (rgb.astype(np.float32) / 127.5 - 1.0).transpose(2, 0, 1)[None].astype(np.float16)
        t0 = time.perf_counter()
        clean = np.asarray(self.vae_enc.predict({"image": img})["latent"], dtype=np.float32)
        tm.encode = time.perf_counter() - t0

        if p.flow:
            self._prev_x0 = self._warp_memory(rgb)
        else:
            self._prev_gray = None
        if self._prev_x0 is not None and p.feedback > 0:
            fb = float(min(0.95, p.feedback))
            clean = (1 - fb) * clean + fb * self._prev_x0

        noise = self._fixed_noise(p.seed)
        if p.noise_mix > 0:
            latn = (clean - clean.mean()) / (clean.std() + 1e-6)
            noise = (1 - p.noise_mix) * noise + p.noise_mix * latn
            noise = noise / (noise.std() + 1e-6)
        steps = max(1, min(4, int(p.steps)))
        t_top = float(np.clip(p.strength, 0.02, 1.0)) * (self.n_train - 1)
        x0 = clean
        t0 = time.perf_counter()
        for i in range(steps):
            t = int(round(t_top * (1 - i / steps)))
            a = float(self.alphas[t])
            sa, s1a = np.sqrt(a), np.sqrt(1 - a)
            xt = (sa * x0 + s1a * noise).astype(np.float16)
            out = self.unet.predict({
                "sample": xt,
                "timestep": np.array([t], dtype=np.float16),
                "encoder_hidden_states": self._embeds,
            })["noise_pred"]
            pred = np.asarray(out, dtype=np.float32)
            xt32 = xt.astype(np.float32)
            if self.pred_type == "v_prediction":
                x0 = sa * xt32 - s1a * pred
            else:
                x0 = (xt32 - s1a * pred) / sa
        tm.unet = time.perf_counter() - t0
        self._prev_x0 = x0

        t0 = time.perf_counter()
        dec = np.asarray(self.vae_dec.predict({"latent": x0.astype(np.float16)})["image"], dtype=np.float32)
        tm.decode = time.perf_counter() - t0
        out_rgb = ((dec[0].transpose(1, 2, 0) + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
        tm.total = time.perf_counter() - t_start
        return np.ascontiguousarray(out_rgb), tm
