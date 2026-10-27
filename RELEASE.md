# Publishing a release

Dev Transcription follows the other Dev extensions: GitHub Actions validates changes and publishes each new version that reaches `main`.

## Release checklist

1. Work in a `feature/<topic>` branch. You can integrate into `develop` before opening a release pull request to `main`.
2. Document user-visible changes in English under `## [Unreleased]` in `CHANGELOG.md`.
3. Increment the version and update the lockfile without creating a tag:

   ```sh
   npm version patch --no-git-tag-version
   ```

   During `0.x`, use `minor` for new features or meaningful workflow changes and `patch` for compatible fixes and small improvements.

4. Move pending notes into `## [<version>]`, matching `package.json`. An optional date is supported: `## [0.4.0] - YYYY-MM-DD`. Empty sections and comment-only sections fail validation.
5. Run `npm run package` and `python3 scripts/verify-package.py`. Include `package-lock.json` in the commit and open a pull request to `main`.
6. Merge the pull request. Actions publishes the validated VSIX, matching English release notes, and a `v<version>` tag pointing to the validated commit.

Each version is published once. A push with an existing version validates changes and preserves its release. Bump the version to distribute new changes. Existing release assets are not replaced.

## What Actions verifies

- Installs locked npm dependencies with Node.js 22 and sets up Python 3.12.
- Runs TypeScript checking, TypeScript/Python tests, compilation, and release-note extraction through `npm run package`.
- Checks VSIX metadata and contents, including the compiled interface, Python worker, and English/Spanish manifest catalogs. Only files explicitly included by `.vscodeignore` are shipped.
- Stores the VSIX and notes as a workflow artifact, including for pull requests. The release job downloads that same validated artifact.
- Publishes only from `main`. Pull requests and `develop` do not publish releases.

The VSIX is universal: native binaries and models are installed separately on the user's device. CI uses engine doubles and does not verify actual recognition or CUDA compatibility on every platform.

## Repository setup

Metadata points to `MauAlvarado43/dev-transcription`. If the owner or name changes, update `repository`, `homepage`, and `bugs` in `package.json`, plus the README links.

For a new copy without a remote, create an empty GitHub repository and push the validated source:

```sh
npm ci
npm run package
python3 scripts/verify-package.py
git add .
git commit -m "Prepare Dev Transcription for GitHub releases"
git remote add origin git@github.com:MauAlvarado43/dev-transcription.git
git push -u origin main
```

The first push to `main` starts **Validate and release**. Do not create the tag or release manually. GitHub Actions must be enabled. The workflow requests `contents: write` only in the release job and uses the automatic `GITHUB_TOKEN`, without additional secrets. Account or organization policies must allow that permission.

## Retrying a release

If publication fails, inspect **Actions → Validate and release** and rerun the failed jobs. You can also use **Run workflow** on `main`. An existing tag without a release must point to the commit being published; otherwise, publication fails.

If the release already exists, the workflow preserves it. Prepare a new version to correct its contents. Editing historical changelog entries locally does not update notes on already published GitHub releases.

## Distribution

Users download the VSIX from GitHub Releases and install it through **Install from VSIX…**. This workflow publishes to GitHub. Visual Studio Marketplace publication requires separate publisher and authentication setup.
