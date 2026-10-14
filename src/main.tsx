import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentProposal, AppStatus, Marker } from '../electron/types';
import { runActionSequence } from '../electron/actionFlow';
import './styles.css';
import './clicky.css';

type ChatMessage = { role: 'user' | 'assistant' | 'error'; text: string; points?: number };
type IconName = 'mic' | 'send' | 'settings' | 'close' | 'sound' | 'pause' | 'history' | 'arrow' | 'back';

function humanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|Request stopped/i.test(message)) return 'Stopped.';
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
}

const initialStatus: AppStatus = {
  connection: 'offline', detail: 'Checking Hermes…', paused: false, proactive: false,
  recording: false, excludedApps: [], launchAtLogin: false, lastForeground: '',
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></>,
    send: <><path d="m12 19 0-14M6 11l6-6 6 6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3 1-1h4l1 3 3 1 2-1 2 4-2 2v3l2 2-2 4-3-1-3 2-1 2H9l-1-3-3-1-2 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z" transform="translate(1 -1) scale(.92)"/></>,
    close: <path d="M6 6 18 18M18 6 6 18"/>,
    sound: <><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M17 8a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    history: <><path d="M4 9a8 8 0 1 1 0 6M4 3v6h6M12 7v5l3 2"/></>,
    arrow: <><path d="M5 19 19 5M5 5h14v14"/></>,
    back: <><path d="m14 6-6 6 6 6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

// This surface only paints a reply. The native Windows dot follows the pointer;
// cursor events here are a reference for the next caption, never an animation.
function Overlay() {
  const latestCursor = useRef({ x: 0, y: 0, visible: false });
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [points, setPoints] = useState<Marker[]>([]);
  const [caption, setCaption] = useState('');
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const offCursor = window.companion.on('cursor:update', value => { latestCursor.current = value; });
    const offMarkers = window.companion.on('markers:update', value => {
      setAnchor(latestCursor.current);
      setPoints(value);
    });
    const showCaption = (value: unknown) => {
      setAnchor(latestCursor.current);
      setCaption(String(value));
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCaption(''), 9000);
    };
    const offNudge = window.companion.on('nudge:show', showCaption);
    const offBubble = window.companion.on('bubble:show', showCaption);
    window.companion.overlayReady();
    return () => { offCursor(); offMarkers(); offNudge(); offBubble(); if (timeout.current) clearTimeout(timeout.current); };
  }, []);
  return <div className="overlay-root">
    {points.length > 0 && <svg className="draw-layer" width="100%" height="100%" aria-hidden="true">
      <defs><marker id="arrow-tip" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="m1 1 6 3.5L1 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
      {points.map((point, index) => {
        const x = point.x * window.innerWidth, y = point.y * window.innerHeight;
        const side = x > window.innerWidth - 180 ? -1 : 1;
        const vertical = y < 95 ? 1 : -1;
        const startX = x + side * 90, startY = y + vertical * 64;
        return <path key={index} d={`M ${startX} ${startY} C ${x + side * 24} ${startY - vertical * 5}, ${x + side * 44} ${y + vertical * 10}, ${x + side * 5} ${y + vertical * 4}`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" markerEnd="url(#arrow-tip)"/>;
      })}
    </svg>}
    {points.map((point, index) => <div key={`${index}-${point.x}-${point.y}`} className="point-label" style={{ left: Math.max(8, Math.min(point.x * window.innerWidth + (point.x > .8 ? -164 : 54), window.innerWidth - 180)), top: Math.max(8, Math.min(point.y * window.innerHeight + (point.y * window.innerHeight < 95 ? 62 : -88), window.innerHeight - 40)) }}>
      {point.step && <span className="step-badge">{point.step}</span>}{point.label || `Here`}
    </div>)}
    {caption && <div className="screen-caption" style={{ left: Math.max(8, Math.min(anchor.x + 25, window.innerWidth - 284)), top: Math.max(8, Math.min(anchor.y + 25, window.innerHeight - 160)) }}>{caption}</div>}
  </div>;
}

function Chat() {
  const [status, setStatus] = useState<AppStatus>(initialStatus);
  const [stage, setStage] = useState('');
  const [draft, setDraft] = useState('');
  const taskGeneration = useRef(0);
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [excludedText, setExcludedText] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [audioError, setAudioError] = useState('');
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const startingRecording = useRef(false);
  const recordingWanted = useRef(false);
  const discardRecording = useRef(false);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void window.companion.getStatus().then(next => { setStatus(next); setExcludedText(next.excludedApps.join(', ')); });
    const offStatus = window.companion.on('status:update', next => {
      setStatus(next);
      if (next.paused) { taskGeneration.current++; discardRecording.current = true; recordingWanted.current = false; stopRecording(); playback.current?.pause(); setSpeaking(false); }
    });
    const offProgress = window.companion.on('chat:progress', value => { setStage(value.stage || ''); if (typeof value.text === 'string') setDraft(value.text); });
    const offSettings = window.companion.on('settings:open', () => setSettingsOpen(true));
    const offVoice = window.companion.on('voice:recording', (active, discard = false) => {
      if (discard) discardRecording.current = true;
      recordingWanted.current = active;
      if (active) { setSettingsOpen(false); void startRecording(); } else stopRecording();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.companion.hideChat();
    };
    document.addEventListener('keydown', closeOnEscape);
    input.current?.focus();
    return () => {
      offStatus(); offVoice(); offSettings(); offProgress(); document.removeEventListener('keydown', closeOnEscape);
      if (recordTimer.current) clearTimeout(recordTimer.current);
      stream.current?.getTracks().forEach(track => track.stop()); playback.current?.pause();
    };
  }, []);
  useEffect(() => {
    if (!shell.current) return;
    let lastHeight = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(shell.current!.getBoundingClientRect().height) + 16;
      if (height !== lastHeight) { lastHeight = height; window.companion.resizeSurface(height); }
    });
    observer.observe(shell.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'instant' }); }, [messages, waiting, transcriptOpen]);

  async function submit(value = text) {
    const prompt = value.trim();
    if (!prompt || waiting || status.paused || status.connection !== 'online') return;
    const generation = ++taskGeneration.current;
    setText(''); setWaiting(true); setTranscriptOpen(true); setAudioError(''); setDraft(''); setProposal(null);
    setMessages(previous => [...previous, { role: 'user', text: prompt }]);
    try {
      const reply = await window.companion.sendMessage(prompt);
      if (generation !== taskGeneration.current) return;
      setProposal(reply.proposal || null);
      setMessages(previous => [...previous, { role: 'assistant', text: reply.answer, points: reply.points.length }]);
      await runAutomatic(reply.proposal, generation);
    } catch (error) {
      setProposal(null);
      void window.companion.cancelAgent();
      setMessages(previous => [...previous, { role: 'error', text: humanError(error) }]);
    } finally { setWaiting(false); setDraft(''); setStage(''); input.current?.focus(); }
  }

  async function runAutomatic(initial: AgentProposal | undefined, generation: number) {
    if (!initial?.automatic || !initial.action) return;
    const final = await runActionSequence(initial, async id => {
      const next = await window.companion.executeAgent(id);
      if (generation === taskGeneration.current) {
        setProposal(next);
        setMessages(previous => [...previous, { role: 'assistant', text: next.explanation }]);
      }
      return next;
    }, () => generation === taskGeneration.current,
    (next, step) => { setProposal(next); setStage(`Running step ${step}…`); });
    if (generation === taskGeneration.current) setProposal(final);
    return final;
  }

  async function runStep() {
    if (!proposal?.action || waiting) return;
    setWaiting(true); setDraft('');
    try {
      const next = await window.companion.executeAgent(proposal.id);
      setProposal(next);
      setMessages(previous => [...previous, { role: 'assistant', text: next.explanation }]);
    } catch (error) {
      setProposal(null);
      setMessages(previous => [...previous, { role: 'error', text: humanError(error) }]);
    } finally { setWaiting(false); setDraft(''); setStage(''); }
  }

  function cancelAgent() {
    taskGeneration.current++;
    void window.companion.cancelAgent();
    setProposal(null); setDraft('');
  }

  async function startRecording() {
    if (startingRecording.current || mediaRecorder.current?.state === 'recording') return;
    startingRecording.current = true;
    discardRecording.current = false;
    setAudioError(''); playback.current?.pause(); setSpeaking(false);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!recordingWanted.current) { mic.getTracks().forEach(track => track.stop()); return; }
      stream.current = mic;
      const recorder = new MediaRecorder(mic, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        if (recordTimer.current) clearTimeout(recordTimer.current);
        mic.getTracks().forEach(track => track.stop()); stream.current = null;
        if (discardRecording.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (!blob.size) { setAudioError('No audio recorded. Check your microphone.'); return; }
        const generation = ++taskGeneration.current;
        setWaiting(true); setTranscriptOpen(true); setDraft(''); setProposal(null);
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          const { transcript, reply } = await window.companion.submitVoice(dataUrl);
          if (generation !== taskGeneration.current) return;
          setProposal(reply.proposal || null);
          setMessages(previous => [...previous, { role: 'user', text: transcript }, { role: 'assistant', text: reply.answer, points: reply.points.length }]);
          const completed = await runAutomatic(reply.proposal, generation);
          if (generation === taskGeneration.current) await playSpeech(completed?.explanation || reply.answer);
        } catch (error) {
          setProposal(null);
          void window.companion.cancelAgent();
          setMessages(previous => [...previous, { role: 'error', text: humanError(error) }]);
        } finally { setWaiting(false); setDraft(''); setStage(''); }
      };
      mediaRecorder.current = recorder; recorder.start();
      recordTimer.current = setTimeout(() => {
        if (mediaRecorder.current?.state === 'recording') void window.companion.toggleRecording();
      }, 60000);
    } catch (error) {
      setAudioError(`Microphone unavailable: ${error instanceof Error ? error.message : String(error)}`);
      if (recordingWanted.current) void window.companion.toggleRecording();
    } finally { startingRecording.current = false; }
  }

  function stopRecording() {
    if (recordTimer.current) clearTimeout(recordTimer.current);
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    mediaRecorder.current = null;
  }

  async function playSpeech(value: string) {
    try {
      playback.current?.pause();
      const audio = new Audio(await window.companion.speak(value));
      playback.current = audio;
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => { setSpeaking(false); setAudioError('Could not play the spoken reply.'); };
      await audio.play(); setSpeaking(true);
    } catch (error) {
      setSpeaking(false); setAudioError(`Speech unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function setup() {
    setSetupBusy(true);
    try { await window.companion.configureHermes(); }
    catch (error) { setAudioError(error instanceof Error ? error.message : String(error)); }
    finally { setSetupBusy(false); }
  }

  async function patchSettings(changes: Parameters<typeof window.companion.updateSettings>[0]) {
    try { setStatus(await window.companion.updateSettings(changes)); }
    catch (error) { setAudioError(error instanceof Error ? error.message : String(error)); }
  }

  const disabled = status.connection !== 'online' || status.paused || waiting;
  const activity = status.recording ? 'Listening…' : waiting ? stage || 'One moment…' : speaking ? 'Speaking…' : 'Ask me, or tell me what to do.';
  return <div className="surface-padding">
    <div ref={shell} className={`chat-shell${status.recording ? ' is-listening' : ''}`}>
      <header className="titlebar">
        <div className="brand"><span className="brand-dot"/><span>hermes</span></div>
        <div className="title-actions">
          {messages.length > 0 && !settingsOpen && <button className="icon-button" aria-label={transcriptOpen ? 'Collapse conversation' : 'Show conversation'} title="Conversation" aria-pressed={transcriptOpen} onClick={() => setTranscriptOpen(open => !open)}><Icon name="history" size={14}/></button>}
          <button className="icon-button" aria-label={settingsOpen ? 'Back' : 'Settings'} title={settingsOpen ? 'Back' : 'Settings'} onClick={() => setSettingsOpen(open => !open)}><Icon name={settingsOpen ? 'back' : 'settings'} size={14}/></button>
          <button className="icon-button" aria-label="Hide companion" title="Hide · Esc" onClick={() => window.companion.hideChat()}><Icon name="close" size={14}/></button>
        </div>
      </header>
      {settingsOpen ? <section className="settings-panel" aria-label="Settings">
        <label className="setting-row"><span>Pause screen access</span><input type="checkbox" checked={status.paused} onChange={event => void patchSettings({ paused: event.target.checked })}/></label>
        <label className="setting-row"><span>Start with Windows</span><input type="checkbox" checked={status.launchAtLogin} onChange={event => void patchSettings({ launchAtLogin: event.target.checked })}/></label>
        <label className="field-label" htmlFor="excluded">Excluded apps <small>Process names, separated by commas</small></label>
        <textarea id="excluded" className="excluded-input" value={excludedText} onChange={event => setExcludedText(event.target.value)} onBlur={() => void patchSettings({ excludedApps: excludedText.split(',') })}/>
        <p className="settings-note">Your screen is shared with Hermes when you ask. Hermes uses your configured AI provider.</p>
        <div className="shortcut-help"><span>Open / hide</span><kbd>Ctrl Shift Space</kbd><span>Talk / send</span><kbd>Ctrl Alt Space</kbd></div>
      </section> : <>
        <div className="voice-row">
          <button className={`voice-button${status.recording ? ' active' : ''}`} aria-label={status.recording ? 'Stop recording and send' : speaking ? 'Stop spoken reply' : 'Start recording'} title={status.recording ? 'Send recording' : speaking ? 'Stop speaking' : 'Talk · Ctrl+Alt+Space'} disabled={disabled && !status.recording && !speaking} onClick={() => {
            if (speaking) { playback.current?.pause(); setSpeaking(false); } else void window.companion.toggleRecording();
          }}>{status.recording || speaking ? <span className="voice-wave" aria-hidden="true"><i/><i/><i/><i/><i/></span> : <Icon name="mic" size={18}/>}</button>
          <div className="voice-copy"><span className="activity" aria-live="polite">{status.paused ? 'Paused' : activity}</span><span className="voice-hint">{status.recording ? 'Press again to send' : waiting ? 'Looking at your screen' : speaking ? 'Tap to stop playback' : <><kbd>Ctrl Alt Space</kbd> to talk</>}</span></div>
          {status.paused && <button className="text-button" onClick={() => void patchSettings({ paused: false })}>Resume</button>}
          {waiting && <button className="text-button" onClick={cancelAgent}>Stop</button>}
        </div>
        {status.connection !== 'online' && <div className="connection-note" role="status"><span>{status.detail}</span><button className="text-button" disabled={setupBusy || status.connection === 'setting-up'} onClick={() => void setup()}>{setupBusy ? 'Connecting…' : 'Reconnect'}</button></div>}
        {transcriptOpen && messages.length > 0 && <section className="conversation" aria-label="Conversation" aria-live="polite">
          {messages.map((message, index) => <div key={index} className={`message ${message.role}`}>
            <div className="message-text">{message.text}</div>
            {message.role === 'assistant' && <div className="message-footer">
              {Boolean(message.points) && <span>{message.points} screen mark{message.points === 1 ? '' : 's'}</span>}
              <button aria-label="Read this reply aloud" title="Read aloud" onClick={() => void playSpeech(message.text)}><Icon name="sound" size={13}/></button>
            </div>}
          </div>)}
          {waiting && draft && <div className="message assistant"><div className="message-text">{draft}</div></div>}
          <div ref={bottom}/>
        </section>}
        {proposal?.action && <section className="action-card" aria-label="Proposed action">
          <div className="action-title"><span>{proposal.action.kind === 'type' ? 'Type text' : proposal.action.kind === 'key' ? `Press ${proposal.action.key}` : 'Click the marked spot'}</span><span>{proposal.automatic && waiting ? 'Running task' : 'Review step'}</span></div>
          {proposal.action.kind === 'type' && <code>{proposal.action.text}</code>}
          <div className="action-buttons"><button className="run-step" onClick={() => void runStep()} disabled={waiting || status.paused}>Run step <Icon name="arrow" size={13}/></button><button className="text-button" onClick={cancelAgent}>Stop</button></div>
        </section>}
        {proposal?.done && <div className="done-note"><span>Done.</span><button className="text-button" onClick={cancelAgent}>Dismiss</button></div>}
        <form className="composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <textarea ref={input} aria-label="Message Hermes" value={text} placeholder="Ask anything, or tell me what to do…" rows={1} disabled={disabled || status.recording} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }}/>
          <button className="send-button" type="submit" aria-label="Send message" title="Send · Enter" disabled={!text.trim() || disabled || status.recording}><Icon name="send" size={16}/></button>
        </form>
      </>}
      {audioError && <div className="audio-error" role="alert"><span>{audioError}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setAudioError('')}><Icon name="close" size={12}/></button></div>}
    </div>
  </div>;
}

const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(params.get('view') === 'overlay' ? <Overlay/> : <Chat/>);
