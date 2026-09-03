'use strict';
/* Cadence - AI running coach. UI + tracking layer (engine.js holds all coaching logic). */

const Store = {
  KEY: 'cadence.v1',
  load() { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; } },
  save(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },
  clear() { localStorage.removeItem(this.KEY); },
};

let S = Store.load();
let ob = null;           // onboarding draft
let view = 'today';
let toastTimer = null;

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function save() { Store.save(S); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function prettyDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function shortDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ============================ ONBOARDING ============================ */

const RACE_DISTS = { '1mi': 1609.34, '5k': 5000, '10k': 10000, half: 21097.5, marathon: 42195 };

function startOnboarding() {
  ob = { step: 0, goal: null, raceDate: null, fitnessMode: 'race', raceDist: '5k', raceH: 0, raceM: 25, raceS: 0, easyMin: 10, easySec: 0, weeklyMiles: 0, daysPerWeek: 4, longDay: 6 };
  renderOnboarding();
}

function renderOnboarding() {
  const v = $('#view');
  v.className = 'onboarding';
  const dots = `<div class="dots">${[0,1,2,3,4].map(i => `<i class="${i <= ob.step ? 'on' : ''}"></i>`).join('')}</div>`;

  if (ob.step === 0) {
    v.innerHTML = `
      <div class="ob-hero">
        <div class="wordmark">CADENCE<i></i></div>
        <h1>A running coach<br>that adapts to you.</h1>
        <p class="sub">A plan built around your goal, your fitness and your week - that re-adjusts itself every time you run.</p>
        <div class="feats">
          <div><b>Adaptive plan</b><span>Easy, tempo, interval and long runs, periodized to race day</span></div>
          <div><b>Live GPS tracking</b><span>Real-time pace and mile splits on your wrist-free phone</span></div>
          <div><b>Coaching paces</b><span>Every workout targeted to your current fitness</span></div>
        </div>
        <button class="cta" onclick="obStep(1)">Get started</button>
      </div>`;
    return;
  }

  if (ob.step === 1) {
    const goals = Object.entries(Engine.GOALS);
    v.innerHTML = `
      <div class="ob">
        ${dots}
        <h2>What are we training for?</h2>
        <div class="cards">
          ${goals.map(([k, g]) => `
            <button class="opt ${ob.goal === k ? 'sel' : ''}" onclick="obSet('goal','${k}')">
              <b>${g.label}</b>
              <span>${{ fitness: 'Build the habit, get faster', '5k': '3.1 miles of speed', '10k': 'The classic 6.2', half: '13.1 miles', marathon: 'The full 26.2' }[k]}</span>
            </button>`).join('')}
        </div>
        <div class="navrow">
          <button class="ghost" onclick="obStep(0)">Back</button>
          <button class="cta" ${ob.goal ? '' : 'disabled'} onclick="obNext()">Continue</button>
        </div>
      </div>`;
    return;
  }

  if (ob.step === 2) {
    const isRace = ob.goal !== 'fitness';
    v.innerHTML = `
      <div class="ob">
        ${dots}
        <h2>${isRace ? 'When is race day?' : 'Your week'}</h2>
        ${isRace ? `
        <p class="hint">Pick your race date. The plan periodizes backward from it - base, build, peak, taper.</p>
        <input type="date" id="raceDate" class="dateinput" value="${ob.raceDate || defaultRaceDate()}" min="${Engine.todayISO()}" onchange="obSet('raceDate',this.value)">
        <p class="hint" id="weeksNote">${weeksNote()}</p>` : `
        <p class="hint">No race needed - Cadence builds a 12-week fitness block and keeps it adapting to you.</p>`}
        <div class="navrow">
          <button class="ghost" onclick="obStep(1)">Back</button>
          <button class="cta" onclick="obNext()">Continue</button>
        </div>
      </div>`;
    return;
  }

  if (ob.step === 3) {
    v.innerHTML = `
      <div class="ob">
        ${dots}
        <h2>How fit are you right now?</h2>
        <p class="hint">This sets every workout pace. Be honest - the plan only works if the paces fit you.</p>
        <div class="seg">
          <button class="${ob.fitnessMode === 'race' ? 'on' : ''}" onclick="obSet('fitnessMode','race')">Recent race time</button>
          <button class="${ob.fitnessMode === 'pace' ? 'on' : ''}" onclick="obSet('fitnessMode','pace')">Comfortable pace</button>
        </div>
        ${ob.fitnessMode === 'race' ? `
          <div class="seg small">
            ${Object.keys(RACE_DISTS).map(k => `<button class="${ob.raceDist === k ? 'on' : ''}" onclick="obSet('raceDist','${k}')">${{ '1mi': '1 mile', '5k': '5K', '10k': '10K', half: 'Half', marathon: 'Marathon' }[k]}</button>`).join('')}
          </div>
          <div class="steppers">
            ${stepper('raceH', 0, 9, 'hr')}
            ${stepper('raceM', 0, 59, 'min')}
            ${stepper('raceS', 0, 59, 'sec')}
          </div>` : `
          <p class="hint center">A mile you could hold a conversation through:</p>
          <div class="steppers">
            ${stepper('easyMin', 4, 20, 'min')}
            ${stepper('easySec', 0, 59, 'sec')}
            <div class="unit">/ mile</div>
          </div>`}
        <p class="hint" style="margin-top:18px">Current weekly mileage <span class="dim">(optional)</span></p>
        <div class="steppers">${stepper('weeklyMiles', 0, 80, 'mi / wk')}</div>
        <div class="navrow">
          <button class="ghost" onclick="obStep(2)">Back</button>
          <button class="cta" onclick="obNext()">Continue</button>
        </div>
      </div>`;
    return;
  }

  if (ob.step === 4) {
    v.innerHTML = `
      <div class="ob">
        ${dots}
        <h2>Your training week</h2>
        <p class="hint">Days per week you can run:</p>
        <div class="seg">
          ${[3, 4, 5, 6].map(n => `<button class="${ob.daysPerWeek === n ? 'on' : ''}" onclick="obSet('daysPerWeek',${n})">${n}</button>`).join('')}
        </div>
        <p class="hint">Long run day:</p>
        <div class="seg">
          ${Engine.DAY_NAMES.map((d, i) => `<button class="${ob.longDay === i ? 'on' : ''}" onclick="obSet('longDay',${i})">${d}</button>`).join('')}
        </div>
        <div class="navrow">
          <button class="ghost" onclick="obStep(3)">Back</button>
          <button class="cta" onclick="buildPlan()">Build my plan</button>
        </div>
      </div>`;
    return;
  }
}

function stepper(key, min, max, unit) {
  return `<div class="stepper">
    <button onclick="obBump('${key}',-1,${min},${max})">−</button>
    <div><b id="st_${key}">${String(ob[key]).padStart(2, '0')}</b><span>${unit}</span></div>
    <button onclick="obBump('${key}',1,${min},${max})">+</button>
  </div>`;
}

function obBump(key, d, min, max) {
  ob[key] = Math.min(max, Math.max(min, ob[key] + d));
  const el = $('#st_' + key);
  if (el) el.textContent = String(ob[key]).padStart(2, '0');
}
function obSet(k, val) { ob[k] = val; renderOnboarding(); }
function obStep(n) { ob.step = n; renderOnboarding(); }
function obNext() {
  if (ob.step === 1 && ob.goal === 'fitness') { ob.raceDate = null; }
  ob.step += 1;
  renderOnboarding();
}
function defaultRaceDate() { return Engine.addDays(Engine.todayISO(), 84); }
function weeksNote() {
  const d = ob.raceDate || defaultRaceDate();
  const w = Math.ceil((Engine.daysBetween(Engine.todayISO(), d) + 1) / 7);
  return w + ' weeks to train' + (w > 20 ? ' - Cadence will build the final 20 weeks' : '') + '.';
}

function buildPlan() {
  let vdot;
  if (ob.fitnessMode === 'race') {
    const t = ob.raceH * 3600 + ob.raceM * 60 + ob.raceS;
    vdot = Engine.vdotFromRace(RACE_DISTS[ob.raceDist], Math.max(t, 60));
  } else {
    vdot = Engine.vdotFromEasyPace(ob.easyMin * 60 + ob.easySec);
  }
  const profile = {
    goal: ob.goal,
    raceDateISO: ob.goal === 'fitness' ? null : (ob.raceDate || defaultRaceDate()),
    daysPerWeek: ob.daysPerWeek,
    longDay: ob.longDay,
    vdot,
    weeklyMiles: ob.weeklyMiles || null,
  };
  const plan = Engine.generatePlan(profile);
  S = { profile, plan, runs: [], createdAt: new Date().toISOString() };
  save();
  const g = Engine.GOALS[ob.goal];
  const pred = g.raceMi ? Engine.fmtClock(Engine.predictRaceTime(vdot, g.raceMi * Engine.MI)) : null;
  const v = $('#view');
  v.innerHTML = `
    <div class="ob-hero">
      <div class="wordmark">CADENCE<i></i></div>
      <h1>Your plan is ready.</h1>
      <div class="summarycard">
        <div class="sumrow"><span>Goal</span><b>${g.label}${profile.raceDateISO ? ' · ' + prettyDate(profile.raceDateISO) : ''}</b></div>
        ${pred ? `<div class="sumrow"><span>Predicted finish</span><b class="volt">${pred}</b></div>` : ''}
        <div class="sumrow"><span>Training</span><b>${plan.weeks.length} weeks · ${ob.daysPerWeek} days / week</b></div>
        <div class="sumrow"><span>Easy pace</span><b>${Engine.fmtPaceRange(Engine.paceZones(vdot).easy.lo, Engine.paceZones(vdot).easy.hi)}/mi</b></div>
      </div>
      <p class="hint">Miss a run and the plan adjusts. Nail every run and it pushes you. Just train.</p>
      <button class="cta" onclick="go('today')">Start training</button>
    </div>`;
}

/* ============================ MAIN VIEWS ============================ */

function go(v) {
  view = v;
  document.querySelectorAll('.tabbar .tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
  render();
}

function render() {
  if (!S) { startOnboarding(); return; }
  Engine.syncPlan(S.plan, S.runs);
  const notes = Engine.adaptPlan(S.plan);
  save();
  if (notes.length && view === 'today') setTimeout(() => toast(notes[notes.length - 1]), 600);
  $('#view').className = '';
  if (view === 'today') renderToday();
  else if (view === 'plan') renderPlan();
  else if (view === 'run') renderRun();
  else if (view === 'stats') renderStats();
  else if (view === 'you') renderYou();
}

const TYPE_COLORS = { easy: '#8A94A0', interval: '#FF9F45', tempo: '#67E8F9', long: '#D6FF3F', race: '#FF5A7A' };
function typeTag(t) { return `<i class="tdot" style="background:${TYPE_COLORS[t] || '#8A94A0'}"></i>${t}`; }

function coachNote() {
  const wk = Engine.currentWeek(S.plan);
  const c = Engine.weekCompliance(wk);
  const last = S.plan.adaptLog.filter(a => a.reason).slice(-1)[0];
  if (last && Engine.daysBetween(last.at.slice(0, 10), Engine.todayISO()) <= 3) return last.reason;
  const notes = {
    base: 'Base phase - volume before speed. Stack easy miles and let fitness come to you.',
    build: 'Build phase - the work gets specific now. Hit the quality days, protect the easy days.',
    peak: 'Peak week - biggest load of the plan. Sleep is training now.',
    taper: 'Taper - the fitness is banked. Short, sharp, rested. Trust it.',
    race: 'Race week. Less is more. Arrive hungry.',
  };
  if (c && c.ratio < 0.5) return 'Last week slipped. No guilt - the plan already re-balanced around it.';
  return notes[wk.phase] || notes.base;
}


/* ---- gamification UI ---- */
const BICONS = {
  run: '<svg viewBox="0 0 24 24"><path d="M13 5a1.8 1.8 0 1 0 0 .1M6 20l2.5-4.5L7 13l2-5 4 1.5L15 7l3 2M9 11l-3 1.5M12.5 20l1-4-3-2"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M6 21V4m0 1h11l-3 4 3 4H6"/></svg>',
  mountain: '<svg viewBox="0 0 24 24"><path d="M3 19 10 7l4 7 2-3 5 8z"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3-3 5-3 9a5 5 0 0 0 10 0c0-2-1-3.5-2-5-.5 1.5-1.5 2-1.5 2 .5-2.5-1.5-5-3.5-6z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5z"/></svg>',
  ring: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 5 13h6l-1 9 9-12h-6z"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4.5 20V10M10 20V4.5M15.5 20v-9M21 20V7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/></svg>',
};
function badgeGlyph(icon) { return BICONS[icon] || BICONS.ring; }

function renderToday() {
  const today = Engine.todayISO();
  const wk = Engine.currentWeek(S.plan);
  const sess = Engine.todaySession(S.plan);
  const next = Engine.nextSession(S.plan);
  const g = Engine.GOALS[S.profile.goal];
  const done = wk.sessions.filter(s => s.status === 'done').reduce((a, s) => a + (s.distMi || 0), 0);

  // Week strip: Sun..Sat of current calendar week
  const t = new Date(today + 'T12:00:00');
  const dow = t.getDay();
  const strip = [];
  for (let i = 0; i < 7; i++) {
    const iso = Engine.addDays(today, i - dow);
    const s = wk.sessions.find(x => x.date === iso);
    let cls = 'day', inner = Engine.DAY_NAMES[i][0];
    if (iso === today) cls += ' today';
    if (s) {
      cls += ' has';
      if (s.status === 'done') { cls += ' done'; inner = '✓'; }
      else if (s.status === 'missed') { cls += ' missed'; inner = '×'; }
      else inner = Engine.DAY_NAMES[i][0];
    }
    strip.push(`<div class="${cls}"><b>${inner}</b></div>`);
  }

  let sessHtml;
  if (sess && sess.status === 'pending') {
    sessHtml = `
      <div class="sesscard ${sess.type}">
        <div class="tag">${typeTag(sess.type)}</div>
        <h3>${esc(sess.title)}</h3>
        <div class="big">${Engine.fmtMi(sess.distMi)}<span> mi</span></div>
        <p>${esc(sess.desc)}</p>
        <div class="btnrow">
          <button class="cta" onclick="startPlannedRun()">Start this run</button>
          <button class="ghost" onclick="openManual()">Log manually</button>
        </div>
      </div>`;
  } else if (sess && sess.status === 'done') {
    sessHtml = `
      <div class="sesscard done">
        <div class="tag">${typeTag(sess.type)}</div>
        <h3>${esc(sess.title)}</h3>
        <div class="donecheck">Done ✓</div>
        <p>${next ? 'Next up: ' + esc(next.title) + ' · ' + prettyDate(next.date) : 'Plan complete. Legend.'}</p>
      </div>`;
  } else {
    sessHtml = `
      <div class="sesscard rest">
        <div class="tag"><i class="tdot" style="background:#3A4552"></i>rest</div>
        <h3>Rest day</h3>
        <p>Recovery is where the adaptation happens.${next ? ' Next: <b>' + esc(next.title) + '</b> · ' + prettyDate(next.date) + '.' : ''}</p>
        <div class="btnrow">
          <button class="ghost" onclick="go('run')">Log an extra run</button>
        </div>
      </div>`;
  }

  const streak = activeWeeks();
  $('#view').innerHTML = `
    <div class="page">
      <header>
        <div class="wordmark sm">CADENCE<i></i></div>
        <div class="datestr">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </header>
      <div class="coachcard">
        <div class="coachlabel">COACH</div>
        <p>${esc(coachNote())}</p>
      </div>
      <div class="weekstrip">${strip.join('')}</div>
      ${sessHtml}
      <div class="statrow">
        <div class="stat">
          <b>${Engine.fmtMi(done)}<span class="dimunit"> / ${Engine.fmtMi(wk.targetMi)} mi</span></b>
          <div class="pbar"><i style="width:${Math.min(100, Math.round(done / Math.max(1, wk.targetMi) * 100))}%"></i></div>
          <span>this week</span>
        </div>
        <div class="stat"><b>${streak}</b><span>active weeks</span></div>
        <div class="stat"><b>W${wk.num}</b><span>${wk.phaseLabel} phase</span></div>
      </div>
    </div>`;
}

function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  return Engine.addDays(iso, -((d.getDay() + 6) % 7));
}
function activeWeeks() {
  const weeks = new Set(S.runs.map(r => mondayOf(r.date)));
  let n = 0;
  let wk = mondayOf(Engine.todayISO());
  if (!weeks.has(wk)) wk = Engine.addDays(wk, -7);
  while (weeks.has(wk)) { n++; wk = Engine.addDays(wk, -7); }
  return n;
}

function renderPlan() {
  const wk = Engine.currentWeek(S.plan);
  const g = Engine.GOALS[S.profile.goal];
  const pred = g.raceMi ? Engine.fmtClock(Engine.predictRaceTime(S.profile.vdot, g.raceMi * Engine.MI)) : null;
  const adaptNote = S.plan.adaptLog.filter(a => a.reason).slice(-1)[0];

  $('#view').innerHTML = `
    <div class="page">
      <header>
        <h2 class="ptitle">The plan</h2>
        <div class="plansub">${g.label}${S.profile.raceDateISO ? ' · ' + prettyDate(S.profile.raceDateISO) : ''}${pred ? ' · <span class="volt">' + pred + '</span> predicted' : ''}</div>
      </header>
      ${adaptNote ? `<div class="adaptbanner">⚡ ${esc(adaptNote.reason)}</div>` : ''}
      <div class="weeklist">
        ${S.plan.weeks.map(w => weekCard(w, w.num === wk.num)).join('')}
      </div>
    </div>`;
}

function weekCard(w, open) {
  const c = Engine.weekCompliance(w);
  const today = Engine.todayISO();
  return `
    <div class="weekcard ${open ? 'open' : ''}">
      <button class="weekhead" onclick="this.parentElement.classList.toggle('open')">
        <div><b>Week ${w.num}</b><span class="phasechip ${w.phase}">${w.phaseLabel}</span></div>
        <div class="wmeta">${Engine.fmtMi(w.targetMi)} mi${c ? ` · ${c.done}/${c.done + c.missed}` : ''}</div>
      </button>
      <div class="weekbody">
        ${w.sessions.map(s => `
          <div class="sessrow ${s.status} ${s.date === today ? 'today' : ''}">
            <div class="sday"><b>${Engine.DAY_NAMES[s.dow]}</b><span>${shortDate(s.date)}</span></div>
            <div class="sinfo"><b>${esc(s.title)}</b><span>${typeTag(s.type)} · ${Engine.fmtMi(s.distMi)} mi</span></div>
            <div class="sstatus">${s.status === 'done' ? '✓' : s.status === 'missed' ? '×' : s.date === today ? '•' : ''}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ============================ RUN TRACKER ============================ */

const T = {
  active: false, paused: false,
  pts: [], distMi: 0, elapsed: 0,
  startTs: 0, pauseStart: 0, pauseTotal: 0,
  watchId: null, tickId: null,
  splits: [], lastSplitAt: 0,
  target: null,
  gpsState: 'searching', // searching | ok | weak | denied
};

function renderRun() {
  if (T.active) { renderRunActive(); return; }
  const sess = Engine.todaySession(S.plan);
  T.target = sess && sess.status === 'pending' ? sess : null;
  $('#view').innerHTML = `
    <div class="page runidle">
      <header><h2 class="ptitle">Run</h2></header>
      ${T.target ? `
        <div class="targetcard">
          <div class="tag">${typeTag(T.target.type)}</div>
          <h3>${esc(T.target.title)}</h3>
          <p>${esc(T.target.desc)}</p>
        </div>` : `<div class="targetcard dimcard"><h3>Free run</h3><p>No workout scheduled today. Run free - Cadence still logs it.</p></div>`}
      <button class="startrun" onclick="startRun()">
        <svg class="playglyph" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>
        <b>START</b>
      </button>
      <button class="ghost wide" onclick="openManual()">Log a past run manually</button>
    </div>`;
}

function startPlannedRun() { go('run'); setTimeout(startRun, 350); }

function startRun() {
  if (T.active) return;
  if (!navigator.geolocation) { toast('Geolocation not available - use manual log'); return; }
  T.active = true; T.paused = false;
  T.pts = []; T.distMi = 0; T.elapsed = 0;
  T.startTs = Date.now(); T.pauseTotal = 0;
  T.splits = []; T.lastSplitAt = 0;
  T.gpsState = 'searching';
  T.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  T.tickId = setInterval(tick, 500);
  renderRunActive();
}

function onPos(p) {
  if (!T.active || T.paused) return;
  const acc = p.coords.accuracy || 999;
  if (acc > 30) { T.gpsState = 'weak'; return; }
  T.gpsState = acc <= 12 ? 'ok' : 'weak';
  const pt = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() };
  const last = T.pts[T.pts.length - 1];
  if (last) {
    const d = haversine(last.lat, last.lon, pt.lat, pt.lon); // meters
    const dt = (pt.t - last.t) / 1000;
    if (dt <= 0) return;
    const speed = d / dt;
    if (speed > 8.5) return; // GPS teleport - drop
    if (d < 1.5) return;     // jitter
    T.distMi += d / Engine.MI;
  }
  T.pts.push(pt);
  // mile splits
  const nextSplit = T.splits.length + 1;
  if (T.distMi >= nextSplit) {
    T.splits.push({ mi: nextSplit, sec: T.elapsed - T.lastSplitAt });
    T.lastSplitAt = T.elapsed;
    if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  }
  updateRunMap();
}

function onPosErr(e) {
  T.gpsState = 'denied';
  if (T.active) renderRunActive();
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}


/* ---- route map (Leaflet + OpenStreetMap/CARTO dark tiles - free, no API key) ---- */
let runMap = null, runLine = null, runDot = null;
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTR = 'Esri, HERE, Garmin, FAO, NOAA, USGS, EPA &middot; &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
function mapsReady() { return typeof L !== 'undefined'; }
function destroyRunMap() {
  if (runMap) { try { runMap.remove(); } catch (e) {} }
  runMap = null; runLine = null; runDot = null;
}
function mountRunMap() {
  const el = $('#runmap');
  if (!el) return;
  if (!mapsReady() || !T.pts.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  destroyRunMap();
  runMap = L.map(el, { zoomControl: false });
  L.tileLayer(TILE_URL, { maxZoom: 20, attribution: TILE_ATTR }).addTo(runMap);
  runLine = L.polyline(T.pts.map(p => [p.lat, p.lon]), { color: '#D9FF3F', weight: 4, opacity: 0.95, lineJoin: 'round' }).addTo(runMap);
  const last = T.pts[T.pts.length - 1];
  runDot = L.circleMarker([last.lat, last.lon], { radius: 7, color: '#060708', weight: 3, fillColor: '#D9FF3F', fillOpacity: 1 }).addTo(runMap);
  if (T.pts.length > 1) runMap.fitBounds(runLine.getBounds(), { padding: [24, 24] });
  else runMap.setView([last.lat, last.lon], 16);
}
function updateRunMap() {
  if (!T.pts.length) return;
  if (!runMap) { mountRunMap(); return; }
  const last = T.pts[T.pts.length - 1];
  if (runLine) runLine.addLatLng([last.lat, last.lon]);
  if (runDot) runDot.setLatLng([last.lat, last.lon]);
  runMap.panTo([last.lat, last.lon], { animate: true, duration: 0.4 });
}
function mountStaticMap(elId, pts) {
  const el = document.getElementById(elId);
  if (!el) return false;
  if (!mapsReady() || !pts || pts.length < 2) { el.style.display = 'none'; return false; }
  const map = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false, touchZoom: false });
  L.tileLayer(TILE_URL, { maxZoom: 20, attribution: TILE_ATTR }).addTo(map);
  const line = L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#D9FF3F', weight: 4.5, opacity: 0.95, lineJoin: 'round' }).addTo(map);
  L.circleMarker([pts[0].lat, pts[0].lon], { radius: 6, color: '#060708', weight: 2.5, fillColor: '#F5F7F9', fillOpacity: 1 }).addTo(map);
  const e = pts[pts.length - 1];
  L.circleMarker([e.lat, e.lon], { radius: 6, color: '#060708', weight: 2.5, fillColor: '#D9FF3F', fillOpacity: 1 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [26, 26] });
  return true;
}

