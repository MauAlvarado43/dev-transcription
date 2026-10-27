import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outputPath = process.argv[2];
if (!outputPath) throw new Error('Provide an output path for the release notes.');

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (typeof version !== 'string' || !version) throw new Error('package.json must include a version.');

const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headerPattern = new RegExp(`^## \\[${escapedVersion}\\](?:[ \\t]+-[ \\t]+[^\\n]+)?[ \\t]*$`, 'm');
const header = headerPattern.exec(changelog);
if (!header) throw new Error(`CHANGELOG.md must contain a ## [${version}] section.`);

const start = header.index + header[0].length;
const rest = changelog.slice(start);
const nextSection = /^## /m.exec(rest);
const notes = rest.slice(0, nextSection?.index).trim();
if (!notes || !notes.replace(/<!--[^]*?-->/g, '').trim()) {
  throw new Error(`The ${version} changelog section must include release notes.`);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${notes}\n`);
