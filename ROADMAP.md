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
- Missed-run handling: absorb easy, swap quality onto an easy day, slide long run trimmed, two-miss streak asks one question
- Mileage progression: +8% after 3 perfect weeks, caps, every-4th-week cutback, streak resets
- "Why this workout" on every session card
- Coach notes rephrased in real voice by kimi-k3 (Nemotron leaks reasoning on rewrites)
- Shoe tracking with 300/400-mile wear alerts
- Supabase cloud sync (magic-link auth, RLS), data export/import
- Gamification with restraint: XP, levels, badges, streaks - no cartoon nonsense

## Next up

- HR watch question in onboarding (paces vs heart-rate guidance)
- Strength slot + evening stretch routine
- Weather/treadmill awareness
- Free-text coach chat (route to kimi-k3 unless Nemotron stops leaking reasoning)
- Proactive check-in after a missed run ("busy or tired?" as buttons, not just a note)

## Native port notes

- engine.js is the port: plan generation, adaptation, paces, parseFeel, progression. No DOM, no storage.
- Views (app.js) get rewritten in SwiftUI; engine logic carries over verbatim.
- The relay endpoint stays as-is - the iOS app calls the same Supabase function.