function tick() {
  if (!T.active) return;
  if (!T.paused) T.elapsed = Math.floor((Date.now() - T.startTs - T.pauseTotal) / 1000);
  updateRunUI();
}

function currentPace() {
  const cutoff = Date.now() - 30000;
  const recent = T.pts.filter(p => p.t >= cutoff);
  if (recent.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < recent.length; i++) d += haversine(recent[i - 1].lat, recent[i - 1].lon, recent[i].lat, recent[i].lon);
  const dt = (recent[recent.length - 1].t - recent[0].t) / 1000;
  if (dt < 5 || d < 5) return 0;
  return (dt / (d / Engine.MI)); // sec/mi
}

function renderRunActive() {
  $('#view').innerHTML = `
    <div class="page runactive">
      <div class="gpsrow"><i id="gpsdot" class="${T.gpsState}"></i><span id="gpslabel">${{ searching: 'Finding GPS…', ok: 'GPS locked', weak: 'GPS weak', denied: 'GPS blocked - check location permission' }[T.gpsState]}</span>${T.target ? `<span class="runtarget">${esc(T.target.title)}</span>` : ''}</div>
      <div class="rundist"><b id="rd">0.00</b><span>mi</span></div>
      <div id="runmap" class="runmap" style="display:none"></div>
      <div class="rungrid">
        <div><b id="rtime">0:00</b><span>time</span></div>
        <div><b id="ravg">-</b><span>avg pace</span></div>
        <div><b id="rcur">-</b><span>current</span></div>
      </div>
      <div class="splitlist" id="splitlist"></div>
      <div class="runcontrols">
        ${T.paused
          ? `<button class="rbtn resume" onclick="resumeRun()">Resume</button>`
          : `<button class="rbtn pause" onclick="pauseRun()">Pause</button>`}
        <button class="rbtn finish" onclick="finishRun()">Finish</button>
      </div>
    </div>`;
  mountRunMap();
}

