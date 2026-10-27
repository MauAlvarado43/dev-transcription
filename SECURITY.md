# Security and local data

Dev Transcription stores video copies, transcripts, speaker names, and metadata in private VS Code extension storage. The extension does not add encryption; protection depends on the device and its file permissions. Backups and exports may also contain personal information.

Recognition and voice separation run locally. Engine setup and model downloads use the internet to fetch packages and weights; audio and transcript content are not uploaded. Offline mode requires previously downloaded models. Model licenses are listed in the [README](README.md#third-party-models).

The VSIX includes the Python worker and its requirements, without the environment, weights, or user library. Do not include videos, transcripts, personal paths, or sensitive logs in issues, pull requests, or screenshots.

## Reporting a vulnerability

Use **Security → Report a vulnerability** when private vulnerability reporting is enabled on the repository. If unavailable, ask the maintainer for a private channel without publishing exploit details or personal data. Include the extension and VS Code versions, operating system, minimal reproduction steps, and expected impact.
