'use strict';
/* Cadence AI - optional on-device common sense.
   LFM2-1.2B via Transformers.js: WebGPU (q4f16) when a real GPU adapter
   resolves, otherwise WASM (q4). Fully lazy and optional: the app works
   100% without it. Deterministic parsers stay the permanent fallback;
   AI only refines free-text answers. */
const AI = (() => {
  const MODEL_ID = 'onnx-community/LFM2-1.2B-ONNX';
  const REV = '7f871660813dc1f34f0d304c77506c5fbdb440a0';
  const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  let state = 'idle';           // idle | loading | ready | failed
  let loadPromise = null;
  let inst = null;              // { model, tokenizer, device }
  let stats = { bytes: 0, loadMs: 0, device: null, lastTokPerSec: null, lastError: null };
  const listeners = [];

  function status() { return state; }
  function info() { return { state, ...stats }; }
  function onStatus(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(f => { try { f(status()); } catch (e) {} }); }

  async function pickDevices() {
    // WebGPU only when a real adapter resolves; CPU-only devices go straight
    // to WASM so they never touch the webgpu-only q4f16 weights.
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return [['webgpu', 'q4f16'], ['wasm', 'q4']];
      } catch (e) { /* fall through */ }
    }
    return [['wasm', 'q4']];
  }

  function warmup() {
    if (state !== 'idle') return loadPromise;
    state = 'loading'; emit();
    const t0 = performance.now();
    loadPromise = (async () => {
      const seen = {};
      const onProgress = p => {
        if (p && p.file && p.status === 'progress') { seen[p.file] = Math.max(seen[p.file] || 0, p.loaded || 0); stats.bytes = Object.values(seen).reduce((a, b) => a + b, 0); }
      };
      try {
        const T = await import(TJS);
        const tokenizer = await T.AutoTokenizer.from_pretrained(MODEL_ID, { revision: REV, progress_callback: onProgress });
        const devices = await pickDevices();
        let model = null, device = null;
        for (const [d, dt] of devices) {
          try { model = await T.AutoModelForCausalLM.from_pretrained(MODEL_ID, { revision: REV, dtype: dt, device: d, progress_callback: onProgress }); device = d + '/' + dt; break; }
          catch (e) { /* fall through to next backend */ }
        }
        if (!model) throw new Error('no backend');
        inst = { model, tokenizer, device };
        stats.device = device;
        stats.loadMs = Math.round(performance.now() - t0);
        state = 'ready'; emit();
        return inst;
      } catch (e) {
        state = 'failed'; emit();
        return null;
      }
    })();
    return loadPromise;
  }

  async function chat(messages, maxNew) {
    if (state !== 'ready' || !inst) return null;
    try {
      const { model, tokenizer } = inst;
      const prompt = tokenizer.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true });
      const inputs = tokenizer(prompt);
      const inLen = inputs.input_ids.dims[1];
      const t0 = performance.now();
      const out = await model.generate({ ...inputs, max_new_tokens: maxNew || 16, do_sample: false });
      const ms = performance.now() - t0;
      const seq = out.sequences ? out.sequences : out;
      const ids = seq.tolist()[0];
      const nTok = ids.length - inLen;
      const text = tokenizer.decode(ids.slice(inLen), { skip_special_tokens: true }).trim();
      if (nTok > 0 && ms > 0) stats.lastTokPerSec = Math.round(nTok / (ms / 1000) * 10) / 10;
      return text;
    } catch (e) { stats.lastError = String((e && e.message) || e).slice(0, 200); return null; }
  }

  function cleanNameGuess(s) {
    if (!s) return null;
    const first = s.split('\n')[0].replace(/["'.!,;:]/g, '').trim();
    if (/^none$/i.test(first)) return null;
    const words = first.split(/\s+/).filter(w => /^[A-Za-z][A-Za-z'\-]{0,19}$/.test(w));
    if (!words.length || words.length > 2) return null;
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  async function extractName(raw) {
    if (state !== 'ready') return null;
    const out = await chat([
      { role: 'system', content: 'You extract a person\'s first name from what they typed when asked their name. Reply with ONLY the first name, capitalized. If there is no name, reply exactly: NONE' },
      { role: 'user', content: raw },
    ], 10);
    return cleanNameGuess(out);
  }

  return { status, info, onStatus, warmup, extractName, chat };
})();
