// Live backend smoke test. Does not print credentials or audio data.
const { checkHermes, closeDashboard, speakText, transcribeAudio } = require('../dist-electron/hermes.js');
const { closeDesktopHelper } = require('../dist-electron/desktop.js');
const { closeLocalStt } = require('../dist-electron/localStt.js');

(async () => {
  const connection = await checkHermes();
  console.log(`Hermes guidance API: ${connection.ok ? 'ready' : 'unavailable'} (${connection.detail})`);
  const audio = await speakText('Hello Hermes. This is a speech test.');
  if (!audio.startsWith('data:audio/')) throw new Error('Speech output was not an audio data URL.');
  console.log(`Speech playback payload: ${audio.slice(5, audio.indexOf(';'))}, ${Math.floor(audio.length * 0.75)} approximate bytes`);
  const transcript = await transcribeAudio(audio);
  if (!transcript) throw new Error('Live transcription returned empty speech for synthesized voice.');
  console.log(`Live transcription: ${transcript}`);
})().catch(error => { console.error(`Live voice smoke test failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => { closeDashboard(); closeDesktopHelper(); closeLocalStt(); });
