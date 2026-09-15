# ai/ — img2img local en tiempo real (experimental)

Un servicio Python que toma los frames de la fuente de video-visuals-v3, los
reinterpreta con un prompt (difusión latente de **un paso**, en Core ML sobre
la GPU del Mac) y los devuelve al motor como textura. La parte web vive en
`src/ai/`. Nada más del repo depende de estas dos carpetas: si el experimento
no cuaja, se borran junto con las pocas líneas marcadas en `src/main.ts` y
`src/ui/panel.ts` (busca `src/ai`).

Research y decisiones: nota de Obsidian «aiSource — research log» (Personal).

## Cómo funciona (en una pantalla)

```
fuente (vídeo / imagen / cámara)           navegador, 60 fps
   │  drawImage → OffscreenCanvas 512×288 (recorte cover) → JPEG
   ▼  ws://127.0.0.1:8776   [u32 id][jpeg]           ≤ 2 frames en vuelo, cap «fps»
servicio Python (ai/server.py), un hilo de inferencia, buzón de UN frame
   │  JPEG → RGB → TAESD enc → latente
   │  latente = (1-memoria)·latente + memoria·x0_anterior
   │  x_t = √ā·latente + √(1-ā)·ruido_fijo      (t = fuerza·999)
   │  ε = UNet(x_t, t, prompt)  ·  x0 = (x_t − √(1-ā)·ε)/√ā     ← un paso
   │  TAESD dec → RGB → JPEG
   ▼  [u32 id][jpeg]
navegador: createImageBitmap → textura → compositor (src/ai/aiSource.ts)
   acc = mix(acc, ia, k)          fundido a 60 fps hacia cada frame nuevo («suavizar»)
   out = mix(acc, fuente, mezcla) la fuente devuelve el movimiento inmediato
   ▼
engine.setVideoTexture(out)     ← el motor no sabe que hay IA
```

El buzón de un frame es la regla importante: si el modelo va a 10 fps y la
cámara a 30, los frames viejos se tiran. La latencia no crece nunca.

## Uso

```sh
cd ai
uv sync                                  # una vez (Python 3.12, torch, coremltools…)
uv run server.py                         # sd-turbo a 512x320; la web se conecta sola
uv run server.py --model lcm-dreamshaper --size 512x320
uv run server.py --fake                  # sin modelo: prueba el circuito
uv run bench.py --model sd-turbo --sizes 512x320,768x448
uv run convert.py --model sd-turbo --size all      # preconvertir antes de un directo
```

La primera vez con cada (modelo, tamaño) el servicio descarga los pesos de
Hugging Face (1.7–2.7 GB por modelo) y convierte el UNet a Core ML
(`ai/models/`, medio minuto). Después carga en segundos y funciona sin red. **Antes de un directo, preconvierte y
arranca el servicio antes que la web.**

En la web: fold **ia** del panel. `ia on` pasa la fuente por el modelo;
`reset` limpia la memoria latente; `semilla` cambia la interpretación.
Los controles se recuerdan en el navegador (no en los presets, de momento).

| control | qué hace |
|---|---|
| modelo / tamaño | ver tabla abajo; menos píxeles = más fps |
| prompt | qué debe ver el modelo. Enter envía; la transición es gradual (`prompt_glide`) |
| fuerza | timestep de ruido: 0.3 cambia textura, 0.55 muta objetos, 0.8+ inventa |
| memoria | feedback del latente anterior: quita parpadeo; alto deriva (reset) |
| pasos | 1 es lo natural; 2-3 afinan a costa de fps |
| mezcla | fuente original encima del resultado (respuesta al movimiento) |
| suavizar | fundido hacia cada frame nuevo de IA |
| ruido | glitch: mete el latente de la fuente dentro del ruido. Con fuerza alta, manchas oscuras que siguen la imagen |
| fps | frames/s enviados. La GPU es compartida con el render: deja aire |
| flujo | la memoria latente se desplaza con el movimiento de la fuente (flujo óptico DIS en CPU, ~2 ms) antes de mezclarse. Sin él, con memoria ≥ 0.6 la imagen se congela en una composición propia y deja de mirar la fuente; con él sigue el movimiento y los cortes de plano y mantiene el estilo. Permite memoria alta sin arrastre |
| silueta | dónde va la máscara del tracking: **después** (el motor la pinta sobre la imagen generada, la IA no la ve), **antes** (se pinta con el color dominante de la paleta en el frame que recibe el modelo y el motor no la dibuja), **ambas**, **pantalla** (el modelo recibe la pantalla tal como la ves: silueta con sus colores y aura, y todo lo demás; es un bucle, «mezcla» ancla la fuente) |
| opacidad | opacidad de la silueta que ve el modelo (antes/ambas): 1 recorte plano, bajo fantasma sobre la fuente |
| miniatura | debajo del estado: lo que devuelve el modelo tal cual, antes de suavizar, mezcla y motor. Si un parpadeo no está ahí, viene de después |

Para estabilidad: sube `memoria` (0.6 reduce a la mitad el cambio entre frames respecto a 0.25),
sube `suavizar` (0.7-0.9) y baja `fuerza`. Con `fuerza` cerca de 1 el modelo pinta casi lo mismo
sea cual sea la fuente (semilla fija + prompt): parece que «se acuerda» de un vídeo anterior, pero
es su propia alucinación estable; cambia `semilla` para romperla. Medido en `almodovar-red.mp4`:
la salida cruda del modelo cambia entre frames un 0.2-0.8x de lo que cambia el propio vídeo, y sus
saltos de luminosidad son menores que los de la fuente. Una silueta plana en blanco («antes» con
la versión anterior) sí empujaba al modelo hacia los blancos.