function updateRunUI() {
  if (!T.active) return;
  const rd = $('#rd'); if (!rd) return;
  rd.textContent = T.distMi.toFixed(2);
  $('#rtime').textContent = Engine.fmtClock(T.elapsed);
  $('#ravg').textContent = T.distMi > 0.05 ? Engine.fmtPace(T.elapsed / T.distMi) : '-';
  const cp = currentPace();
  $('#rcur').textContent = cp > 0 ? Engine.fmtPace(cp) : '-';
  const dot = $('#gpsdot');
  if (dot) { dot.className = T.gpsState; $('#gpslabel').textContent = { searching: 'Finding GPS…', ok: 'GPS locked', weak: 'GPS weak', denied: 'GPS blocked' }[T.gpsState]; }
  $('#splitlist').innerHTML = T.splits.slice().reverse().map(s =>
    `<div class="splitrow"><span>Mile ${s.mi}</span><b>${Engine.fmtClock(s.sec)}</b></div>`).join('');
}

function pauseRun() { T.paused = true; T.pauseStart = Date.now(); renderRunActive(); }
function resumeRun() { T.paused = false; T.pauseTotal += Date.now() - T.pauseStart; renderRunActive(); }

function finishRun() {
  clearInterval(T.tickId);
  destroyRunMap();
  if (T.watchId != null) navigator.geolocation.clearWatch(T.watchId);
  T.active = false;
  if (T.distMi < 0.05 || T.elapsed < 30) {
    toast('Run too short to save');
    go('today');
    return;
  }
  const run = {
    id: 'r' + Date.now(),
    date: Engine.todayISO(),
    ts: T.startTs,
    distMi: Math.round(T.distMi * 100) / 100,
    durationSec: T.elapsed,
    avgPace: T.elapsed / T.distMi,
    splits: T.splits,
    pts: decimatePts(T.pts, 300),
  };
  renderRunSummary(run);
}

