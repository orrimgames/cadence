/* Cadence cloud sync — Supabase. Publishable key + row-level security; no secrets in this file. */
const Sync = (() => {
  const SB_URL = 'https://pvmtxtpvrwvbrqwparlf.supabase.co';
  const SB_KEY = 'sb_publishable_WMSp1Y5tnUeNQF94WiR3rw_vwvYvAz0';
  let sb = null, user = null, pushTimer = null, lastPushAt = null;

  function init() {
    if (typeof supabase === 'undefined') return; // CDN blocked/offline: app stays local-only
    try {
      sb = supabase.createClient(SB_URL, SB_KEY);
      sb.auth.onAuthStateChange((ev, session) => {
        const was = !!user;
        user = session ? session.user : null;
        if (user && (ev === 'SIGNED_IN' || !was)) pull();
        if (typeof onSyncChange === 'function') onSyncChange();
      });
    } catch (e) { sb = null; }
  }
  function ready() { return !!sb; }
  function signedIn() { return !!user; }
  function email() { return user ? user.email : null; }
  function lastSync() { return lastPushAt; }

  async function sendLink(em) {
    if (!sb) return { error: { message: 'offline' } };
    return sb.auth.signInWithOtp({
      email: em,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
  }
  async function signOut() {
    if (!sb) return;
    await sb.auth.signOut();
    user = null;
    if (typeof onSyncChange === 'function') onSyncChange();
  }

  function push() {
    if (!sb || !user || !S) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        const { error } = await sb.from('user_state')
          .upsert({ user_id: user.id, data: S, updated_at: new Date().toISOString() });
        if (!error) {
          lastPushAt = Date.now();
          if (typeof onSyncChange === 'function') onSyncChange();
        }
      } catch (e) { /* offline: local copy is authoritative until next push */ }
    }, 1200);
  }

  async function pull() {
    if (!sb || !user) return;
    try {
      const { data, error } = await sb.from('user_state')
        .select('data, updated_at').eq('user_id', user.id).maybeSingle();
      if (error) return;
      if (!data) { push(); return; } // first sign-in on a new account: upload local
      const cloudAt = Date.parse(data.updated_at) || 0;
      const localAt = (S && S.savedAt) ? Date.parse(S.savedAt) : 0;
      if (!S || cloudAt > localAt) {
        S = data.data;
        S.savedAt = data.updated_at;
        Engine.setUnits((S.profile && S.profile.units) || 'mi');
        save(true);
        render();
        toast('Synced from your account');
      } else {
        push(); // local is newer: upload
      }
    } catch (e) { /* stay local */ }
  }

  return { init, ready, signedIn, email, lastSync, sendLink, signOut, push, pull };
})();