## Modelos

| clave | pesos | base | múltiplo | qué da |
|---|---|---|---|---|
| `sd-turbo` (predeterminado) | stabilityai/sd-turbo | SD 2.1, 866 M | múltiplos de 64 | img2img nítido de un paso: fuerza 0.25 retoca, 0.5 estiliza, 0.75 reinventa la escena conservando la composición |
| `lcm-dreamshaper` | Lykon/dreamshaper-8 + LCM-LoRA fusionada | SD 1.5, 860 M | múltiplos de 64 | la receta original de StreamDiffusion; otro carácter (DreamShaper) |
| `hyper-dreamshaper` | Lykon/dreamshaper-8 + Hyper-SD 1-step LoRA | SD 1.5, 860 M | múltiplos de 64 | entrenada para un paso a t≈800: prueba fuerza alta |
| `sdxs` | IDKiro/sdxs-512-0.9 | SD 2.1, 328 M | múltiplos de 32 | **2.5× más rápido pero borroso en img2img** (ver abajo) |

Tamaños de trabajo: `384x256` (rápido), `512x320` (predeterminado) y `768x448`
(grande). Los tres son múltiplos de 64, así que todos los modelos los aceptan;
cada UNet convertido pesa 1.6 GB (626 MB en SDXS). Preconviértelos todos con
`uv run convert.py --model <clave> --size all`.

**Por qué SDXS sale borroso.** Un modelo de un paso solo sabe saltar a x0
desde los niveles de ruido en los que lo destilaron. SDXS se destiló solo
para t=999 (ruido total): desde ahí genera una imagen nítida, pero sin
relación con la entrada. Desde un frame medio ruidoso (fuerza 0.3–0.75)
devuelve la media posterior, que es una papilla. SD-Turbo (ADD) se destiló en
t ∈ {250, 500, 750, 1000}; LCM es un modelo de consistencia (cualquier t);
Hyper-SD igual. Por eso son ellos los que hacen img2img. Se conservan los dos
SDXS por si el borrón interesa como material.

Licencias: SD-Turbo, Stability AI community license; DreamShaper,
CreativeML OpenRAIL-M; LCM-LoRA, MIT; Hyper-SD, ByteDance (investigación);
SDXS, OpenRAIL++. El código de aquí es MIT y toma el esquema por frame de
`ochyai/streamdiffusion-mac` (MIT, arXiv 2605.16259).

Trampa conocida: `UNet2DConditionModel.load_lora_adapter` no carga estas
LoRA (ni el formato kohya de Hyper-SD ni el diffusers antiguo de LCM) y no
avisa. `convert.py` las fusiona a través de `StableDiffusionPipeline`, que sí
las convierte.

## Protocolo WebSocket

- web → servicio, binario: `u32 LE id` + JPEG ya recortado al tamaño de trabajo.
- web → servicio, texto: `{"type":"params", prompt, strength, feedback, seed, steps, prompt_glide}` (parcial),
  `{"type":"model","model":"sdxs","size":"512x320"}`, `{"type":"reset"}`.
- servicio → web, binario: `u32 LE id` (el del frame de origen) + JPEG.
- servicio → web, texto: `{"type":"status", ready, loading, error, model, size, sizes, models, fps, ms, dropped, params}` dos veces por segundo.

## Rendimiento medido

MacBook Pro M4 Max (32 núcleos GPU, 36 GB), Core ML fp16 en CPU+GPU,
`bench.py --n 40`, un paso, máquina en reposo:

| modelo | tamaño | enc ms | unet ms | dec ms | total ms | fps |
|---|---|---|---|---|---|---|
| sd-turbo | 512×320 | 8.5 | 58 | 7.4 | 75 | **13.2** |
| sd-turbo | 384×256 | 5.5 | 38 | 4.6 | 49 | 20.3 |
| sd-turbo | 512×320, 2 pasos | 16 | 217 (*) | 15 | 249 (*) | 4.0 (*) |
| hyper-dreamshaper | 512×320 | 8.5 | 70 | 7.6 | 87 | 11.5 |
| lcm-dreamshaper | 512×320 | 18 (*) | 126 (*) | 18 (*) | 164 (*) | 6.1 (*) |
| sdxs | 512×288 | 7.8 | 34 | 7.0 | 51 | 19.7 |
| sdxs | 384×224 | 5.5 | 37 | 4.6 | 48 | 20.6 |
| sdxs | 512×512 | 13 | 51 | 12 | 79 | 12.6 |

(*) medido con la CPU ocupada por otro proceso (un Chrome headless con GL
por software a 1000 % de CPU); en reposo espera ~la mitad. Lección: el
pipeline tiene partes de CPU (despacho de Core ML, numpy, JPEG) y sufre si la
CPU está saturada, no solo la GPU. Bajar de 512×288 a 384×224 no acelera
SDXS: a ese tamaño manda el coste fijo de despacho. La GPU es la misma que
dibuja la web: con el modelo a 8 fps el render sigue teniendo hueco, pero
mira el semáforo de **rendimiento** y baja `fps` si se pone ámbar.

## Archivos

- `models.py` — registro de modelos y tamaños válidos.
- `convert.py` — HF → Core ML (UNet y TAESD por tamaño), caché en `ai/models/`.
- `pipeline.py` — el frame: encode, feedback, ruido fijo, UNet, decode.
- `server.py` — WebSocket, buzón de un frame, hilo de inferencia, `--fake`.
- `bench.py` — ms por etapa y fps.
