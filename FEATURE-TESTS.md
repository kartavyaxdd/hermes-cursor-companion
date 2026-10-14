# Feature checks — version 0.3.0

Tests on this Windows PC use the existing Hermes profile and disposable scratch windows. Screenshots were held in memory. Test clicks and typing were confined to the scratch windows. Temporary app exclusions and pause settings were restored.

| Feature | Result | Evidence |
|---|---|---|
| One conversation for questions and actions | Passed | Talk/Agent tabs removed; question and action responses share one result schema and Hermes session. Unified action cards appear in the same panel. |
| Screen capture and understanding | Passed | Live monitor capture; Hermes correctly read “The purple robot found 37 marbles.” |
| Pointing | Passed | Model's normalized point fell inside the actual Harmless click button. |
| Conversation memory | Passed | Same session recalled the test project name Mango. |
| Click | Passed | Model proposed a click; native helper incremented only the disposable button's counter. |
| Type | Passed | Exact requested text appeared in the disposable text field. |
| Packaged app: request → approve → execute → verify | Passed | Entered a typing request in the single conversation, pressed Run step, verified the exact “Unified cursor test.” text in the disposable field, and saw the completion reply and Done state. |
| Enter key | Passed | Disposable field recorded an Enter key event. |
| Action validation and cancellation | Passed | Unknown IDs, expired proposals, paused/locked states, changed windows, and unsupported actions rejected in 14 automated checks. |
| Voice recording shortcut | Passed | Ctrl+Alt+Space entered Listening and disabled text input. Microphone access and recording were confirmed. |
| Local transcription | Passed | Synthesized phrase transcribed correctly through the existing local Whisper model. Actual user speech accuracy was not separately scored. |
| Spoken playback and interruption | Passed | Reply button entered Speaking; stop control returned to idle. |
| Pause | Passed | Text/recording controls disabled; pausing a recording discarded it without submitting or showing an error after the race fix. |
| App exclusions | Passed | Excluding the actual underlying app returned “Screen capture is unavailable for this app” before inference. Original exclusions restored. |
| Open/hide shortcut | Passed | Ctrl+Shift+Space hid and reopened the packaged companion. |
| Offline state and recovery | Passed | Companion displayed an offline state when the loopback API was unavailable, then resumed after the existing Hermes Gateway service became available. |
| Native dot | Passed in previous native checks | Click-through/no-activation window styles, capture exclusion, show/hide commands and parent-lifetime exit verified. Native follower unchanged in this release. |
| Display scaling | Tested at current 125% scaling | Action coordinates reached the correct disposable controls. Negative monitor origins and boundary cases pass automated fixtures. |
| Multiple monitors / mixed scaling | Not physically tested | This PC currently exposes one monitor. |
| Start after sign-in | Configuration retained | Enabled preference retained and packaged executable registered. No sign-out/reboot performed. |
| Actual Windows lock/unlock | Not physically tested | Lock guards and cancellation are covered by automated checks; desktop was not locked during testing. |

## Timings

- Warm desktop inspection: **52 ms average** across five requests.
- Speech generation with an already running helper: **664 ms** in the live fixture.
- Fresh-helper speech generation: **1.87 seconds** in a separate cold-worker check.
- Warm local transcription of the test phrase: **5.6–6.9 seconds** on this CPU.
- Screen-answer stream: first text **5.96 seconds**, completed model response **6.68 seconds**, excluding capture.

These are individual PC samples, not guarantees. Persistent helpers remove repeated startup/compilation; streaming improves visibility of progress. Provider latency and local speech decoding are still the largest waits. No claim of instantaneous voice conversation or a measured cursor frame latency is made.

Run automated checks with `node --test tests/agent-guard.cjs tests/voice-startup.cjs tests/capture.cjs tests/companion.cjs`. Live fixtures are in `tests/live-features.cjs` and `tests/panel-fixture.cjs` and require the local Hermes API.

## Version 0.3.1 regression fix

- Drawing delivery now waits for the overlay renderer to register its listeners. The previous load event could arrive before React was ready and lose the initial markers.
- Real hidden Electron renderer test confirms a visible gold SVG arrow, label and caption. Duplicate readiness is ignored; canceled overlays stay hidden. Evidence: ANNOTATION-TEST-RESULT.json.
- A fresh live Hermes click proposal executed successfully against the disposable button on this PC.
- All 14 existing guard, capture, voice-startup and unified-response tests passed; TypeScript checks and production build passed.
- Post-action model drawing points are preserved. The conversation reappears during result verification so progress and Stop remain accessible.
- Drawing currently means arrows and labels at requested UI locations. Arbitrary freehand sketches and shapes are not implemented.

## Version 0.4.0

- Real overlay renderer painted two numbered arrows, labels and caption.
- Live Hermes routed a how-to request to two ordered guidance points without an executable action.
- Live automatic task used a fresh screen to discover the second button after the first click, then executed both.
- Actual chat form and main controller automatically completed both clicks and displayed Done; no Run step clicks required. Evidence: AUTO-APP-TEST-RESULT.json and ROUTING-TEST-RESULT.json.
- 18 automated tests passed, including cancellation between actions, the eight-action limit, guidance/action separation and six-point bounds.
- Previous feature checks above remain historical results; this update did not repeat physical multi-monitor, lock/unlock or sign-in testing.
