# Dev Transcription

A VS Code extension for organizing videos and generating transcripts on your device. Like Dev Notes, it keeps collections in the sidebar, real files in private storage, and edits saved automatically.

## Install from GitHub

1. Download `dev-transcription-<version>.vsix` from [Releases](https://github.com/MauAlvarado43/dev-transcription/releases/latest).
2. In VS Code, open **Extensions → ⋯ → Install from VSIX…** and select the downloaded file.
3. Reload VS Code if prompted. Install a newer VSIX the same way to update.

You can also run `code --install-extension path/to/extension.vsix`. The universal package supports Windows, macOS, and Linux; its Python engine is installed on the device where you use the extension.

## Interface language

The interface defaults to **English**. Open **Settings → Engine and storage → Interface language** to choose English or Spanish, or set `devTranscription.interfaceLanguage` to `en` or `es`. Open views update without reloading or replacing your transcript edits.

VS Code command names, the sidebar view name, and native setting descriptions use VS Code's display language through `package.nls.json` and `package.nls.es.json`. These native labels follow VS Code's own language configuration.

The interface language is separate from `devTranscription.language`, which controls **speech recognition**. Changing the interface language does not translate transcripts, rename collections or speakers, or change recognition languages. Documentation, release notes, source identifiers, comments, and engine diagnostics are maintained in English. Spanish UI strings live in the translation catalogs.

## Usage

1. Open **Dev Transcription** in the activity bar.
2. Create a collection or choose **Import videos**. With no collections, a “General” collection is created automatically.
3. Open a video and choose **Transcribe video**. The engine installs in a private Python environment when needed. You can also prepare it under **Settings → Engine and storage**.
4. Read the transcript, select a timestamp to seek in the video, or choose **Edit** to correct the Markdown. Changes save automatically. `Ctrl+E` switches between reading and editing; `Ctrl+S` saves again (`Cmd` on macOS).
5. Export **Edited Markdown**, or export the original recognition as TXT, SRT, VTT, or JSON. Markdown corrections do not alter timestamps or the original recognition.

Each video's `⋯` menu supports transcription, cancellation, renaming, moving, and deletion to the trash. A collection's menu supports importing, transcribing pending videos, renaming, and deleting an empty collection. Search includes titles, collection names, transcript text, and speaker names.

Videos are **copied** into the library. Deleting a copy uses the trash and preserves the original. Large imports require enough space for a copy. Cancelling an import stops subsequent files after the current copy finishes.

## Local engine

The extension uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper) with **Whisper large-v3**, multilingual recognition, a beam size of five, and voice activity detection to filter silence. Quality takes priority over speed. Audio is transcribed without translation.

With the conversation language set to **Automatic**, recognition chooses only Spanish or English for each speech segment and supports both in the same conversation. The decoder stays fixed to the selected language instead of enabling detection of every language. If recognition still produces an unrelated script, the segment is marked as unrecognized. Context resets between short segments to reduce accidental translation into the dominant language; very brief language switches within a sentence can still fail.

- **NVIDIA:** automatic processing tries CUDA with FP16. On Linux, the installer prepares cuBLAS and cuDNN inside the private environment. If CUDA fails, the job retries on CPU with INT8.
- **CPU:** works without NVIDIA, including Apple and AMD hardware. `large-v3` can be slow; `turbo`, `medium`, `small`, `base`, and `tiny` reduce time and memory use.
- **Python:** when `uv` is available, the extension creates a Python 3.12 environment. Otherwise, it uses `python3` (`python` on Windows) with `venv` and `pip`. Set `devTranscription.pythonPath` to choose an executable. Python 3.12 is recommended for compatible binary packages.
- PyAV includes FFmpeg libraries; you do not need the FFmpeg executable.
- Windows CUDA requires compatible NVIDIA libraries on `PATH`. CPU processing works without them.

Initial installation and the first download of each model need internet access and several GB of storage. Only packages and model weights are downloaded; video and transcript content are not sent to a service. Models stay cached. Use **Settings → Download models** to prepare recognition and speaker models ahead of time, then enable `devTranscription.offline` to require local files.

Quality depends on the audio. Noise, music, overlapping voices, and proper names can produce errors. Speaker detection may merge similar voices or split one voice; overlapping voices are not separated into individual tracks. You can fix the conversation language and provide vocabulary in Settings.

## Dialogue reading

**Group dialogues** is enabled by default in Reading. It joins consecutive segments from the same speaker with pauses of up to 3 seconds and a maximum combined block duration of 60 seconds. Speaker changes always start a new block. Without speaker assignments, grouping uses timing only.

Use the Reading toggle to return to individual segments, or adjust the pause and duration limits in **Settings → Reading**. Each block displays its time range, assigned speaker, and combined text. Original segments, timestamps, and IDs remain available in Timing and JSON. Reading groups do not change edited Markdown or its exports.

## Speakers and recognition languages

Voice separation runs locally with [sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html), pyannote 3.0 segmentation, and WeSpeaker ResNet34-LM embeddings. The models download from public sherpa-onnx distributions and run on CPU; word recognition continues to use GPU when available. No account or token is required.

Each new segment has a stable `id`, a `speakerId`, and a `language` (`en`, `es`, etc.) in JSON. Speakers receive IDs such as `actor-001` and `actor-002`, scoped to that transcript. The extension does not identify the same person across videos. `actor-unknown` represents speech without a reliable assignment.

