# Contributing to Dev Transcription

## Set up the environment

1. Install Node.js 22 or later and Python, preferably 3.12, available as `python3` for tests.
2. Run `npm ci` and `npm run check`.
3. Press `F5` → **Run Dev Transcription** to open the development host, or use `npm run watch` to rebuild while editing.

Tests replace the engine dependencies and do not require a GPU, model downloads, or installing `python/requirements.txt`. For a real transcription, prepare the engine from the extension and use a test video without private data.

## Change guidelines

- Write documentation, release notes, identifiers, comments, and diagnostic messages in English.
- Maintain English source strings and the complete Spanish translation in `src/i18n.ts`. Keep placeholders identical across catalogs and use `t()` for interface text. Use `LocalizedError` for known validation failures.
- Use `package.nls.json` and `package.nls.es.json` for VS Code manifest contributions. Native labels follow VS Code's display language; the extension's views use `devTranscription.interfaceLanguage`.
- Keep interface language separate from `devTranscription.language`, which controls recognition. Never translate or rename saved user content when switching the interface language.
- Keep domain rules in `src/domain.ts` and `src/dialogues.ts`, without VS Code dependencies.
- Access the library through `LibraryStore`; preserve IDs, edits, backups, and atomic writes.
- Preserve the JSON-lines protocol between `src/engine.ts` and `python/transcribe.py`. Do not mix diagnostics with JSON events on standard output.
- Preserve local audio processing, cancellation, and offline behavior.
- Add tests when changing domain rules, persisted data, worker contracts, or localization behavior.
- Document user-visible changes under `## [Unreleased]` in `CHANGELOG.md`. Follow [RELEASE.md](RELEASE.md) when preparing a version.
- Update `.vscodeignore` and `scripts/verify-package.py` when adding runtime files.
- Do not commit personal videos, transcripts, downloaded models, virtual environments, or credentials.

## Pull requests

Include a change summary, validation, and screenshots for visual changes. Run `npm run package` and `python3 scripts/verify-package.py` before requesting review. Keep broad refactors separate from unrelated behavior changes.
