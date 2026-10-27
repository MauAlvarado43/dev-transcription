# Changelog

## [Unreleased]

## [0.4.0]

- Added English and Spanish interface catalogs, with English as the default.
- Added `devTranscription.interfaceLanguage`, separate from the conversation language used for speech recognition.
- Localized the library, editor, settings, dialogs, validation messages, progress, accessibility labels, and VS Code manifest contributions.
- Open views update when the interface language changes, preserving transcript edits and user-defined names.
- Standardized documentation, historical changelog entries, source messages, and engine diagnostics in English.
- Included and verified both manifest translation catalogs in the VSIX.

## [0.3.0]

- Prepared the repository for GitHub, pull request validation, and automatic releases with a VSIX and version-specific changelog notes on `main`.
- Restricted automatic recognition to Spanish and English per segment; unrelated scripts are marked as unrecognized.
- Added reading groups by speaker, pause, and maximum duration, with a toggle to return to original segments.
- Added reading settings. Grouping preserves edits, IDs, and timestamps.
- Added independent percentages for voice identification and transcription, with completed stage history in the player.
- Displayed stage and percentage in the library and status bar; reset progress when changing stages or retrying on CPU.

## [0.2.1]

- Fixed horizontal library overflow with long progress messages or names.
- Adjusted webview spacing and menus for narrow sidebars.

## [0.2.0]

- Added segment-based recognition for conversations switching between English and Spanish, with language stored per utterance.
- Added local voice separation with stable speaker and segment IDs.
- Added editable speaker names, manual speakers, and assignment correction in Timing.
- Included names and IDs in exports and search; backed up previous JSON before regeneration.
- Added Settings for engine status, setup, model downloads, and storage. Removed the library footer controls.

## [0.1.0]

- Added a local library organized into collections with video import, search, renaming, and moving.
- Added faster-whisper transcription with large-v3, NVIDIA GPU or CPU, a serial queue, and cancellation.
- Added a player, timestamped reading, and Markdown editing with automatic saving.
- Added Markdown, TXT, SRT, VTT, and JSON exports.
- Added a private engine environment, model downloads, and offline mode.
