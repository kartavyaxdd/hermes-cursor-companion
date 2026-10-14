$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$stream = [System.IO.MemoryStream]::new()
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  if (@($speaker.GetInstalledVoices() | Where-Object { $_.Enabled }).Count -eq 0) {
    throw 'No enabled Windows speech voice is installed. Install a Windows voice or configure Hermes TTS.'
  }
  $speaker.SetOutputToWaveStream($stream)
  $speaker.Speak([string]$request.text)
  [Console]::Out.Write('data:audio/wav;base64,' + [Convert]::ToBase64String($stream.ToArray()))
} finally {
  $speaker.Dispose()
  $stream.Dispose()
}