function decimatePts(pts, maxN) {
  if (pts.length <= maxN) return pts;
  const step = pts.length / maxN, out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[Math.floor(i)]);
  return out;
}

function renderRunSummary(run) {
  const paceStr = Engine.fmtPace(run.avgPace);
  // Compare with planned target if matched
  const sess = Engine.todaySession(S.plan);
  let verdict = '';
  if (sess && sess.status === 'pending') {
    const target = sess.distMi;
    const diff = run.distMi - target;
    if (sess.type === 'easy' && run.avgPace < Engine.paceZones(S.profile.vdot).easy.lo) verdict = 'Solid - but that was quicker than easy pace. Easy days keep you healthy.';
    else if (Math.abs(diff) <= target * 0.15) verdict = 'Nailed it. That is exactly the work the plan asked for.';
    else if (diff < 0) verdict = 'Short of the target - logged, and the plan takes it into account.';
    else verdict = 'More than the plan asked. Bank it - and keep tomorrow honest.';
  } else {
    verdict = 'Logged. Every mile counts.';
  }
  const hypo = { ...S, runs: S.runs.concat([run]), badgesPr: [...new Set([...(S.badgesPr || []), ...detectPRs(run)])] };
  const seenSet = new Set(S.badgesSeen || []);
  const freshBadges = Engine.unlockedBadges(hypo).filter(b => !seenSet.has(b));
  const unlockHtml = freshBadges.length
    ? `<div class="unlockline"><i></i><span>${freshBadges.map(b => { const x = Engine.BADGES.find(y => y.id === b); return '<b>' + esc(x.name) + '</b> · ' + esc(x.desc); }).join(' &nbsp;·&nbsp; ')}</span></div>`
    : '';
  $('#view').innerHTML = `
    <div class="page">
      <header><h2 class="ptitle">Run complete</h2></header>
      <div class="sumhero">
        <div class="rundist sm"><b>${run.distMi.toFixed(2)}</b><span>mi</span></div>
        <div class="rungrid">
          <div><b>${Engine.fmtClock(run.durationSec)}</b><span>time</span></div>
          <div><b>${paceStr}</b><span>avg pace</span></div>
          <div><b>${run.splits.length || '-'}</b><span>splits</span></div>
        </div>
      </div>
      <div id="summap" class="summap"></div>
      <canvas id="routecanvas" class="routecanvas" width="640" height="360" style="display:none"></canvas>
      ${run.splits.length ? `<div class="card"><h4>Splits</h4>${run.splits.map(s => `<div class="splitrow"><span>Mile ${s.mi}</span><b>${Engine.fmtClock(s.sec)}</b> <span class="dim">${Engine.fmtPace(s.sec)}/mi</span></div>`).join('')}</div>` : ''}
      <div class="coachcard"><div class="coachlabel">COACH</div><p>${esc(verdict)}</p></div>
      ${unlockHtml}
      <div class="btnrow">
        <button class="cta" onclick="saveRun('${run.id}')">Save run</button>
        <button class="ghost" onclick="discardRun()">Discard</button>
      </div>
    </div>`;
  window._pendingRun = run;
  if (!mountStaticMap('summap', run.pts)) {
    const cv = $('#routecanvas');
    if (cv) cv.style.display = '';
    drawRoute(run.pts);
  }
}

