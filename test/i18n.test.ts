import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { english, spanish, setLocale, locale, resolveLocale, translate, localizeError, localizeMessage, countedText, type MessageKey } from '../src/i18n';
import { validName } from '../src/domain';
import { stageLabel } from '../src/progress';

test('English is the default and unsupported interface locales fall back to English', () => {
  assert.equal(locale(), 'en');
  for (const value of [undefined, null, '', 'fr', 'auto', 'ES', {}]) assert.equal(resolveLocale(value), 'en');
  assert.equal(resolveLocale('es'), 'es');
});

test('English and Spanish catalogs have complete keys and matching placeholders', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  assert.deepEqual(Object.keys(spanish).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english) as MessageKey[]) {
    assert.ok(english[key].trim(), key);
    assert.ok(spanish[key].trim(), key);
    assert.deepEqual(placeholders(spanish[key]), placeholders(english[key]), key);
  }
});

test('formatting preserves user values, including replacement characters and another language', () => {
  const name = 'Mi video $& <script> & "quotes"';
  assert.equal(translate('en', 'openVideo', { title: name }), `Open ${name}`);
  assert.equal(translate('es', 'openVideo', { title: name }), `Abrir ${name}`);
});

test('known validation errors and progress follow the interface locale while diagnostics stay English', t => {
  t.after(() => setLocale('en'));
  let failure: unknown;
  try { validName(''); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error);
  assert.equal(failure.message, english.invalidName);
  setLocale('es');
  assert.equal(localizeError(failure), spanish.invalidName);
  assert.equal(stageLabel('speakers'), spanish.stageSpeakers);
  assert.equal(localizeMessage('Transcribing segment 2 / 7'), 'Transcribiendo fragmento 2 / 7');
  setLocale('en');
  assert.equal(localizeError(failure), english.invalidName);
  assert.equal(localizeMessage('Unknown decoder diagnostic'), 'Unknown decoder diagnostic');
});

test('manifest translations cover contributions and interface language stays separate from recognition', () => {
  const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  const manifest = read('package.json');
  const en = read('package.nls.json');
  const es = read('package.nls.es.json');
  const references = [...JSON.stringify(manifest).matchAll(/%([\w.]+)%/g)].map(match => match[1]!);
  assert.ok(references.length > 20);
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const key of references) { assert.ok(en[key], key); assert.ok(es[key], key); }
  const settings = manifest.contributes.configuration.properties;
  assert.equal(settings['devTranscription.interfaceLanguage'].default, 'en');
  assert.deepEqual(settings['devTranscription.interfaceLanguage'].enum, ['en', 'es']);
  assert.equal(settings['devTranscription.language'].default, 'auto');
  assert.deepEqual(settings['devTranscription.language'].enum, ['auto', 'es', 'en']);
});

test('counts use the correct singular and plural forms in both interface languages', t => {
  t.after(() => setLocale('en'));
  setLocale('en');
  assert.equal(countedText('videos', 1), '1 video');
  assert.equal(countedText('videos', 0), '0 videos');
  assert.equal(countedText('segments', 2), '2 segments');
  setLocale('es');
  assert.equal(countedText('transcribed', 1), '1 transcrito');
  assert.equal(countedText('transcribed', 2), '2 transcritos');
  assert.equal(countedText('segments', 1), '1 fragmento');
});
