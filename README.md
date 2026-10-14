# Hermes Cursor Companion

A Windows cursor companion for Hermes Agent. A small translucent dot follows the cursor. One conversation answers questions, draws screen guidance, and automatically runs a bounded sequence of clicks, text entries, or key presses when you directly ask it to perform a task. The app has no subscription or message limits. Your existing Hermes model provider may have its own fees or usage limits. This is an independent implementation using Clicky as an interaction reference.

## Launch

- Installer: run `release\Hermes Cursor Companion Setup 0.4.0.exe`. The build is unsigned.
- Portable build: run `release\win-unpacked\Hermes Cursor Companion.exe` from the complete `win-unpacked` folder. Keep its `resources` folder beside the executable.
- From source: `npm install`, then `npm start`.
- `Ctrl+Shift+Space` opens or hides the compact talk capsule. `Ctrl+Alt+Space` starts or stops a voice recording. The tray icon offers Open, Pause, Settings, and Quit.

Only one instance runs per Windows profile. Quit the existing companion from its tray menu before launching a new build. The portable build and an older running source build must not be used together.

## Hermes prerequisite

The app reads the active `HERMES_HOME` profile, or `%LOCALAPPDATA%\hermes` if unset. It does not edit that profile or restart the shared gateway. Configure and start Hermes outside this app with `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, `API_SERVER_PORT=8642`, `API_SERVER_KEY` available in the active profile's `.env` (or the app process environment), and `platform_toolsets.api_server: []` in `config.yaml`. The API must report no enabled toolsets. Use the **Set up local connection** button to check this prerequisite after it is running. Do not put the key in the renderer, project, installer, or screenshots.

For the existing `neo-local` Hermes provider, transcription keeps the same local Whisper model loaded in a private worker; recordings remain in memory. Other configured speech providers use a private Hermes dashboard on an available loopback port with a generated session token. Spoken playback uses the installed Windows voice immediately, with Hermes TTS as fallback. Recording stops after 60 seconds; transcription times out after 120 seconds. Pausing discards a recording. No paid speech service is added by this project.

## Conversation and privacy

- Ask a question such as **Where should I click?** to get an explanation and temporary screen marks. Replies stream into the conversation as they arrive.
- Give a direct instruction such as **Type Hello into this field and press Enter** to start an automatic task in the same conversation. Ambiguous instructions may show a manual **Run step** instead. **Stop** cancels a request or proposal. Proposals expire after 30 seconds. The app checks the target window and focus before sending input. Automatic input requires both an explicit task request and a validated action response. Questions and actions share one Hermes session and its memory.
- **Screen access:** on demand, when you ask or while executing a requested task. Version 0.2 removes background screenshot polling, including when an older profile had proactive hints enabled. **Pause screen awareness** stops captures, hides the dot and drawings, and clears pending actions. Locking Windows does the same until unlock.

The window under the cursor and the proposed action target are checked against the excluded process list and sensitive window titles. This is a window-level boundary, not redaction: other windows visible on the same monitor can appear in a capture. Move private windows off that monitor or pause before asking. Captures are kept in memory and sent to the local Hermes API; Hermes may forward them to the model provider configured in your profile. Agent actions use normal Windows input, so inspect each step and keep sensitive apps excluded.

## Troubleshooting and limits

- **Offline:** check the active profile, API key, loopback server and empty API toolsets. The button only checks; it does not change Hermes configuration.
- **No voice:** check microphone access, the Hermes speech provider and the private dashboard port. If Hermes TTS is unavailable, install a Windows speech voice for fallback playback.
- **Action rejected:** the target window changed, is excluded, disappeared, or the proposal expired. Ask for a fresh step.
- **Installer:** `npm run pack:win` requires electron-builder downloads. The release was built using the installed Electron distribution with code signing disabled.
- Windows display scaling is converted from Electron display coordinates to screen pixels. Mixed-DPI and multiple-monitor input should be verified on the target machine before relying on Agent mode.

## Responsiveness and verification

The follower is a 10-pixel translucent dot drawn once in a 24×24 native Windows layered window. Native cursor tracking bypasses Electron, React, renderer frames and per-movement IPC. It never moves or hooks the real mouse, never activates, and passes clicks through. The helper's timer stops while paused. The desktop drawing window exists only while annotations are shown, then is destroyed. No screenshots or foreground-app polling run in the background. The compact talk surface expands only for content and settings.

The native helper builds with Windows' installed .NET Framework C# compiler (`npm run build:native`). It is bundled as `resources/cursor-dot.exe`, exits with its parent, and is excluded from screen capture. Source lives in `windows/cursor-dot.cs`. The desktop input helper now stays running instead of starting PowerShell and compiling C# for every check. Voice uses a warm local model and avoids the previous 20-second remote TTS wait. Model requests use low reasoning effort; model/provider latency still applies.

Verified on this PC: TypeScript and production builds, Hermes screenshot answering and point coordinates, synthesized speech transcribed through the local Hermes provider, approved action guards, coordinate boundaries, and desktop click/type/key behavior in a disposable window. The final package excludes both companion windows from screen capture. The application cancels its in-flight model request when paused or Windows locks; a model provider may already have received the request.

Detailed verification and measured timings are in `FEATURE-TESTS.md` and `FEATURE-TEST-RESULTS.json`. This release uses recorded voice turns, numbered screen guidance and bounded automatic desktop tasks. It does not yet match Clicky's continuous real-time voice conversation or its full integrations. Physical mixed-DPI multi-monitor behavior and actual launch after sign-in remain to be checked.


## Automatic guidance and tasks (0.4.0)

- Ask “How do I use these controls?” for up to six numbered arrows in the order to follow. Arrows point only at controls visible now and stay for 30 seconds. Later hidden controls are explained in text.
- Say “Click First step, then click Second step” or “Fill this field with Hello and press Enter” to run the task automatically. Each next action is planned from a fresh screenshot. Stop and tray Pause remain available. Tasks stop after eight actions.
- Ordinary questions receive a text answer; the model adds arrows when they help. Ambiguous requests may ask for clarification or offer a manual Run step. Drawing and explanation requests never authorize automatic input.
- This remains limited to click, type, and the supported individual keys. Screenshots remain in memory.
