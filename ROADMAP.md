# Cadence - Roadmap

An AI running coach that adapts to you. Mobile-first PWA today, native SwiftUI later.

## Principles

- Clean monochrome design. Polish over breadth.
- Feel-first pacing. Never guilt. Pain in one spot = brakes.
- engine.js is pure logic, DOM-free - it ports 1:1 to Swift.
- On-device by default. Cloud backup opt-in. No paywalled services.

## Shipped

- Conversational 12-step onboarding (chat style, name extraction by AI)
- Adaptive plan engine: periodized base/build/peak/taper, VDOT paces, race prediction
- Three-tier AI: deterministic parser -> on-device LFM2-1.2B (transformers.js, wasm/webgpu) -> Nemotron-120B via Supabase edge relay (API key server-side, never in the app)
- Feel check-in on Today: free text, adapts today's session (rest/downgrade/shorten/keep)
- Missed-run handling: absorb easy, swap quality onto an easy day, slide long run trimmed; two-miss streak asks one question - "Life busy / Body tired" tappable chips that change the week
- Mileage progression: +8% after 3 perfect weeks, caps, every-4th-week cutback, streak resets
- "Why this workout" on every session card
- Coach notes rephrased in real voice by kimi-k3 (Nemotron leaks reasoning on rewrites)
- Ask-your-coach free-text chat on Today (Nemotron via relay, plan context in the system prompt, reasoning stripped)
- HR-watch toggle: easy days get a heart-rate cue when you own a watch
- Strength + evening stretch card: short routines from the coaching opinions, per-day check-off
- Weather call: one-tap conditions (Open-Meteo), treadmill prescribed only at real extremes, "move inside" toggle
- Post-run verdict the coach stands behind: saved to the day's coach note, not just the summary screen
- Shoe tracking with 300/400-mile wear alerts
- Supabase cloud sync (magic-link auth, RLS), data export/import
- Gamification with restraint: XP, levels, badges, streaks - no cartoon nonsense

## Next up

- SwiftUI native port: engine.js carries over verbatim; views get rewritten
- Race-week mode: shakeouts, carb notes, race-morning checklist
- Trends view: weekly mileage and pace drift over months, not just weeks
- Audio cues on tracked runs: pace and split callouts with the screen off
- Route memory: compare today's loop against your own history on the same roads

## Native port notes

- engine.js is the port: plan generation, adaptation, paces, parseFeel, progression, weatherCall, runVerdict. No DOM, no storage.
- Views (app.js) get rewritten in SwiftUI; engine logic carries over verbatim.
- The relay endpoint stays as-is - the iOS app calls the same Supabase function.