function drawRoute(pts) {
  const cv = $('#routecanvas');
  if (!cv || !pts || pts.length < 2) { if (cv) cv.style.display = 'none'; return; }
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 30;
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const spanLat = Math.max(maxLat - minLat, 0.0001), spanLon = Math.max(maxLon - minLon, 0.0001);
  const scale = Math.min((W - 2 * pad) / spanLon, (H - 2 * pad) / spanLat);
  const ox = (W - spanLon * scale) / 2, oy = (H - spanLat * scale) / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#D6FF3F';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(214,255,63,.45)';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = ox + (p.lon - minLon) * scale;
    const y = H - (oy + (p.lat - minLat) * scale);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  // start dot
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#F2F5F7';
  const sx = ox + (pts[0].lon - minLon) * scale, sy = H - (oy + (pts[0].lat - minLat) * scale);
  ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.fill();
}

function fiveKEffortSec(run) {
  if (run.distMi < 3.1 || run.distMi > 3.6) return null;
  return Math.round(run.durationSec * (3.10686 / run.distMi));
}
function buildPRs(runs) {
  const prs = {};
  for (const r of runs) {
    const bm = r.splits && r.splits.length ? Math.min(...r.splits.map(s => s.sec)) : null;
    if (bm && (!prs.mileSec || bm < prs.mileSec)) prs.mileSec = bm;
    if (!prs.longestMi || r.distMi > prs.longestMi) prs.longestMi = r.distMi;
    const fk = fiveKEffortSec(r);
    if (fk && (!prs.fiveKSec || fk < prs.fiveKSec)) prs.fiveKSec = fk;
  }
  return prs;
}
function detectPRs(run) {
  const news = [];
  if (!S.prs) return news; // baseline records set silently
  const z = Engine.paceZones(S.profile.vdot);
  const effort = run.avgPace <= z.marathon * 1.08; // intensity floor: no trophies for warmups
  const bm = run.splits && run.splits.length ? Math.min(...run.splits.map(s => s.sec)) : null;
  if (effort && bm && S.prs.mileSec && bm < S.prs.mileSec) news.push('fastmile');
  if (S.prs.longestMi && run.distMi > S.prs.longestMi) news.push('longday');
  const fk = fiveKEffortSec(run);
  if (effort && fk && S.prs.fiveKSec && fk < S.prs.fiveKSec) news.push('standard');
  return news;
}
function updatePRs(run) {
  S.prs = buildPRs(S.runs.concat([run]));
}
function saveRun(id) {
  const run = window._pendingRun;
  if (!run || run.id !== id) return;
  if (!S.prs && S.runs.length) S.prs = buildPRs(S.runs);
  const prNews = detectPRs(run);
  S.badgesPr = [...new Set([...(S.badgesPr || []), ...prNews])];
  S.runs.push(run);
  updatePRs(run);
  Engine.syncPlan(S.plan, S.runs);
  Engine.adaptPlan(S.plan);
  S.badgesSeen = Engine.unlockedBadges(S);
  save();
  window._pendingRun = null;
  toast('Run saved - plan updated');
  go('today');
}
function discardRun() { window._pendingRun = null; go('today'); }

