'use strict';
/* Cadence coaching engine.
   Pure functions only - no DOM, no storage. This is the piece that ports
   1:1 to Swift when the app goes native. */
const Engine = (() => {

  const MI = 1609.34; // meters per mile
  const KM_PER_MI = 1.60934;
  let UNITS = 'mi'; // display-only: internal math always miles
  function setUnits(u) { UNITS = u === 'km' ? 'km' : 'mi'; }
  function unitSuffix() { return UNITS; }
  function distTxt(mi) { return fmtMi(mi) + ' ' + UNITS; }

  /* ---------- VDOT (Jack Daniels oxygen-cost model) ---------- */

  function vdotFromRace(distMeters, timeSec) {
    const t = timeSec / 60;          // minutes
    const v = distMeters / t;        // m/min
    const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
    return vo2 / pct;
  }

  // Treat a self-reported comfortable pace as ~72% of VO2max effort.
  function vdotFromEasyPace(secPerMi) {
    const v = MI / (secPerMi / 60);
    const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
    return vo2 / 0.72;
  }

  // Solve the oxygen-cost quadratic for the pace (sec/mi) at a fraction of VDOT.
  function paceSecPerMi(vdot, frac) {
    const target = vdot * frac;
    const a = 0.000104, b = 0.182258, c = -(target + 4.6);
    const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); // m/min
    return MI / v * 60;
  }

  function paceZones(vdot) {
    return {
      easy:      { lo: paceSecPerMi(vdot, 0.76), hi: paceSecPerMi(vdot, 0.66) }, // hi = slower
      marathon:  paceSecPerMi(vdot, 0.80),
      threshold: paceSecPerMi(vdot, 0.85),
      interval:  paceSecPerMi(vdot, 0.95),
      rep:       paceSecPerMi(vdot, 1.05),
    };
  }

  // Predict finish time (sec) for distMeters at a given VDOT, bisection on the VDOT curve.
  function predictRaceTime(vdot, distMeters) {
    let lo = distMeters / 6.5, hi = distMeters / 1.2; // sec, sane bounds
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (vdotFromRace(distMeters, mid) > vdot) lo = mid; else hi = mid;
    }
    return Math.round((lo + hi) / 2);
  }

  // Riegel projection between two performances.
  function riegel(timeSec, fromMeters, toMeters) {
    return timeSec * Math.pow(toMeters / fromMeters, 1.06);
  }

  /* ---------- Plan generation ---------- */


