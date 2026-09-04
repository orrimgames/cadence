'use strict';
/* Cadence AI - common-sense layer, three tiers, always optional.
   1. Cloud: NVIDIA NIM (Nemotron) via the Supabase `coach` edge function -
      the API key lives server-side only, never in this file.
   2. On-device: LFM2-1.2B via Transformers.js (WebGPU q4f16 when a real GPU
      adapter resolves, else WASM q4) - the offline mid-tier, loaded lazily.
   3. Deterministic parsers in app.js - the permanent fallback.
   The app works 100% without tiers 1 and 2. */
const AI = (() => {
  const CLOUD_URL = 'https://pvmtxtpvrwvbrqwparlf.supabase.co/functions/v1/coach';
  const CLOUD_KEY = 'sb_publishable_WMSp1Y5tnUeNQF94WiR3rw_vwvYvAz0'; // publishable anon key, public by design
  const MODEL_ID = 'onnx-community/LFM2-1.2B-ONNX';
  const REV = '7f871660813dc1f34f0d304c77506c5fbdb440a0';
  const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  let state = 'idle';           // on-device model: idle | loading | ready | failed
  let loadPromise = null;
  let inst = null;              // { model, tokenizer, device }
  let stats = { bytes: 0, loadMs: 0, device: null, lastTokPerSec: null, lastError: null, cloud: null };
  const listeners = [];

  function status() { return state; }
  function info() { return { state, ...stats }; }
  function onStatus(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(f => { try { f(status()); } catch (e) {} }); }

  /* ---- tier 1: cloud (Nemotron via Supabase edge function) ---- */
  async function cloudChat(messages, maxNew) {
    if (!navigator.onLine) return null;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(CLOUD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CLOUD_KEY, Authorization: 'Bearer ' + CLOUD_KEY },
        body: JSON.stringify({ messages, max_tokens: Math.max(maxNew || 64, 24) }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!r.ok) { stats.cloud = 'http_' + r.status; warmup(); return null; }
      const d = await r.json();
      const text = d && typeof d.text === 'string' ? d.text.trim() : '';
      if (!text) { stats.cloud = 'empty'; return null; }
      stats.cloud = 'ok';
      return text;
    } catch (e) {
      stats.cloud = 'unreachable';
      warmup(); // cloud failed: start warming the offline mid-tier
      return null;
    }
  }

  /* ---- tier 2: on-device LFM2 ---- */
  async function pickDevices() {
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
          catch (e) { stats.lastError = String((e && e.message) || e).slice(0, 200); }
        }
        if (!model) throw new Error(stats.lastError || 'no backend');
        inst = { model, tokenizer, device };
        stats.device = device;
        stats.loadMs = Math.round(performance.now() - t0);
        state = 'ready'; emit();
        return inst;
      } catch (e) {
        stats.lastError = String((e && e.message) || e).slice(0, 200);
        state = 'failed'; emit();
        return null;
      }
    })();
    return loadPromise;
  }

  async function localChat(messages, maxNew) {
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

  /* ---- shared ---- */
  async function chat(messages, maxNew) {
    const cloud = await cloudChat(messages, maxNew);
    if (cloud) return cloud;
    return localChat(messages, maxNew);
  }

  function cleanNameGuess(s) {
    if (!s) return null;
    const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
    const last = (lines[lines.length - 1] || '').replace(/["'.!,;:]/g, '').trim();
    if (/^none$/i.test(last)) return null;
    const words = last.split(/\s+/).filter(w => /^[A-Za-z][A-Za-z'\-]{0,19}$/.test(w));
    if (!words.length || words.length > 2 || words.join(' ') !== last) return null;
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  async function extractName(raw) {
    const msgs = [
      { role: 'system', content: 'You extract a person\'s first name from what they typed when asked their name. Do not explain. Reply with ONLY the first name, capitalized. If there is no name, reply exactly: NONE' },
      { role: 'user', content: raw },
    ];
    const out = await cloudChat(msgs, 24) || await localChat(msgs, 10);
    return cleanNameGuess(out);
  }

  return { status, info, onStatus, warmup, extractName, chat, cloudChat };
})();
