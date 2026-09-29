// Unit-Tests der reinen Logik der Meldungsseite (melden/logik.js).
// Ausführen: node --test "tests/melden/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ZEICHEN, MAX_VERLAUF,
  eingabePruefen, anfrageBauen, antwortText, fehlerText, anmeldeFehlerText,
  sitzungLaden, sitzungNeu, verlaufLaden, verlaufSpeichern,
} from '../../melden/logik.js';

// Minimaler Ersatz für sessionStorage.
function speicher(start = {}) {
  const daten = { ...start };
  return {
    daten,
    getItem: (k) => (k in daten ? daten[k] : null),
    setItem: (k, v) => { daten[k] = String(v); },
    removeItem: (k) => { delete daten[k]; },
  };
}
const kaputterSpeicher = {
  getItem() { throw new Error('blockiert'); },
  setItem() { throw new Error('blockiert'); },
  removeItem() { throw new Error('blockiert'); },
};

test('eingabePruefen: leer und nur Leerraum werden abgelehnt', () => {
  assert.equal(eingabePruefen('').ok, false);
  assert.equal(eingabePruefen('   \n\t ').ok, false);
  assert.equal(eingabePruefen(undefined).ok, false);
});

test('eingabePruefen: trimmt und nimmt normalen Text an', () => {
  assert.deepEqual(eingabePruefen('  Die Kantine schließt.  '), { ok: true, text: 'Die Kantine schließt.' });
});

test('eingabePruefen: Grenze MAX_ZEICHEN gilt genau', () => {
  assert.equal(eingabePruefen('a'.repeat(MAX_ZEICHEN)).ok, true);
  const zuLang = eingabePruefen('a'.repeat(MAX_ZEICHEN + 1));
  assert.equal(zuLang.ok, false);
  assert.match(zuLang.fehler, /zu lang/i);
});

test('anfrageBauen: n8n-Chat-Format ohne Nutzerbezug', () => {
  const body = anfrageBauen({ sessionId: 's-1', text: 'Hallo' });
  assert.deepEqual(body, { action: 'sendMessage', sessionId: 's-1', chatInput: 'Hallo' });
  // Anonymität: nichts außer diesen drei Feldern geht raus.
  assert.deepEqual(Object.keys(body).sort(), ['action', 'chatInput', 'sessionId']);
});

test('antwortText: erkennt output, text und Array-Antworten', () => {
  assert.equal(antwortText({ output: 'Danke!' }), 'Danke!');
  assert.equal(antwortText({ text: 'Danke!' }), 'Danke!');
  assert.equal(antwortText([{ output: 'Erstes' }, { output: 'Zweites' }]), 'Erstes');
  assert.equal(antwortText('Reiner Text'), 'Reiner Text');
});

test('antwortText: leere oder unbekannte Antworten ergeben null', () => {
  assert.equal(antwortText(null), null);
  assert.equal(antwortText({}), null);
  assert.equal(antwortText({ output: '   ' }), null);
  assert.equal(antwortText({ output: 42 }), null);
  assert.equal(antwortText([]), null);
});

test('fehlerText: bekannte Statuscodes haben eigene Texte', () => {
  assert.match(fehlerText(401), /anmeldung/i);
  assert.match(fehlerText(429), /moment/i);
  assert.match(fehlerText(503), /nicht erreichbar/i);
  assert.match(fehlerText(500), /nicht geklappt/i);
  assert.match(fehlerText(0), /verbindung/i);
});

test('anmeldeFehlerText: falsche Zugangsdaten verraten nicht, was falsch war', () => {
  assert.equal(anmeldeFehlerText({ message: 'Invalid login credentials' }), 'E-Mail oder Passwort stimmen nicht.');
  assert.match(anmeldeFehlerText({ message: 'Email not confirmed' }), /bestätigt/i);
  assert.match(anmeldeFehlerText({ status: 429, message: 'x' }), /versuche/i);
  assert.match(anmeldeFehlerText({ message: 'Failed to fetch' }), /verbindung/i);
  assert.match(anmeldeFehlerText({}), /nicht geklappt/i);
});

test('sitzungLaden: erzeugt einmal eine ID und behält sie', () => {
  const s = speicher();
  let n = 0;
  const erzeugen = () => `id-${++n}`;
  assert.equal(sitzungLaden(s, erzeugen), 'id-1');
  assert.equal(sitzungLaden(s, erzeugen), 'id-1');
  assert.equal(n, 1);
});

test('sitzungNeu: ersetzt die ID und leert den Verlauf', () => {
  const s = speicher();
  let n = 0;
  const erzeugen = () => `id-${++n}`;
  sitzungLaden(s, erzeugen);
  verlaufSpeichern(s, [{ rolle: 'nutzer', text: 'alt' }]);
  assert.equal(sitzungNeu(s, erzeugen), 'id-2');
  assert.deepEqual(verlaufLaden(s), []);
});

test('sitzungLaden: funktioniert auch ohne nutzbaren Speicher', () => {
  assert.equal(sitzungLaden(kaputterSpeicher, () => 'frisch'), 'frisch');
  assert.equal(sitzungNeu(kaputterSpeicher, () => 'frisch2'), 'frisch2');
  assert.equal(sitzungLaden(null, () => 'ohne'), 'ohne');
});

test('verlauf: speichern und laden, begrenzt auf MAX_VERLAUF', () => {
  const s = speicher();
  const viele = Array.from({ length: MAX_VERLAUF + 5 }, (_, i) => ({ rolle: 'nutzer', text: `m${i}` }));
  verlaufSpeichern(s, viele);
  const geladen = verlaufLaden(s);
  assert.equal(geladen.length, MAX_VERLAUF);
  assert.equal(geladen[0].text, 'm5');
  assert.equal(geladen.at(-1).text, `m${MAX_VERLAUF + 4}`);
});

test('verlaufLaden: kaputte oder fremde Daten ergeben leeren Verlauf', () => {
  assert.deepEqual(verlaufLaden(speicher({ 'gk-verlauf': '{kein json' })), []);
  assert.deepEqual(verlaufLaden(speicher({ 'gk-verlauf': '{"a":1}' })), []);
  assert.deepEqual(verlaufLaden(kaputterSpeicher), []);
  // Einträge ohne gültige Rolle oder Text werden verworfen.
  const gemischt = JSON.stringify([
    { rolle: 'agent', text: 'ok' }, { rolle: 'hacker', text: 'x' }, { rolle: 'nutzer' }, 'Müll',
  ]);
  assert.deepEqual(verlaufLaden(speicher({ 'gk-verlauf': gemischt })), [{ rolle: 'agent', text: 'ok' }]);
});

test('verlaufSpeichern: wirft nicht bei blockiertem Speicher', () => {
  assert.doesNotThrow(() => verlaufSpeichern(kaputterSpeicher, [{ rolle: 'nutzer', text: 'x' }]));
});