/* ---- Cadence's coaching voice: Daniel's opinions, verbatim in spirit ---- */
const VOICE = {
  opinions: [
    { id: 'mileage', q: 'Is mileage important?',
      a: 'Doing an activity more generally helps you do that activity better, and yes - this includes running. Running more builds your aerobic base, improves your mitochondria density and output, of course. But it has to be an amount you can sustainably do in a week, and a plan has to be flexible.' },
    { id: 'speedwork', q: 'Is speed work necessary?',
      a: 'It depends on the runner - some people naturally have more speed and less endurance, so your strengths and weaknesses get taken into account. And yes, speed work is very important, and so are form drills: together they build running economy, one of the three pillars of running performance. Running the same pace with less effort is, of course, very good.' },
    { id: 'walkbreaks', q: 'Walk breaks - failure or tool?',
      a: 'Walk breaks are great for beginners, for people who are really struggling, and early in a weight-loss journey where running sustained is hard. If you can already run, say, a 10-minute mile, prefer the sustained run. Very overweight or injured? Walking may be the right prescription - lose the weight without the impact on the body.' },
    { id: 'missedrun', q: 'Miss a run - guilt or shrug?',
      a: 'A good coach never guilts a runner. A missed day basically becomes a rest day, and the schedule adapts around you. But expect a check-in - were you busy, or just tired? That answer matters. No shaming, ever. Encouragement instead.' },
    { id: 'treadmill', q: 'Treadmill or outside?',
      a: 'Context matters: where you are and what the weather is doing. At real extremes - 100-degree heat, freezing cold, unsafe conditions - the treadmill is the smart call, and I will say so. Outside of that, nobody should be prescribing the treadmill.' },
    { id: 'streaks', q: 'Daily streaks - discipline or injury machine?',
      a: 'No daily run streaks, period. We are here to build a runner, not to build run streaks. Consistency is measured in weeks and months - never in a number that punishes you for resting.' },
    { id: 'feelfirst', q: 'Heart rate, pace, or feel?',
      a: 'Feel first. On easy runs I will never hand you a pace - run by feel. Have a heart-rate watch? Great, that is a bonus input, not a requirement. On workouts you get a pace proxy, but it depends on the surface - track is not concrete. The talk test is the real gauge: tempo is medium-hard, where you could hold a conversation but do not want to; VO2max work is where you cannot. And if you ever wonder why a workout exists, ask - every session builds a specific mechanism: aerobic base, running economy, or VO2max.' },
    { id: 'longrun', q: 'How sacred is the long run?',
      a: 'It depends on the race. For a mile race, not very. The longer the race - 10K, half marathon and up - the more it matters, and there it is essential. Every training cycle gets at least one. And the 7-day week is arbitrary, so I am not precious about it - what matters is the rhythm of stress and recovery, not the calendar.' },
    { id: 'pain', q: 'Running through pain - when is it fine, when is it stupid?',
      a: 'Differentiate the pain. General all-over soreness - take it easy, but fine to run. Muscular tightness that loosens as you warm in - OK. But pain in ONE single spot, a shin for example - hit the brakes. Stop, or at least do not run fast. Running through localized pain is really stupid.' },
    { id: 'twentymin', q: 'I only have 20 minutes - worth lacing up?',
      a: 'Usually no - 20 minutes is not a real training stimulus. Two exceptions: beginners, where everything counts, and a brief shakeout, which is fine. Otherwise it depends on the day\'s prescription - and I would rather move a key session than shrink it.' },
    { id: 'stretching', q: 'Stretching - before, after, or never?',
      a: 'Not before running - save the stretch-and-hold work for later. I am a big advocate of stretching after runs and at night: no bouncing, never overdo it, and loose hip flexors and hamstrings are the priority.' },
    { id: 'strength', q: 'Does strength training matter for runners?',
      a: 'Absolutely - strength training is great for running economy and injury prevention. Build it slowly and gradually, and do not change too many things at once. The run plan always leads, but strength is part of the program.' },
    { id: 'progression', q: 'How should mileage progress?',
      a: 'Hold a steady weekly mileage and tell me how you are feeling. Feeling great two, three weeks in a row? Then we bump it - small and smooth, like 50, 50, 55, 55. Never a staircase. And never stress the exact number - "about 55" is the attitude.' },
    { id: 'music', q: 'Music on runs?',
      a: 'No opinion, honestly - if you want music, great. I will never comment on it either way.' },
    { id: 'shoes', q: 'How much do shoes matter?',
      a: 'They matter. Rotate pairs when you can - but if one pair is what the budget allows, that is completely fine, and I will never make you feel bad about it. When shoes get beat up, at least try to get into new ones. And on race day, super shoes are of course a real advantage for running efficiency.' },
    { id: 'weekone', q: 'What should week 1 feel like for a beginner?',
      a: 'Sustainable and a little challenging - nothing crazy. And adaptive from day one: the plan fits your life, never the reverse.' },
    { id: 'ignoreplan', q: 'When should you ignore the plan?',
      a: 'Never - and that is the point. The plan is not fixed; I am adaptive, so you should never NEED to ignore it. If a plan needs ignoring, the plan failed. I adapt it instead.' },
    { id: 'hills', q: 'Hill work?',
      a: 'Big fan. Hills build strength and running efficiency - overall a great thing. Where your terrain allows, I will work them in.' },
    { id: 'context', q: 'What does Cadence pay attention to?',
      a: 'All of it: where you live, what the weather will be, how you are feeling, and what your week looks like. Coaching without context is just arithmetic.' },
    { id: 'checkin', q: 'Why does Cadence ask how you feel?',
      a: 'Because the daily check-in is the job. "How are you feeling today? How is the body?" - your answer steers the day. A coach who does not ask is just a spreadsheet.' },
  ],
};

  const GOALS = {
    fitness:  { label: 'Get fit',       raceMi: null,   baseVol: 8,  longCap: 8  },
    '5k':     { label: '5K',            raceMi: 3.107,  baseVol: 12, longCap: 7  },
    '10k':    { label: '10K',           raceMi: 6.214,  baseVol: 15, longCap: 10 },
    half:     { label: 'Half marathon', raceMi: 13.109, baseVol: 18, longCap: 13 },
    marathon: { label: 'Marathon',      raceMi: 26.219, baseVol: 24, longCap: 20 },
  };

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function addDays(dateISO, n) {
    const d = new Date(dateISO + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysBetween(aISO, bISO) {
    return Math.round((new Date(bISO + 'T12:00:00') - new Date(aISO + 'T12:00:00')) / 86400000);
  }

  function fmtPace(secPerMi) {
    if (UNITS === 'km') secPerMi = secPerMi / KM_PER_MI;
    if (!isFinite(secPerMi) || secPerMi <= 0) return '-';
    const m = Math.floor(secPerMi / 60), s = Math.round(secPerMi % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function fmtPaceRange(lo, hi) { return fmtPace(lo) + '-' + fmtPace(hi); }
  function fmtClock(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }
  function fmtMi(mi) {
    if (UNITS === 'km') mi = mi * KM_PER_MI;
    return (Math.round(mi * 10) / 10).toString().replace(/\.0$/, '');
  }

  // Interval menu per goal, cycled by week index. distMi includes 1 mi warm-up + 1 mi cool-down.
  function intervalSession(goal, phase, weekIdx, z) {
    const menus = {
      '5k':     [ {r: '6 x 400m', reps: 6, m: 400}, {r: '5 x 600m', reps: 5, m: 600}, {r: '4 x 800m', reps: 4, m: 800}, {r: '3 x 1000m', reps: 3, m: 1000} ],
      '10k':    [ {r: '5 x 1000m', reps: 5, m: 1000}, {r: '6 x 800m', reps: 6, m: 800}, {r: '4 x 1200m', reps: 4, m: 1200}, {r: '3 x 1600m', reps: 3, m: 1600} ],
      half:     [ {r: '5 x 1000m', reps: 5, m: 1000}, {r: '4 x 1600m', reps: 4, m: 1600}, {r: '6 x 800m', reps: 6, m: 800}, {r: '3 x 2000m', reps: 3, m: 2000} ],
      marathon: [ {r: '6 x 800m', reps: 6, m: 800}, {r: '5 x 1000m', reps: 5, m: 1000}, {r: '4 x 1600m', reps: 4, m: 1600}, {r: '8 x 400m', reps: 8, m: 400} ],
      fitness:  [ {r: '6 x 1 min pickups', reps: 6, m: 0}, {r: '8 x 30s strides', reps: 8, m: 0}, {r: '5 x 2 min steady', reps: 5, m: 0}, {r: '6 x 400m', reps: 6, m: 400} ],
    };
    const menu = menus[goal] || menus['5k'];
    const item = menu[weekIdx % menu.length];
    const fastMi = item.m ? (item.reps * item.m / MI) : item.reps * 0.09;
    const jogMi = item.m ? ((item.reps - 1) * 400 / MI) : item.reps * 0.09;
    const dist = 2 + fastMi + jogMi;
    const desc = item.m
      ? distTxt(1) + ' warm-up, then ' + item.r + ' at interval pace (' + fmtPace(z.interval) + '/' + UNITS + ') with 400m slow jogs, ' + distTxt(1) + ' cool-down.'
      : distTxt(1) + ' warm-up, then ' + item.r + ' around interval effort (' + fmtPace(z.interval) + '/' + UNITS + ') with easy recovery jogs, ' + distTxt(1) + ' cool-down.';
    return { title: item.r + ' intervals', distMi: Math.round(dist * 10) / 10, desc: desc, zone: 'interval' };
  }

  function tempoSession(goal, phase, weekIdx, z) {
    let min;
    if (goal === 'marathon' && phase === 'build') {
      const reps = 2 + (weekIdx % 2);
      return {
        title: reps + ' x ' + fmtMi(2) + ' ' + UNITS + ' at marathon pace',
        distMi: Math.min(8, 2 + reps * 2 + 1 + (reps - 1) * 0.5),
        desc: distTxt(1) + ' warm-up, ' + reps + ' x ' + distTxt(2) + ' at marathon pace (' + fmtPace(z.marathon) + '/' + UNITS + ') with half-mile easy between, ' + distTxt(1) + ' cool-down.',
        zone: 'marathon',
      };
    }
    if (goal === 'half' && phase === 'build') min = 22 + (weekIdx % 3) * 4;
    else if (phase === 'base') min = 15 + (weekIdx % 2) * 5;
    else min = 20 + (weekIdx % 3) * 5;
    const tempoMi = min * 60 / z.threshold; // minutes * 60 / secPerMi
    return {
      title: min + ' min tempo',
      distMi: Math.round((2 + tempoMi) * 10) / 10,
      desc: distTxt(1) + ' warm-up, ' + min + ' min at threshold pace (' + fmtPace(z.threshold) + '/' + UNITS + ') - comfortably hard, controlled - ' + distTxt(1) + ' cool-down.',
      zone: 'threshold',
    };
  }

  function easySession(distMi, z, weekIdx, slot) {
    const notes = [
      'Conversational the whole way. If you can not chat, slow down.',
      'Keep this genuinely easy - it builds the engine that race day draws on.',
      'Relaxed and smooth. Finish feeling like you could go again.',
      'Easy effort, tall posture, quick light feet.',
    ];
    return {
      title: 'Easy run',
      distMi: Math.round(distMi * 10) / 10,
      desc: distTxt(distMi) + ' at easy pace (' + fmtPaceRange(z.easy.lo, z.easy.hi) + '/' + UNITS + '). ' + notes[(weekIdx + slot) % notes.length],
      zone: 'easy',
    };
  }

  function longSession(distMi, goal, z, weekIdx) {
    const notes = {
      fitness:  'Long slow distance. The pace does not matter - the time on feet does.',
      '5k':     'Long run for strength. Stay easy; this supports everything else.',
      '10k':    'Long run, all conversational. Finish strong if you feel good.',
      half:     'Long run. Practice fueling after 45 min if this is over 8 miles.',
      marathon: 'Long run. Start slower than you think. Fuel every 40 min after the first hour.',
    };
    return {
      title: 'Long run',
      distMi: Math.round(distMi * 10) / 10,
      desc: distTxt(distMi) + ' at easy pace (' + fmtPaceRange(z.easy.lo, z.easy.hi) + '/' + UNITS + '). ' + notes[goal],
      zone: 'easy',
    };
  }

  const PHASES = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race: 'Race week' };

  // profile: {goal, raceDateISO|null, daysPerWeek, longDay(0-6 Sun..Sat), vdot, weeklyMiles|null}
  function generatePlan(profile) {
    const g = GOALS[profile.goal] || GOALS.fitness;
    const z = paceZones(profile.vdot);
    const start = todayISO();
    const isRace = g.raceMi != null && profile.raceDateISO;

    let nWeeks, raceWeekIdx = -1;
    if (isRace) {
      const d = daysBetween(start, profile.raceDateISO);
      raceWeekIdx = Math.max(0, Math.floor(d / 7));
      nWeeks = Math.min(20, raceWeekIdx + 1);
      raceWeekIdx = nWeeks - 1; // race lands in the final scheduled week
    } else {
      nWeeks = 12;
    }

    const EXP_FACTOR = { new: 0.85, returning: 0.95, seasoned: 1.08 };
    let volFactor = EXP_FACTOR[profile.experience] || 1;
    if (profile.injuryNotes && profile.injuryNotes.trim()) volFactor *= 0.9;
    const baseVol = Math.max(profile.weeklyMiles || 0, g.baseVol) * volFactor;
    const volCap = baseVol * 1.9;
    const baseLong = Math.min(Math.round(baseVol * 0.34 * 2) / 2, g.longCap);

    // Day offsets from the long-run day: quality +3, tempo +5, easies +1,+2,+4.
    const n = profile.daysPerWeek;
    const offsets = [{ off: 3, kind: 'quality' }];
    if (n >= 4) offsets.push({ off: 5, kind: 'tempo' });
    offsets.push({ off: 1, kind: 'easy' });
    if (n >= 5) offsets.push({ off: 2, kind: 'easy' });
    if (n >= 6) offsets.push({ off: 4, kind: 'easy' });
    offsets.push({ off: 0, kind: 'long' });

    const weeks = [];
    let vol = baseVol, longMi = baseLong;

    for (let w = 0; w < nWeeks; w++) {
      let phase;
      if (isRace) {
        if (w === raceWeekIdx) phase = 'race';
        else if (w === raceWeekIdx - 1) phase = 'taper';
        else if (w === raceWeekIdx - 2) phase = 'peak';
        else if (w < Math.floor((raceWeekIdx - 2) / 2)) phase = 'base';
        else phase = 'build';
      } else {
        phase = w < 4 ? 'base' : (w < 8 ? 'build' : 'peak');
      }

      // Weekly volume progresses recursively; the long run follows its own trajectory.
      if (w > 0) {
        if (phase === 'race') vol = vol * 0.5;
        else if (phase === 'taper') vol = vol * 0.7;
        else if (w % 4 === 3) vol = vol * 0.8;             // cutback
        else vol = Math.min(vol * 1.07, volCap);           // progression
      }
      const step = (profile.goal === 'half' || profile.goal === 'marathon') ? 1 : (profile.goal === '10k' ? 0.75 : 0.5);
      longMi = Math.min(baseLong + step * w, g.longCap);
      if (phase === 'taper') longMi = Math.max(3, longMi * 0.6);
      else if (w % 4 === 3 && w > 0) longMi = Math.max(3, longMi * 0.7); // cutback dip
      longMi = Math.round(longMi * 2) / 2;

      const sessions = [];
      const weekStart = addDays(start, w * 7);
      const wsDow = new Date(weekStart + 'T12:00:00').getDay();
      const delta = (profile.longDay - wsDow + 7) % 7;
      const longDate = addDays(weekStart, delta);

      for (const o of offsets) {
        const dateISO = addDays(longDate, o.off);
        if (dateISO < start && w === 0) continue; // do not schedule in the past
        const dow = (profile.longDay + o.off) % 7;

        if (phase === 'race') {
          if (dateISO > profile.raceDateISO) continue; // nothing after the race
          if (dateISO === profile.raceDateISO) continue; // race inserted below
        }

        if (o.kind === 'quality') {
          const s = phase === 'race' || phase === 'taper'
            ? { title: '4 x 400m sharp', distMi: 4, zone: 'interval',
                desc: distTxt(1) + ' warm-up, 4 x 400m at interval pace (' + fmtPace(z.interval) + '/' + UNITS + ') with 400m jogs, ' + distTxt(1) + ' cool-down. Short and sharp - touch speed, leave fresh.' }
            : intervalSession(profile.goal, phase, w, z);
          sessions.push({ date: dateISO, dow, type: 'interval', status: 'pending', ...s });
        } else if (o.kind === 'tempo') {
          const s = phase === 'race' || phase === 'taper'
            ? { title: '15 min steady', distMi: 3.5, zone: 'threshold',
                desc: distTxt(1) + ' warm-up, 15 min steady at threshold (' + fmtPace(z.threshold) + '/' + UNITS + '), ' + distTxt(1) + ' cool-down. Keep the rhythm, not the fatigue.' }
            : tempoSession(profile.goal, phase, w, z);
          sessions.push({ date: dateISO, dow, type: 'tempo', status: 'pending', ...s });
        } else if (o.kind === 'long') {
          if (phase === 'race') continue; // race replaces the long run
          sessions.push({ date: dateISO, dow, type: 'long', status: 'pending', ...longSession(longMi, profile.goal, z, w) });
        } else {
          sessions.push({ date: dateISO, dow, type: 'easy', status: 'pending', _easy: true, distMi: 0 });
        }
      }

      if (phase === 'race') {
        // Shakeout the day before if nothing is scheduled then.
        const shakeDate = addDays(profile.raceDateISO, -1);
        if (!sessions.some(s => s.date === shakeDate)) {
          sessions.push({
            date: shakeDate, dow: new Date(shakeDate + 'T12:00:00').getDay(),
            type: 'easy', title: 'Shakeout run', distMi: 2, zone: 'easy', status: 'pending',
            desc: distTxt(2) + ' very easy (' + fmtPaceRange(z.easy.lo, z.easy.hi) + '/' + UNITS + '). Just loosen the legs. Then lay out your kit and rest.',
          });
        }
        const rd = new Date(profile.raceDateISO + 'T12:00:00').getDay();
        sessions.push({
          date: profile.raceDateISO, dow: rd, type: 'race', title: g.label + ' race day',
          distMi: Math.round(g.raceMi * 100) / 100, zone: 'race', status: 'pending',
          desc: 'Race day. Predicted finish ' + fmtClock(predictRaceTime(profile.vdot, g.raceMi * MI)) + '. First mile conservative; nothing new on race day - same breakfast, same shoes.',
        });
      }

      // Distribute remaining volume across easy sessions.
      const easyIdx = sessions.map((s, i) => s._easy ? i : -1).filter(i => i >= 0);
      const nonEasy = sessions.reduce((a, s) => a + (s._easy ? 0 : s.distMi), 0);
      const perEasy = easyIdx.length ? Math.max(2, (vol - nonEasy) / easyIdx.length) : 0;
      easyIdx.forEach((si, k) => {
        const s = easySession(perEasy, z, w, k);
        sessions[si] = { date: sessions[si].date, dow: sessions[si].dow, type: 'easy', status: 'pending', ...s };
      });

      sessions.sort((a, b) => a.date < b.date ? -1 : 1);
      weeks.push({
        num: w + 1,
        phase,
        phaseLabel: PHASES[phase],
        targetMi: Math.round(sessions.reduce((a, s) => a + s.distMi, 0) * 10) / 10,
        sessions,
      });
    }

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      profile,
      goalLabel: g.label,
      weeks,
      adaptLog: [],
    };
  }

  /* ---------- Why this workout ---------- */
  const WHY = {
    easy: "Keep this truly easy - today's softness is what lets the hard days actually be hard.",
    tempo: 'This is where you learn to sit with sustained discomfort, finding the edge you can hold without tipping over.',
    interval: 'Short, sharp efforts raise your ceiling - they expand what your body believes is possible.',
    long: 'This builds the engine - time on feet grows the aerobic base everything else stands on.',
    rest: 'Adaptation happens here, not on the road. Let your body absorb the work you have done.',
    race: 'This is the day all the work was for. Trust the training, start controlled, finish proud.',
  };
  function whySession(type) { return WHY[type] || WHY.easy; }

  /* ---------- Adaptation ---------- */


  // Day-after response to freshly missed sessions: absorb easy, swap quality
  // into an easy today, slide a missed long run onto a rest day trimmed.
  // Two misses in a row -> ask the one question. Never guilt.
  function respondToMisses(plan, newlyMissed, today) {
    const yesterday = addDays(today, -1);
    const fresh = newlyMissed.filter(s => s.date === yesterday);
    if (!fresh.length) return;
    const all = plan.weeks.flatMap(w => w.sessions);
    const todaySess = all.find(x => x.date === today && x.status === 'pending');
    const dayBefore = all.find(x => x.date === addDays(today, -2));
    const streak = !!(dayBefore && dayBefore.status === 'missed');
    const wk = currentWeek(plan);
    let note = null;
    const s = fresh[0];
    if (streak) {
      note = 'Two missed days in a row. Life busy, or body tired? Tell me below - either answer is fine, it just changes what I do next.';
    } else if (s.type === 'easy') {
      note = "Yesterday's run didn't happen - that's fine. One missed run changes nothing. Today's plan stands.";
    } else if (s.type === 'long') {
      if (!todaySess) {
        wk.sessions.push({ id: s.id + '-slid', dow: new Date(today + 'T12:00:00').getDay(), date: today, type: 'long', status: 'pending',
          title: s.title + ' (slid a day)', distMi: Math.round((s.distMi || 6) * 0.85 * 2) / 2,
          desc: 'Slid from yesterday, trimmed a touch. Then straight back to the schedule.',
          adjusted: { from: 'Rest day', fromType: 'rest', action: 'slide', at: new Date().toISOString() } });
        wk.sessions.sort((a, b) => a.date < b.date ? -1 : 1);
        note = "Long run slides to today, trimmed a little. No catching up, no doubling - just today's run.";
      } else {
        note = "Missed the long run - we don't double up to catch up. The week absorbs it; the next long run stays as planned.";
      }
    } else {
      if (todaySess && todaySess.type === 'easy') {
        todaySess.type = s.type; todaySess.title = s.title; todaySess.distMi = s.distMi; todaySess.desc = s.desc;
        todaySess.adjusted = { from: 'Easy run', fromType: 'easy', action: 'swap', at: new Date().toISOString() };
        note = "Yesterday's quality session moves to today and the easy run disappears. Hard days never stack - this is the one move we make.";
      } else {
        note = "Yesterday's quality session is dropped, not made up. Stacking hard days is how runners break - the week stays honest.";
      }
    }
    if (note) plan.adaptLog.push({ week: wk.num, factor: 1, reason: note, at: new Date().toISOString() });
  }

  // Mark past pending sessions missed; match logged runs to planned sessions.
  function syncPlan(plan, runs) {
    const today = todayISO();
    const pending = [];
    const newlyMissed = [];
    for (const wk of plan.weeks) {
      for (const s of wk.sessions) {
        if (s.status === 'pending') {
          if (s.date < today) { s.status = 'missed'; newlyMissed.push(s); }
          else pending.push(s);
        }
      }
    }
    respondToMisses(plan, newlyMissed, today);
    // Match unmatched runs to pending sessions (same day first, then +-1 day, distance closest).
    for (const run of runs) {
      if (run.matchedSessionId) continue;
      let best = null, bestScore = Infinity;
      for (const wk of plan.weeks) {
        for (const s of wk.sessions) {
          if (s.status !== 'pending') continue;
          const dd = Math.abs(daysBetween(s.date, run.date));
          if (dd > 1) continue;
          const score = dd * 100 + Math.abs((s.distMi || 0) - run.distMi);
          if (score < bestScore) { bestScore = score; best = s; }
        }
      }
      if (best) {
        best.status = 'done';
        best.runId = run.id;
        run.matchedSessionId = best.date + '|' + best.type;
      }
    }
    return plan;
  }

  function weekCompliance(wk) {
    let done = 0, missed = 0;
    for (const s of wk.sessions) {
      if (s.status === 'done') done++;
      else if (s.status === 'missed') missed++;
    }
    if (done + missed === 0) return null; // week still open
    return { done, missed, ratio: done / (done + missed) };
  }

  // Adjust future weeks once per completed week. Returns array of notes (may be empty).
  function adaptPlan(plan) {
    const notes = [];
    const g = GOALS[plan.profile.goal] || GOALS.fitness;
    for (const wk of plan.weeks) {
      const c = weekCompliance(wk);
      if (c === null) continue;
      if (plan.adaptLog.some(a => a.week === wk.num)) continue;
      let factor = 1, reason = null;
      if (c.ratio <= 0.5 && c.missed >= 2) {
        factor = 0.93;
        reason = 'Week ' + wk.num + ' had ' + c.missed + ' missed runs - future volume eased 7% to keep the plan honest, not heroic.';
      } else if (c.ratio === 1 && c.done >= plan.profile.daysPerWeek - 0) {
        factor = 1.05;
        reason = 'Perfect week ' + wk.num + ' - volume nudged up 5%. You earned it.';
      }
      if (factor !== 1) {
        for (const fw of plan.weeks) {
          if (fw.num <= wk.num) continue;
          for (const s of fw.sessions) {
            if (s.status !== 'pending' || s.type === 'race') continue;
            let d = s.distMi * factor;
            if (s.type === 'long') d = Math.min(d, g.longCap);
            s.distMi = Math.round(d * 2) / 2;
          }
          fw.targetMi = Math.round(fw.sessions.reduce((a, s) => a + s.distMi, 0) * 10) / 10;
        }
        plan.adaptLog.push({ week: wk.num, factor, reason, at: new Date().toISOString() });
        notes.push(reason);
      } else {
        plan.adaptLog.push({ week: wk.num, factor: 1, reason: null, at: new Date().toISOString() });
      }
    }
    return notes;
  }

  // Re-pace all pending sessions after a fitness update (new VDOT).
  function repacePending(plan, newVdot) {
    plan.profile.vdot = newVdot;
    const z = paceZones(newVdot);
    for (const wk of plan.weeks) {
      for (const s of wk.sessions) {
        if (s.status !== 'pending') continue;
        // Rebuild the description for this session type with fresh paces.
        if (s.type === 'interval') Object.assign(s, intervalSession(plan.profile.goal, wk.phase, wk.num - 1, z));
        else if (s.type === 'tempo') Object.assign(s, tempoSession(plan.profile.goal, wk.phase, wk.num - 1, z));
        else if (s.type === 'easy') Object.assign(s, easySession(s.distMi, z, wk.num - 1, 0));
        else if (s.type === 'long') Object.assign(s, longSession(s.distMi, plan.profile.goal, z, wk.num - 1));
        else if (s.type === 'race') s.desc = 'Race day. Goal pace ' + fmtPace(z.marathon) + '/' + UNITS + '. Nothing new on race day.';
      }
    }
    return plan;
  }

  function nextSession(plan) {
    const today = todayISO();
    let best = null;
    for (const wk of plan.weeks) {
      for (const s of wk.sessions) {
        if (s.status === 'pending' && s.date >= today) {
          if (!best || s.date < best.date) best = s;
        }
      }
    }
    return best;
  }

  function todaySession(plan) {
    const today = todayISO();
    for (const wk of plan.weeks) {
      for (const s of wk.sessions) {
        if (s.date === today) return s;
      }
    }
    return null;
  }

  function currentWeek(plan) {
    const today = todayISO();
    for (const wk of plan.weeks) {
      const dates = wk.sessions.map(s => s.date).sort();
      if (!dates.length) continue;
      if (dates[0] <= today && addDays(dates[dates.length - 1], 1) >= today) return wk;
      if (dates[0] > today) return wk; // upcoming week
    }
    return plan.weeks[plan.weeks.length - 1];
  }


  /* ---- gamification: XP, levels, achievements (pure, DOM-free) ---- */
  function xpForRun(run) {
    return Math.round((run.distMi || 0) * 10);
  }
  function totalXP(runs) { return runs.reduce((s, r) => s + xpForRun(r), 0); }
  function levelFromXP(xp) {
    let lvl = 1, need = 150, acc = 0;
    while (xp >= acc + need) { acc += need; lvl++; need = 150 * lvl; }
    return { level: lvl, into: xp - acc, need };
  }
  function hadGapReturn(runs) {
    const ds = (runs || []).map(r => r.date).filter(Boolean).sort();
    for (let i = 1; i < ds.length; i++) {
      if (daysBetween(ds[i - 1], ds[i]) >= 7) return true;
    }
    return false;
  }
  function maxStreak(runs) {
    const days = [...new Set(runs.map(r => r.date))].sort();
    let best = 0, cur = 0, prev = null;
    for (const d of days) {
      cur = (prev && addDays(prev, 1) === d) ? cur + 1 : 1;
      if (cur > best) best = cur;
      prev = d;
    }
    return best;
  }
  function bestMileSec(runs) {
    let best = null;
    for (const r of runs) for (const sp of (r.splits || [])) {
      if (!best || sp.sec < best) best = sp.sec;
    }
    return best;
  }
  function weeklyMilesMax(runs) {
    const byWeek = {};
    for (const r of runs) {
      // ISO week key: monday of that week
      const d = new Date(r.date + 'T12:00:00');
      const mon = addDays(r.date, -((d.getDay() + 6) % 7));
      byWeek[mon] = (byWeek[mon] || 0) + (r.distMi || 0);
    }
    return Math.max(0, ...Object.values(byWeek));
  }
  function perfectWeekDone(plan) {
    return plan.weeks.some(wk => {
      const scored = wk.sessions.filter(s => s.status === 'done' || s.status === 'missed');
      return scored.length >= 3 && scored.every(s => s.status === 'done');
    });
  }
  const BADGES = [
    { id: 'first',    name: 'First Mile',     desc: 'Complete your first run',        icon: 'run',
      test: s => s.runs.length >= 1 },
    { id: 'fifty',    name: 'Fifty',          desc: '50 lifetime miles',              icon: 'ring',
      test: s => s.runs.reduce((a, r) => a + r.distMi, 0) >= 50 },
    { id: 'hundred',  name: 'Three Digits',   desc: '100 lifetime miles',             icon: 'ring',
      test: s => s.runs.reduce((a, r) => a + r.distMi, 0) >= 100 },
    { id: 'fivehun',  name: 'Five Hundred',   desc: '500 lifetime miles',             icon: 'ring',
      test: s => s.runs.reduce((a, r) => a + r.distMi, 0) >= 500 },
    { id: 'comeback', name: 'Back At It',     desc: 'Return after a week or more away',    icon: 'flame',
      test: s => hadGapReturn(s.runs) },
    { id: 'perfect',  name: 'Perfect Week',   desc: 'Complete every session in a plan week', icon: 'check',
      test: s => perfectWeekDone(s.plan) },
    { id: 'habit',    name: 'Monthly Habit',  desc: 'Run 20 days out of 30',          icon: 'chart',
      test: s => {
        const days = [...new Set(s.runs.map(r => r.date))].sort();
        for (let i = 0; i < days.length; i++) {
          let n = 0;
          for (const d of days) if (d >= days[i] && daysBetween(days[i], d) < 30) n++;
          if (n >= 20) return true;
        }
        return false;
      } },
    { id: 'light',    name: 'First Light',    desc: 'Finish a run before 6:30 AM',    icon: 'sun',
      test: s => s.runs.some(r => { const f = new Date(r.ts + (r.durationSec || 0) * 1000); return f.getHours() < 6 || (f.getHours() === 6 && f.getMinutes() < 30); }) },
    { id: 'night',    name: 'Night Shift',    desc: 'Finish a run after 9 PM',        icon: 'moon',
      test: s => s.runs.some(r => { const f = new Date(r.ts + (r.durationSec || 0) * 1000); return f.getHours() >= 21; }) },
    { id: 'trust',    name: 'Trust the Plan', desc: 'Complete 4 plan weeks in a row', icon: 'flag',
      test: s => {
        let streak = 0;
        const today = todayISO();
        for (const wk of s.plan.weeks) {
          const dates = wk.sessions.map(x => x.date).sort();
          if (!dates.length || dates[dates.length - 1] >= today) break; // only finished weeks
          const scored = wk.sessions.filter(x => x.status === 'done' || x.status === 'missed');
          const ok = scored.length >= 3 && scored.filter(x => x.status === 'done').length / scored.length >= 0.75;
          streak = ok ? streak + 1 : 0;
          if (streak >= 4) return true;
        }
        return false;
      } },
    { id: 'fastmile', name: 'Fastest Mile',   desc: 'Set a new mile PR',              icon: 'bolt',
      pr: 'mileSec' },
    { id: 'longday',  name: 'Longest Day',    desc: 'Set a new distance PR',          icon: 'mountain',
      pr: 'longestMi' },
    { id: 'standard', name: 'New Standard',   desc: 'Set a new 5K PR',                icon: 'flag',
      pr: 'fiveKSec' },
  ];
  function unlockedBadges(state) {
    const prSet = new Set(state.badgesPr || []);
    return BADGES.filter(b => {
      if (b.pr) return prSet.has(b.id);
      try { return b.test(state); } catch (e) { return false; }
    }).map(b => b.id);
  }


  /* ---------- Feel check-in: free text -> structured feel -> plan adjustment ----------
     Daniel's rules, from VOICE: feel first; never guilt; general soreness = easy is fine;
     pain in ONE spot = brakes; sick = rest; mileage bumps happen weekly, never on a hero day. */
  function parseFeel(raw) {
    const t = ' ' + String(raw || '').toLowerCase().replace(/[^a-z\s\-']/g, ' ') + ' ';
    const has = function() { for (let i = 0; i < arguments.length; i++) { if (t.includes(' ' + arguments[i]) || t.includes(' ' + arguments[i] + 's ') || t.includes(' ' + arguments[i] + 'd ') || t.includes(' ' + arguments[i] + 'ing ')) return true; } return false; };
    const spots = ['shin', 'knee', 'ankle', 'heel', 'calf', 'hamstring', 'quad', 'hip', 'achilles', 'back', 'foot', 'feet', 'toe', 'groin', 'plantar'];
    const painish = has('hurt', 'pain', 'sore', 'ache', 'twinge', 'sharp', 'tender', 'throbb', 'stabb', 'pull', 'strain', 'niggle', 'bugg', 'tight');
    let spot = null;
    for (const s of spots) { if (t.includes(' ' + s)) { spot = s; break; } }
    const f = {
      raw: String(raw || '').slice(0, 280),
      sick: has('sick', 'fever', 'flu', 'covid', 'nausea', 'migraine', 'headache', 'cold', 'stomach bug', 'food poison'),
      localizedPain: !!(spot && painish),
      spot,
      tired: has('tired', 'exhaust', 'drain', 'sleepy', 'fatigue', 'dead', 'beat', 'worn out', 'burnt', 'burnout', 'sluggish', 'no energy', 'low energy', 'didnt sleep', "didn't sleep", 'no sleep'),
      sore: false,
      stressed: has('stress', 'anxious', 'anxiety', 'overwhelm', 'swamp', 'crazy busy'),
      great: has('great', 'amazing', 'awesome', 'fantastic', 'strong', 'fresh', 'energiz', 'pumped', 'rested', 'ready', 'good', 'solid', 'prime'),
    };
    f.sore = !f.localizedPain && !f.sick && has('sore', 'stiff', 'tight', 'ache', 'achy', 'heavy legs', 'doms');
    f.anything = f.sick || f.localizedPain || f.tired || f.sore || f.stressed || f.great;
    return f;
  }

  /* Mutates today's pending session on the plan per the feel. Returns { action, note } or null. */
  function applyFeel(plan, feel, dateISO) {
    if (!plan || !plan.weeks) return null;
    const wk = currentWeek(plan);
    if (!wk) return null;
    const sess = wk.sessions.find(s => s.date === dateISO);
    const quality = sess && (sess.type === 'interval' || sess.type === 'tempo' || sess.type === 'long' || sess.type === 'race');
    let action = 'keep', note = null;

    if (feel.sick) {
      action = 'rest';
      note = "Rest today - you're sick. Health first, always. The plan absorbs this; there is no catching up to do.";
    } else if (feel.localizedPain) {
      action = 'rest';
      note = 'Pain in one spot (' + feel.spot + ') means brakes - today is off. Running through localized pain is how small problems become big ones. Tell me how it feels tomorrow.';
    } else if (feel.tired && quality) {
      action = 'downgrade';
      note = 'Quality day shelved - you get an easy one instead. Fitness is built by showing up, not by hero days on empty.';
    } else if (feel.tired) {
      action = 'shorten';
      note = 'Cut it short today. A tired easy run still counts - jog it gentle and stop early.';
    } else if (feel.sore && quality) {
      action = 'downgrade';
      note = 'All-over soreness is fine to move through, but not fast. Easy miles today; the quality session moves.';
    } else if (feel.sore) {
      action = 'keep';
      note = 'Sore is fine to run on - but keep today honestly easy. Walk breaks if you need them.';
    } else if (feel.stressed && quality) {
      action = 'downgrade';
      note = 'Stress is load too. Easy run today - move to clear the head, no paces to hit.';
    } else if (feel.great) {
      action = 'keep';
      note = 'Love hearing that. Plan stays as written - consistency beats hero days. Feeling great two, three weeks straight is when we bump things.';
    } else if (!sess) {
      action = 'note';
      note = 'Logged. Rest days are part of the plan - recovery is where the adaptation happens.';
    }

    if (sess && sess.status === 'pending' && (action === 'rest' || action === 'downgrade' || action === 'shorten')) {
      sess.adjusted = { from: sess.title, fromType: sess.type, action, feel: feel.raw, at: new Date().toISOString() };
      if (action === 'rest') {
        sess.type = 'easy'; sess._rest = true; sess.title = 'Rest - coach call'; sess.distMi = 0;
        sess.desc = feel.sick ? 'Sick day. Full rest.' : 'Localized pain (' + (feel.spot || 'one spot') + ') - full rest, no running through it.';
      } else if (action === 'downgrade') {
        sess.type = 'easy'; sess._easy = true;
        sess.title = 'Easy run (quality shelved)';
        sess.distMi = Math.max(1.5, Math.round((sess.distMi || 3) * 0.6 * 2) / 2);
        sess.desc = 'Swapped down by feel. Slow, conversational, walk breaks welcome.';
      } else if (action === 'shorten') {
        sess.title = sess.title + ' (shortened)';
        sess.distMi = Math.max(1, Math.round((sess.distMi || 2) * 0.7 * 2) / 2);
        sess.desc = (sess.desc || '') + ' Shortened by feel - stop here.';
      }
    }
    if (note) plan.adaptLog.push({ week: wk.num, factor: 1, reason: note, at: new Date().toISOString(), feel: feel.raw.slice(0, 120) });
    return note ? { action, note, session: sess || null } : null;
  }

  return {
    GOALS, DAY_NAMES, PHASES, MI, VOICE, parseFeel, applyFeel, whySession,
    xpForRun, totalXP, levelFromXP, maxStreak, bestMileSec, weeklyMilesMax, BADGES, unlockedBadges,
    vdotFromRace, vdotFromEasyPace, paceSecPerMi, paceZones, predictRaceTime, riegel,
    generatePlan, syncPlan, adaptPlan, repacePending, weekCompliance,
    setUnits, unitSuffix, distTxt,
    nextSession, todaySession, currentWeek,
    fmtPace, fmtPaceRange, fmtClock, fmtMi, addDays, todayISO, daysBetween,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