- Under **Speakers → Rename**, replace “Speaker 1” with a name. Utterances, search, and exports resolve the name without changing its ID.
- In **Timing**, change a segment's speaker selector to correct an assignment. **Add** creates a speaker without regenerating recognition.
- Under **Settings → Speakers**, set a known speaker count, adjust the automatic clustering threshold, or disable separation.
- Older transcripts still open. Add and assign speakers manually, or regenerate to detect them.

Internal Markdown preserves stable segment and speaker references; Reading and exports show current names. Freeform prose edits survive renaming and assignment changes. Removing a segment reference manually from Markdown leaves its structured association available in Timing and JSON.

Regeneration estimates speakers again and may change their IDs. The previous result, including names, is backed up in `transcript.previous.json` and `transcript.previous.md`. Existing user text and names are never translated automatically.

## Storage and recovery

The library belongs to your VS Code profile and stays available when switching projects. Use **Open library folder** to find it. On a standard Linux installation:

```text
~/.config/Code/User/globalStorage/raide.dev-transcription/
  library/
    collections/<uuid>.json
    videos/<uuid>/
      video.json                 # Title, collection, and metadata
      source.mp4                 # Video copy, retaining its original extension
      transcript.md              # Editable text with automatic saving
      transcript.json            # Original recognition and timestamps
      transcript.previous.md     # Text before the last regeneration
      transcript.previous.json   # Previous speakers and recognition
  runtime/                       # Isolated Python environment
  models/                        # Downloaded weights
```

Back up the **entire `library` folder** to preserve collections and videos. To restore on another device, close all VS Code windows and replace that installation's `library` folder with the backup. The Python environment is not portable: reinstall it with **Install or repair local engine**. Models can be downloaded again. There is no automatic cloud upload or synchronization.

Text writes use temporary files and atomic replacement. A failed or cancelled job preserves the existing transcript. Regeneration asks for confirmation and backs up the previous Markdown. Jobs display their current stage in the library, player, and status bar. Voice identification and transcription have independent percentages from 0 to 100; completed stages remain visible in the player as work advances.

Progress measures voice analysis blocks and processed speech audio, rather than estimated time remaining. Model loading, audio extraction, voice localization, and saving show activity without an invented percentage. Jobs run one at a time to limit memory use. Closing a tab does not cancel work. Closing or reloading VS Code stops jobs, which must be started again; the queue is not restored automatically.

## Playback and formats

Import MP4, MKV, MOV, WebM, AVI, M4V, MPEG, MPG, WMV, FLV, MTS, M2TS, and OGV. Integrated playback depends on VS Code's codecs. For unsupported playback, choose **Open in player** to open the copy in your system application. Transcription decodes audio independently of the integrated player. A video without an audio track produces an error; one without speech may produce an empty transcript.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `devTranscription.interfaceLanguage` | `en` | Interface language: English or Spanish. |
| `devTranscription.model` | `large-v3` | Recognition model. |
| `devTranscription.device` | `auto` | `auto`, `cpu`, or `cuda`. |
| `devTranscription.language` | `auto` | Spanish or English per segment; `es` / `en` fixes one language. |
| `devTranscription.groupDialogues` | `true` | Group Reading by voice and pauses. |
| `devTranscription.dialogueGapSeconds` | `3` | Maximum pause between segments in a block. |
| `devTranscription.dialogueMaxSeconds` | `60` | Maximum duration of a combined block. |
| `devTranscription.diarization` | `true` | Separate voices and assign IDs. |
| `devTranscription.numSpeakers` | `0` | Known speaker count; 0 estimates automatically. |
| `devTranscription.speakerThreshold` | `0.5` | Clustering threshold; lower values tend to split more voices. |
| `devTranscription.initialPrompt` | empty | Vocabulary and proper names. |
| `devTranscription.offline` | `false` | Require previously downloaded models. |
| `devTranscription.pythonPath` | empty | Python executable used to create the private environment. |

Open the **Settings** button or gear to adjust the interface, engine, recognition, and storage actions. **Dev Transcription: Show engine log** displays installation, audio, and CUDA diagnostics. **Install or repair local engine** reinstalls dependencies while preserving the library.

## Development

Requires Node.js 22 or later and Python, preferably 3.12, available as `python3` for tests. Tests use engine doubles: they do not install transcription dependencies, download models, or require a GPU.

```sh
npm ci
npm run check
npm run package
python3 scripts/verify-package.py
```

Install the generated `dist/dev-transcription-<version>.vsix` with `code --install-extension`. Open the project and press `F5` → **Run Dev Transcription** to launch a development host. `npm run watch` rebuilds as you edit.

TypeScript is split into domain rules, storage, processes, engine, queue, VS Code host, interface, and localization. `python/transcribe.py` is the local worker, communicating through JSON lines. The extension has no production npm dependencies. Its VSIX contains bundled code, the interface, translation catalogs, and the Python worker, without models or environments.

GitHub Actions validates and packages pull requests and pushes to `develop` and `main`. A push to `main` with a new version creates `v<version>` and a release containing the validated VSIX and the matching English changelog section. See [RELEASE.md](RELEASE.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md).

Previously saved recognition is not corrected automatically. Regenerate to apply Spanish/English restrictions; the previous names and text remain backed up.

## Third-party models

The extension code uses the MIT license. Downloaded weights retain their own licenses: [pyannote segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0) (MIT), [WeSpeaker VoxCeleb ResNet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM) (CC BY 4.0), and [Whisper large-v3](https://huggingface.co/openai/whisper-large-v3) (Apache 2.0). ONNX conversion and distribution are provided by [sherpa-onnx / k2-fsa](https://github.com/k2-fsa/sherpa-onnx). Weights are not included in the VSIX.
