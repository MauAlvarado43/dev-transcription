import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/extract-release-notes.mjs', import.meta.url));

function extract(t: TestContext, changelog: string, version = '0.3.0') {
  const cwd = mkdtempSync(join(tmpdir(), 'transcription-release-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(cwd, 'CHANGELOG.md'), changelog);
  const result = spawnSync(process.execPath, [script, 'dist/release-notes.md'], { cwd, encoding: 'utf8' });
  return { ...result, output: () => readFileSync(join(cwd, 'dist/release-notes.md'), 'utf8') };
}

test('release notes include only the packaged version, preserving subsections and CRLF input', t => {
  const result = extract(t, '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n- Future.\r\n\r\n## [0.3.0] - 2026-10-27\r\n\r\n### Added\r\n- Current.\r\n\r\n## [0.2.0]\r\n\r\n- Previous.\r\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output(), '### Added\n- Current.\n');
});

test('release notes can come from the last section of the changelog', t => {
  const result = extract(t, '# Changelog\n\n## [0.3.0]\n\n- First release.\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output(), '- First release.\n');
});

test('release fails when the packaged version has no exact changelog section', t => {
  const result = extract(t, '## [0.3.1]\n\n- Other version.\n\n## [0x3x0]\n\n- Not a match.\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must contain a ## \[0\.3\.0\] section/);
});

test('release fails when the matching section is empty or contains only a comment', t => {
  for (const body of ['', '<!-- Add release notes here. -->']) {
    const result = extract(t, `## [0.3.0]\n\n${body}\n\n## [0.2.0]\n\n- Older notes.\n`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must include release notes/);
  }
});
