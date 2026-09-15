// The «ia» fold of the panel: on/off, model, prompt and the few knobs of
// src/ai/aiSource.ts. Built through the panel's PanelExtension hook so the
// panel itself knows nothing about AI.

import type { PanelExtension, PanelKit } from '../ui/panel';
import type { AiLocal, AiSource } from './aiSource';

export function aiPanel(ai: AiSource): PanelExtension {
  return {
    name: 'ia',
    mount(kit: PanelKit) {
      const { body } = kit;

      // --- on/off, reset, seed -------------------------------------------
      const btnRow = document.createElement('div');
      btnRow.className = 'btn-row';
      const onBtn = kit.button('ia off', 'pasa la fuente por el modelo (servicio local: uv run ai/server.py)',
        () => { ai.setEnabled(!ai.enabled); syncOn(); });
      const resetBtn = kit.button('reset', 'olvida la memoria latente: la imagen vuelve a partir de la fuente',
        () => ai.reset());
      const seedBtn = kit.button('semilla', 'otra semilla de ruido: otra interpretación con el mismo prompt',
        () => ai.setParams({ seed: Math.floor(Math.random() * 1e6) }));
      const flowBtn = kit.button('flujo', 'la memoria sigue el movimiento de la fuente (flujo óptico): permite subir «memoria» sin arrastre',
        () => { ai.setParams({ flow: !ai.wanted.params.flow }); flowBtn.classList.toggle('on', !!ai.wanted.params.flow); });
      flowBtn.classList.toggle('on', !!ai.wanted.params.flow);
      btnRow.append(onBtn, resetBtn, seedBtn, flowBtn);
      body.appendChild(btnRow);
      const syncOn = () => {
        onBtn.textContent = ai.enabled ? 'ia ON' : 'ia off';
        onBtn.classList.toggle('on', ai.enabled);
      };
      syncOn();

      const status = document.createElement('div');
      status.className = 'ai-status';
      body.appendChild(status);

      // raw model output, before the crossfade, the mix and the engine: tells
      // whether a flicker comes from the model or from what follows
      const preview = document.createElement('canvas');
      preview.className = 'ai-preview';
      preview.width = 256; preview.height = 160;
      preview.title = 'lo que devuelve el modelo, tal cual (antes de suavizar, mezcla y motor)';
      const pctx = preview.getContext('2d')!;
      let lastFrame = -1;
      const drawPreview = () => {
        const bm = ai.bitmap;
        if (!bm || ai.frames === lastFrame) return;
        lastFrame = ai.frames;
        const sc = Math.max(preview.width / bm.width, preview.height / bm.height);
        const dw = bm.width * sc, dh = bm.height * sc;
        // the bitmap is stored upside down for the GPU: flip it back
        pctx.save();
        pctx.translate(0, preview.height); pctx.scale(1, -1);
        pctx.drawImage(bm, (preview.width - dw) / 2, (preview.height - dh) / 2, dw, dh);
        pctx.restore();
      };
      body.appendChild(preview);

      // --- model / size --------------------------------------------------
      const modelSel = document.createElement('select');
      modelSel.title = 'modelo: todos son difusión de un paso; cambiar tarda unos segundos (minutos la primera vez: conversión a Core ML)';
      modelSel.addEventListener('change', () => ai.setModel(modelSel.value));
      body.appendChild(modelSel);
      const sizeSel = document.createElement('select');
      sizeSel.title = 'resolución de trabajo del modelo: menos píxeles = más fps; las anchas encajan con el canvas 16:9';
      sizeSel.addEventListener('change', () => ai.setModel(ai.wanted.model, sizeSel.value));
      body.appendChild(sizeSel);

      // --- prompt --------------------------------------------------------
      const prompt = document.createElement('textarea');
      prompt.rows = 3;
      prompt.placeholder = 'prompt (Enter envía)';
      prompt.value = ai.wanted.params.prompt ?? '';
      prompt.title = 'qué debe ver el modelo en la fuente. Se envía al pulsar Enter o al dejar de escribir';
      let timer = 0;
      const sendPrompt = () => { window.clearTimeout(timer); ai.setParams({ prompt: prompt.value }); };
      prompt.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(sendPrompt, 700); });
      prompt.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendPrompt(); }
        ev.stopPropagation();   // keys like 1-9, space, h belong to the app, not while typing
      });
      body.appendChild(prompt);

      // --- knobs ---------------------------------------------------------
      const p = ai.wanted.params;
      const strength = kit.sliderRow('fuerza', 0.05, 1, 0.01, p.strength ?? 0.55, (v) => ai.setParams({ strength: v }));
      strength.row.title = 'cuánto se aleja el modelo de la fuente: bajo = textura y estilo, alto = inventa';
      const feedback = kit.sliderRow('memoria', 0, 0.9, 0.01, p.feedback ?? 0.25, (v) => ai.setParams({ feedback: v }));
      feedback.row.title = 'parte del frame anterior que el modelo recuerda: quita parpadeo, arriba deriva y se despega de la cámara (reset la limpia)';
      const steps = kit.sliderRow('pasos', 1, 3, 1, p.steps ?? 1, (v) => { ai.setParams({ steps: v }); steps.val.textContent = String(v); });
      steps.row.title = 'pasos del modelo por frame: 1 es para lo que están destilados; 2-3 afinan a costa de fps';
      steps.val.textContent = String(p.steps ?? 1);
      const noise = kit.sliderRow('ruido', 0, 1, 0.01, p.noise_mix ?? 0, (v) => ai.setParams({ noise_mix: v }));
      noise.row.title = 'glitch: mete la imagen dentro del ruido. Con fuerza alta salen manchas oscuras que siguen la fuente';
      const mix = kit.sliderRow('mezcla', 0, 1, 0.01, ai.local.mix, (v) => ai.setLocal({ mix: v }));
      mix.row.title = 'cuánta fuente original se ve encima de la imagen generada (movimiento inmediato)';
      const smooth = kit.sliderRow('suavizar', 0, 1, 0.01, ai.local.smooth, (v) => ai.setLocal({ smooth: v }));
      smooth.row.title = 'fundido hacia cada frame nuevo del modelo: 0 = corte seco, 1 = un segundo';
      const fps = kit.sliderRow('fps', 1, 24, 1, ai.local.sendFps, (v) => { ai.setLocal({ sendFps: v }); fps.val.textContent = String(v); });
      fps.row.title = 'frames por segundo que se envían al modelo: la GPU es compartida con el render, deja aire';
      fps.val.textContent = String(ai.local.sendFps);
      for (const r of [strength, feedback, noise, mix, smooth]) r.val.remove();

      // --- silhouette: after the model (engine), before it (model input), or both
      const SIL: Record<AiLocal['silhouette'], string> = {
        after: 'silueta después', before: 'silueta antes', both: 'silueta ambas', screen: 'silueta pantalla',
      };
      const silBtn = kit.button(SIL[ai.local.silhouette],
        'después: el motor pinta la silueta sobre la imagen generada. '
        + 'antes: la silueta (color de la paleta) se pinta en el frame que recibe el modelo y el motor no la dibuja. '
        + 'ambas: las dos cosas. '
        + 'pantalla: el modelo recibe la pantalla tal como la ves (silueta con colores y aura, y todo lo demás): '
        + 'un bucle, anclado por «mezcla»',
        () => {
          const order: AiLocal['silhouette'][] = ['after', 'before', 'both', 'screen'];
          const next = order[(order.indexOf(ai.local.silhouette) + 1) % order.length];
          ai.setLocal({ silhouette: next });
          silBtn.textContent = SIL[next];
          silBtn.classList.toggle('on', next !== 'after');
        });
      silBtn.classList.toggle('on', ai.local.silhouette !== 'after');
      const silRow = document.createElement('div');
      silRow.className = 'btn-row';
      silRow.append(silBtn);
      body.appendChild(silRow);
      const silOp = kit.sliderRow('opacidad', 0, 1, 0.01, ai.local.silOpacity, (v) => ai.setLocal({ silOpacity: v }));
      silOp.row.title = 'opacidad de la silueta que ve el modelo (antes/ambas): 1 = recorte plano, bajo = fantasma sobre la fuente';
      silOp.val.remove();

      // --- live status ---------------------------------------------------
      let lastModels = '';
      let lastSizes = '';
      window.setInterval(() => {
        drawPreview();
        const s = ai.status;
        const models = s.models.map((m) => m.key).join(',');
        if (models !== lastModels) {
          lastModels = models;
          modelSel.replaceChildren(...s.models.map((m) => {
            const o = document.createElement('option');
            o.value = m.key; o.textContent = m.label;
            return o;
          }));
        }
        if (s.models.length) modelSel.value = s.model || ai.wanted.model;
        const sizes = s.sizes.join(',');
        if (sizes !== lastSizes) {
          lastSizes = sizes;
          sizeSel.replaceChildren(...s.sizes.map((z) => {
            const o = document.createElement('option');
            o.value = z; o.textContent = `tamaño ${z}`;
            return o;
          }));
        }
        if (s.sizes.length) sizeSel.value = s.size;
        // no prompt of our own yet: show the service's default
        if (!prompt.value && ai.wanted.params.prompt === undefined && s.params?.prompt && document.activeElement !== prompt) {
          prompt.value = s.params.prompt;
        }
        if (!s.connected) {
          status.textContent = 'sin servicio · cd ai && uv run server.py';
          status.className = 'ai-status off';
        } else if (s.error) {
          status.textContent = `error: ${s.error}`.slice(0, 90);
          status.className = 'ai-status err';
        } else if (s.loading) {
          status.textContent = s.loading;
          status.className = 'ai-status warm';
        } else if (!s.ready) {
          status.textContent = 'cargando modelo…';
          status.className = 'ai-status warm';
        } else {
          const ms = s.ms ? ` · unet ${s.ms.unet.toFixed(0)} ms` : '';
          status.textContent = `${s.fps.toFixed(1)} fps · ${ai.latencyMs.toFixed(0)} ms ida y vuelta${ms}`;
          status.className = 'ai-status ok';
        }
      }, 300);
    },
  };
}