/* ---- manual log ---- */

function openManual() {
  const today = Engine.todayISO();
  $('#sheet').innerHTML = `
    <div class="sheetcard">
      <h3>Log a run</h3>
      <label>Date<input type="date" id="m_date" value="${today}" max="${today}"></label>
      <label>Distance (mi)<input type="number" id="m_dist" step="0.01" min="0.1" placeholder="3.1" inputmode="decimal"></label>
      <label>Duration
        <div class="durrow">
          <input type="number" id="m_min" min="0" max="600" placeholder="min" inputmode="numeric">
          <input type="number" id="m_sec" min="0" max="59" placeholder="sec" inputmode="numeric">
        </div>
      </label>
      <div class="btnrow">
        <button class="cta" onclick="saveManual()">Save</button>
        <button class="ghost" onclick="closeSheet()">Cancel</button>
      </div>
    </div>`;
  $('#sheetwrap').classList.add('show');
}
function closeSheet() { $('#sheetwrap').classList.remove('show'); }

function saveManual() {
  const date = $('#m_date').value, dist = parseFloat($('#m_dist').value);
  const sec = (parseInt($('#m_min').value || '0', 10) * 60) + parseInt($('#m_sec').value || '0', 10);
  if (!date || !dist || !sec) { toast('Fill in date, distance and duration'); return; }
  S.runs.push({
    id: 'r' + Date.now(), date, ts: new Date(date + 'T12:00:00').getTime(),
    distMi: Math.round(dist * 100) / 100, durationSec: sec, avgPace: sec / dist, splits: [], pts: [], manual: true,
  });
  Engine.syncPlan(S.plan, S.runs);
  Engine.adaptPlan(S.plan);
  save();
  closeSheet();
  toast('Run saved - plan updated');
  render();
}

