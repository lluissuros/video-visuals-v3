"""Registry of the img2img models the service can run.

All are Stable Diffusion 1.x/2.x-shaped latent diffusion models distilled to
one step. They share the pipeline in pipeline.py; the differences are the
weights, the text encoder width and how many times the UNet halves the
latent (which fixes the pixel sizes it accepts).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSpec:
    key: str
    repo: str
    label: str
    #: Hugging Face repo with a TAESD (AutoencoderTiny) to use instead of the
    #: model's own VAE. None = the model ships its own tiny VAE.
    taesd_repo: str | None = None
    #: Weight variant to download (fp16 halves sd-turbo's download).
    variant: str | None = None
    #: Pixel multiple the UNet needs: 8 (latent) x 2^(down blocks - 1).
    multiple: int = 64
    #: Default resolution key (see sizes_for).
    default_size: str = "512x288"
    license: str = ""
    #: LoRA fused into the UNet before conversion: (repo, filename, scale).
    lora: tuple[str, str, float] | None = None
    #: Noising timesteps the model was trained to denoise in one step, if it
    #: was distilled for a fixed set (ADD, DMD2). None = any t (LCM, Hyper-SD).
    #: Informational; `strength` still picks t freely.
    notes: str = ""


MODELS: dict[str, ModelSpec] = {
    "sd-turbo": ModelSpec(
        key="sd-turbo",
        repo="stabilityai/sd-turbo",
        label="SD-Turbo · SD2.1",
        taesd_repo="madebyollin/taesd",
        variant="fp16",
        multiple=64,
        default_size="512x320",
        license="Stability AI community license",
        notes="ADD: distilled at t ∈ {250, 500, 750, 1000}; one step from a half-noised frame is sharp.",
    ),
    "lcm-dreamshaper": ModelSpec(
        key="lcm-dreamshaper",
        repo="Lykon/dreamshaper-8",
        label="DreamShaper 8 + LCM · SD1.5",
        taesd_repo="madebyollin/taesd",
        variant="fp16",
        multiple=64,
        default_size="512x320",
        license="CreativeML OpenRAIL-M (DreamShaper) · LCM-LoRA MIT",
        lora=("latent-consistency/lcm-lora-sdv1-5", "pytorch_lora_weights.safetensors", 1.0),
        notes="Consistency model: any t maps to a sharp x0. The original StreamDiffusion recipe.",
    ),
    "hyper-dreamshaper": ModelSpec(
        key="hyper-dreamshaper",
        repo="Lykon/dreamshaper-8",
        label="DreamShaper 8 + Hyper-SD 1 paso · SD1.5",
        taesd_repo="madebyollin/taesd",
        variant="fp16",
        multiple=64,
        default_size="512x320",
        license="CreativeML OpenRAIL-M · Hyper-SD (ByteDance) research",
        lora=("ByteDance/Hyper-SD", "Hyper-SD15-1step-lora.safetensors", 1.0),
        notes="Trained for one step at t≈800 (TCD).",
    ),
    "sdxs": ModelSpec(
        key="sdxs",
        repo="IDKiro/sdxs-512-0.9",
        label="SDXS 512 · SD2.1 · rápido pero borroso en img2img",
        multiple=32,
        license="OpenRAIL++",
        notes="Distilled for t=999 only: sharp from pure noise, blurry from a half-noised frame.",
    ),
}

DEFAULT_MODEL = "sd-turbo"

#: Candidate working resolutions (w x h). Wide ones match the 16:9 canvas of
#: the webapp; square ones are what the models were trained on.
# Three working sizes, all multiples of 64 so every model accepts them:
# small (fast), medium (the default), large (the show, if the GPU allows).
ALL_SIZES = ["384x256", "512x320", "768x448"]


def parse_size(size: str) -> tuple[int, int]:
    w, h = size.lower().split("x")
    return int(w), int(h)


def sizes_for(spec: ModelSpec) -> list[str]:
    """Resolutions this model's UNet accepts (both sides a multiple of its stride)."""
    out = []
    for s in ALL_SIZES:
        w, h = parse_size(s)
        if w % spec.multiple == 0 and h % spec.multiple == 0:
            out.append(s)
    return out
