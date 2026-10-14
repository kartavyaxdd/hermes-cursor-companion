"""Keep the existing Hermes neo-local Whisper model warm. Audio remains in memory."""
import base64
import io
import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8", cpu_threads=2, download_root=sys.argv[2])
language = None if sys.argv[3] == "auto" else sys.argv[3]
# Initialize local voice-activity detection before the first recording arrives.
# This is synthetic silence, not a microphone or screen sample.
try:
    import numpy as np
    warm_segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), vad_filter=True)
    list(warm_segments)
except Exception:
    pass
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        audio = io.BytesIO(base64.b64decode(request["audio"].split(",", 1)[1], validate=True))
        segments, _ = model.transcribe(audio, language=language, vad_filter=True, condition_on_previous_text=False)
        transcript = " ".join(s.text.strip() for s in segments if s.text.strip() and s.no_speech_prob < .6 and s.avg_logprob >= -1.0)
        print(json.dumps({"id": request["id"], "ok": True, "transcript": transcript}), flush=True)
    except Exception as error:
        print(json.dumps({"id": request.get("id"), "ok": False, "error": str(error)}), flush=True)