/* ============================ STATS ============================ */

function weekKey(iso) {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

function renderStats() {
  const runs = S.runs.slice().sort((a, b) => a.ts - b.ts);
  const totalMi = runs.reduce((a, r) => a + r.distMi, 0);
  const totalSec = runs.reduce((a, r) => a + r.durationSec, 0);

  // last 8 weeks bars
  const wkMap = {};
  for (const r of runs) {
    const k = weekKey(r.date);
    wkMap[k] = (wkMap[k] || 0) + r.distMi;
  }
  const weeks = [];
  let cursor = weekKey(Engine.todayISO());
  for (let i = 0; i < 8; i++) { weeks.unshift(cursor); cursor = Engine.addDays(cursor, -7); }
  const maxV = Math.max(1, ...weeks.map(k => wkMap[k] || 0));
  const bars = weeks.map(k => {
    const v = wkMap[k] || 0;
    const h = Math.round(v / maxV * 100);
    const cur = k === weekKey(Engine.todayISO());
    return `<div class="barcol"><div class="barwrap has-track"><div class="bar ${cur ? 'cur' : ''}" style="height:${Math.max(h, v > 0 ? 6 : 2)}%"></div></div><span>${shortDate(k)}</span><b>${v ? Engine.fmtMi(v) : ''}</b></div>`;
  }).join('');

  // PRs
  const longest = runs.reduce((m, r) => Math.max(m, r.distMi), 0);
  const quality = runs.filter(r => r.distMi >= 2);
  const fastest = quality.length ? Math.min(...quality.map(r => r.avgPace)) : 0;
  let bestMile = 0;
  for (const r of runs) for (const s of (r.splits || [])) if (!bestMile || s.sec < bestMile) bestMile = s.sec;
  const best5k = estBest(runs, 3.107);

  const recent = runs.slice(-6).reverse();

  $('#view').innerHTML = `
    <div class="page">
      <header><h2 class="ptitle">Stats</h2></header>
      <div class="statrow">
        <div class="stat"><b>${Engine.fmtMi(totalMi)}</b><span>total miles</span></div>
        <div class="stat"><b>${runs.length}</b><span>runs</span></div>
        <div class="stat"><b>${Engine.fmtClock(totalSec)}</b><span>time running</span></div>
      </div>
      <div class="card"><h4>Weekly volume</h4><div class="barchart">${bars}</div></div>
      <div class="card"><h4>Records</h4>
        <div class="prrow"><span>Longest run</span><b>${longest ? Engine.fmtMi(longest) + ' mi' : '—'}</b></div>
        <div class="prrow"><span>Fastest mile split</span><b>${bestMile ? Engine.fmtClock(bestMile) : '—'}</b></div>
        <div class="prrow"><span>Fastest average pace (2+ mi)</span><b>${fastest ? Engine.fmtPace(fastest) + '/mi' : '—'}</b></div>
        <div class="prrow"><span>Best 5K effort</span><b>${best5k ? Engine.fmtClock(best5k) : '—'}</b></div>
      </div>
      <div class="card"><h4>Recent runs</h4>
        ${recent.length ? recent.map(r => `
          <div class="runrow">
            <div><b>${Engine.fmtMi(r.distMi)} mi</b><span>${prettyDate(r.date)}${r.manual ? ' · manual' : ''}</span></div>
            <div class="rright"><b>${Engine.fmtClock(r.durationSec)}</b><span>${Engine.fmtPace(r.avgPace)}/mi</span></div>
          </div>`).join('') : '<p class="dim">No runs yet. Your first one is out there waiting.</p>'}
      </div>
    </div>`;
}

function estBest(runs, distMi) {
  // estimate best time over distMi from runs at least that long (prorate first distMi portion by avg pace)
  let best = 0;
  for (const r of runs) {
    if (r.distMi >= distMi) {
      const est = r.avgPace * distMi;
      if (!best || est < best) best = est;
    }
  }
  return Math.round(best);
}

/* ============================ YOU ============================ */

function renderYou() {
  const p = S.profile;
  const g = Engine.GOALS[p.goal];
  const z = Engine.paceZones(p.vdot);
  const pred = g.raceMi ? Engine.fmtClock(Engine.predictRaceTime(p.vdot, g.raceMi * Engine.MI)) : null;
  const xp = Engine.totalXP(S.runs);
  const lv = Engine.levelFromXP(xp);
  const unlocked = new Set(Engine.unlockedBadges(S));
  const bgrid = Engine.BADGES.map(b => `
    <div class="badge ${unlocked.has(b.id) ? 'on' : ''}">
      <div class="bring">${badgeGlyph(b.icon)}</div>
      <span>${esc(b.name)}</span>
      ${unlocked.has(b.id) ? '' : `<em>${esc(b.desc)}</em>`}
    </div>`).join('');
  $('#view').innerHTML = `
    <div class="page">
      <header><h2 class="ptitle">You</h2></header>
      <div class="levelcard">
        <div class="lvlvl">LVL ${lv.level}</div>
        <div class="lvinfo">
          <div class="lvbar"><i style="width:${Math.round(lv.into / lv.need * 100)}%"></i></div>
          <div class="lvtext">${lv.into} / ${lv.need} XP to level ${lv.level + 1}</div>
        </div>
      </div>
      <div class="card"><h4>Achievements</h4>
        <div class="badgegrid">${bgrid}</div>
      </div>
      <div class="card"><h4>Athlete</h4>
        <div class="prrow"><span>Goal</span><b>${g.label}${p.raceDateISO ? ' · ' + prettyDate(p.raceDateISO) : ''}</b></div>
        ${pred ? `<div class="prrow"><span>Predicted finish</span><b class="volt">${pred}</b></div>` : ''}
        <div class="prrow"><span>Schedule</span><b>${p.daysPerWeek} days / wk · long run ${Engine.DAY_NAMES[p.longDay]}</b></div>
      </div>
      <div class="card"><h4>Training paces</h4>
        <div class="prrow"><span>Easy</span><b>${Engine.fmtPaceRange(z.easy.lo, z.easy.hi)}/mi</b></div>
        <div class="prrow"><span>Marathon</span><b>${Engine.fmtPace(z.marathon)}/mi</b></div>
        <div class="prrow"><span>Threshold</span><b>${Engine.fmtPace(z.threshold)}/mi</b></div>
        <div class="prrow"><span>Interval</span><b>${Engine.fmtPace(z.interval)}/mi</b></div>
      </div>
      <div class="card"><h4>Fitness moved?</h4>
        <p class="hint">Ran a race or time trial? Update your fitness and every pending workout re-paces itself.</p>
        <div class="steppers">${stepperYou('upMin', 4, 20, 'min')}${stepperYou('upSec', 0, 59, 'sec')}<div class="unit">/ mile comfortable</div></div>
        <button class="ghost wide" onclick="updateFitness()">Re-pace my plan</button>
      </div>
      <div class="card"><h4>Data</h4>
        <button class="ghost wide" onclick="exportData()">Export my data (JSON)</button>
        <button class="ghost wide danger" onclick="resetAll()">Erase everything and start over</button>
      </div>
      <p class="foot">Cadence v1 · an orrimgames build · your data never leaves this device</p>
    </div>`;
}
const youState = { upMin: 10, upSec: 0 };
function stepperYou(key, min, max, unit) {
  return `<div class="stepper">
    <button onclick="youBump('${key}',-1,${min},${max})">−</button>
    <div><b id="st_${key}">${String(youState[key]).padStart(2, '0')}</b><span>${unit}</span></div>
    <button onclick="youBump('${key}',1,${min},${max})">+</button>
  </div>`;
}
function youBump(key, d, min, max) {
  youState[key] = Math.min(max, Math.max(min, youState[key] + d));
  $('#st_' + key).textContent = String(youState[key]).padStart(2, '0');
}
function updateFitness() {
  const vdot = Engine.vdotFromEasyPace(youState.upMin * 60 + youState.upSec);
  Engine.repacePending(S.plan, vdot);
  save();
  toast('Plan re-paced to your new fitness');
  renderYou();
}
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cadence-data.json';
  a.click();
}
function resetAll() {
  if (!confirm('Erase your plan and all runs? This cannot be undone.')) return;
  if (!confirm('Really sure? Every logged run disappears.')) return;
  Store.clear();
  S = null;
  location.reload();
}

/* ============================ BOOT ============================ */

document.querySelectorAll('.tabbar .tab').forEach(t => t.addEventListener('click', () => {
  const v = t.dataset.v;
  if (v === 'run') { go('run'); } else go(v);
}));

$('#sheetwrap').addEventListener('click', e => { if (e.target.id === 'sheetwrap') closeSheet(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => { reg.update(); }).catch(() => {});
  // a newly activated service worker means a fresh deploy: reload once to pick it up
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    location.reload();
  });
  // re-check for updates whenever the app comes back to the foreground
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) navigator.serviceWorker.getRegistration().then(r => { if (r) r.update(); });
  });
}

render();
