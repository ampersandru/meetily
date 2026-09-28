# Near-live captions Lab

## Current implementation

The native Labs setting persists outside WebView storage. `AudioPipeline` reads it
once when a recording begins and selects a 350 ms silence redemption and a
2,000 ms continuous-speech cap for each source VAD. `ContinuousVadProcessor`
cuts at the quietest nearby frame when the cap is reached, even if speech has
not paused. It retains the remainder as the start of the next chunk. The
existing transcription worker runs ASR and the selected diarizer on each
completed chunk, then emits its normal final `transcript-update` event. The
frontend joins nearby chunks from the same speaker for live display, including
when chunks from the other capture source arrive between them. It does not
rewrite saved transcript text, timestamps, or source provenance.

The setting is tuned for Parakeet but applies to the selected live ASR. It does
not make the entire Parakeet graph GPU resident. The current DirectML setting
accelerates its encoder only. The actual delay includes capture, the 2 s cap,
queued ASR, diarization lookup, and event/render time; 2 s is not an end-to-end
latency guarantee. A faster cap may increase word cuts and transcription errors.

Microphone and system audio have independent VAD and ASR paths, so their lines
can overlap in time. Two remote voices mixed into one system track cannot be
separately transcribed by diarization alone. A chunk receives one speaker label
from the selected engine; a speaker change inside a chunk is not split at word
level. Names still come from the existing rename/voice profile path.

## Qualification and next stages

1. Measure microphone and system audio ingest, VAD split, ASR completion,
   diarization completion, and UI update on a Windows GPU machine. Record p50
   and p95 delay, queue depth, and error rate for continuous and overlapping
   speech. No model/audio fixture has qualified these timings in this PR.
2. Add a bounded, replaceable provisional window only if the measured final
   chunk path is too slow. Keep provisional text out of persistence and replace
   it by stable source/time identity when final ASR arrives. Limit inference
   concurrency so capture never waits and old windows cannot accumulate.
3. Evaluate full Parakeet graph acceleration and a streaming-trained model
   against the same audio fixtures. Require word-boundary and duplicate-text
   checks before reducing the cap. Supporting two remote voices at once would
   additionally require source separation or speaker-attributed ASR.

Native timing selection has a pure unit test in `audio/near_live.rs`. Frontend
build and Windows packaging verify integration. Real model quality, GPU load,
latency, and same-track overlap require a local audio fixture or live test.
