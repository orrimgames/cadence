// Cadence coach relay v4 - proxies NIM chat completions, holds NVIDIA_API_KEY server-side.
const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const ALLOWED = new Set([DEFAULT_MODEL, 'moonshotai/kimi-k3']);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const { messages, max_tokens, model } = await req.json();
    if (!Array.isArray(messages) || !messages.length) return json({ error: 'bad_messages' }, 400);
    const useModel = ALLOWED.has(model) ? model : DEFAULT_MODEL;
    const body = {
      model: useModel,
      messages,
      max_tokens: Math.min(Math.max(max_tokens || 64, 24), 1024),
      temperature: 0.6,
      top_p: 0.95,
      reasoning_effort: 'none',
      enable_thinking: false,
      stream: false,
    };
    const r = await fetch(NIM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('NVIDIA_API_KEY') },
      body: JSON.stringify(body),
    });
    if (!r.ok) return json({ error: 'nim_http_' + r.status }, 502);
    const d = await r.json();
    const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    return json({ text, model: useModel });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
