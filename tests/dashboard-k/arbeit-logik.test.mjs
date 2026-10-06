// Unit-Tests der reinen Logik des Arbeitsbereichs (dashboard-k/arbeit-logik.js).
// Ausführen: node --test "tests/dashboard-k/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_WERTE, STANDARD_FILTER,
  sortiereGeruechte, filterGeruechte, kategorienAusListe, zaehleStatus, andereStatus,
  datumZeit, vorZeit, konfidenzText, risikoText, historieText, kurz, meldungenText,
  arbeitFehlerText, listeGueltig, detailGueltig,
} from '../../dashboard-k/arbeit-logik.js';

const g = (id, status, risiko, meldungen = 1, extra = {}) => ({
  geruecht_id: id, status, risiko, anzahl_meldungen: meldungen, kernaussage: `Aussage ${id}`, kategorie: 'A', zweitkategorie: null, ...extra,
});

test('sortiereGeruechte: offen vor bearbeitet, dann Risiko absteigend, dann Meldungen, dann neuere ID', () => {
  const liste = [
    g(1, 'widerlegt', 0.95),
    g(2, 'offen', 0.3),
    g(3, 'offen', 0.9),
    g(4, 'offen', 0.9, 5),
    g(5, 'offen', 0.9, 5),
    g(6, 'offen', null),
  ];
  assert.deepEqual(sortiereGeruechte(liste).map((x) => x.geruecht_id), [5, 4, 3, 2, 6, 1]);
});

test('sortiereGeruechte: verändert die Eingabe nicht, Risiko 0 steht vor "ohne Wert"', () => {
  const liste = [g(1, 'offen', null), g(2, 'offen', 0)];
  const kopie = JSON.stringify(liste);
  assert.deepEqual(sortiereGeruechte(liste).map((x) => x.geruecht_id), [2, 1]);
  assert.equal(JSON.stringify(liste), kopie);
});

test('filterGeruechte: Status, Thema und Risikostufe an den Grenzen', () => {
  const liste = [
    g(1, 'offen', 0.39, 1, { kategorie: 'A' }),
    g(2, 'offen', 0.4, 1, { kategorie: 'B' }),
    g(3, 'bestätigt', 0.75, 1, { kategorie: 'A' }),
    g(4, 'offen', null, 1, { kategorie: 'A' }),
  ];
  const ids = (f) => filterGeruechte(liste, f).map((x) => x.geruecht_id);
  assert.deepEqual(ids({}), [1, 2, 3, 4]);
  assert.deepEqual(ids({ status: 'offen' }), [1, 2, 4]);
  assert.deepEqual(ids({ status: 'bestätigt' }), [3]);
  assert.deepEqual(ids({ kategorie: 'A' }), [1, 3, 4]);
  assert.deepEqual(ids({ risiko: 'niedrig' }), [1]);
  assert.deepEqual(ids({ risiko: 'mittel' }), [2]);
  assert.deepEqual(ids({ risiko: 'hoch' }), [3]);
  assert.deepEqual(ids({ risiko: 'ohne' }), [4]);
  assert.deepEqual(ids({ status: 'offen', kategorie: 'A', risiko: 'ohne' }), [4]);
});

test('filterGeruechte: Suche ohne Rücksicht auf Groß-/Kleinschreibung, in Aussage, Thema und ID', () => {
  const liste = [
    g(12, 'offen', 0.5, 1, { kernaussage: 'Werk Nord wird GESCHLOSSEN', kategorie: 'Standort' }),
    g(13, 'offen', 0.5, 1, { kernaussage: 'Neue Kantine', kategorie: 'Annehmlichkeiten', zweitkategorie: 'Vergütung' }),
  ];
  const ids = (suche) => filterGeruechte(liste, { suche }).map((x) => x.geruecht_id);
  assert.deepEqual(ids('geschlossen'), [12]);
  assert.deepEqual(ids('  KANTINE '), [13]);
  assert.deepEqual(ids('vergütung'), [13]);
  assert.deepEqual(ids('#12'), [12]);
  assert.deepEqual(ids('gibtsnicht'), []);
  assert.deepEqual(ids(''), [12, 13]);
  assert.deepEqual(ids(undefined), [12, 13]);
});

test('filterGeruechte: Gerücht ohne Kernaussage bricht die Suche nicht', () => {
  assert.deepEqual(filterGeruechte([g(1, 'offen', 0.5, 1, { kernaussage: null, kategorie: null })], { suche: 'x' }), []);
  assert.equal(STANDARD_FILTER.status, 'alle');
});

test('kategorienAusListe, zaehleStatus, andereStatus', () => {
  const liste = [g(1, 'offen', 0.1, 1, { kategorie: 'Zeta' }), g(2, 'offen', 0.1, 1, { kategorie: 'Ärger' }), g(3, 'widerlegt', 0.1, 1, { kategorie: null }), g(4, 'offen', 0.1, 1, { kategorie: 'Zeta' })];
  assert.deepEqual(kategorienAusListe(liste), ['Ärger', 'Zeta']);
  assert.deepEqual(zaehleStatus(liste), { alle: 4, offen: 3, bestätigt: 0, widerlegt: 1, 'nicht prüfbar': 0 });
  assert.deepEqual(andereStatus('offen'), ['bestätigt', 'widerlegt', 'nicht prüfbar']);
  assert.equal(andereStatus('widerlegt').length, 3);
  assert.deepEqual(STATUS_WERTE, ['offen', 'bestätigt', 'widerlegt', 'nicht prüfbar']);
});

test('datumZeit: Berliner Zeit, leer bei Unsinn', () => {
  assert.equal(datumZeit('2026-10-05T09:33:00Z'), '05.10.2026, 11:33', 'Sommerzeit +2');
  assert.equal(datumZeit('2026-12-05T09:33:00Z'), '05.12.2026, 10:33', 'Winterzeit +1');
  assert.equal(datumZeit(null), '');
  assert.equal(datumZeit('quatsch'), '');
});

test('vorZeit: grobe Abstände', () => {
  const jetzt = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(vorZeit('2026-10-05T11:59:40Z', jetzt), 'gerade eben');
  assert.equal(vorZeit('2026-10-05T11:15:00Z', jetzt), 'vor 45 Min.');
  assert.equal(vorZeit('2026-10-05T09:00:00Z', jetzt), 'vor 3 Std.');
  assert.equal(vorZeit('2026-10-04T12:00:00Z', jetzt), 'vor 1 Tag');
  assert.equal(vorZeit('2026-10-01T12:00:00Z', jetzt), 'vor 4 Tagen');
  assert.equal(vorZeit('2026-10-06T12:00:00Z', jetzt), 'gerade eben', 'Zukunft wird nicht negativ');
  assert.equal(vorZeit(null, jetzt), '');
});

test('konfidenzText, risikoText, historieText, kurz, meldungenText', () => {
  assert.equal(konfidenzText(0.783), '78 %');
  assert.equal(konfidenzText(null), '');
  assert.equal(risikoText(0.8), '0,80');
  assert.equal(risikoText(null), 'ohne Wert');
  assert.equal(risikoText('abc'), 'ohne Wert');
  assert.equal(historieText({ geaendert_von: 'knut', alt: 'offen', neu: 'bestätigt' }), 'knut: offen → bestätigt');
  assert.equal(kurz('  viel    Platz\n hier '), 'viel Platz hier');
  assert.equal(kurz('a'.repeat(200), 10), `${'a'.repeat(9)}…`);
  assert.equal(kurz(null), '');
  assert.equal(meldungenText(1), '1 Meldung');
  assert.equal(meldungenText(0), '0 Meldungen');
  assert.equal(meldungenText(7), '7 Meldungen');
});

test('arbeitFehlerText: eigener Text je Fall, nie Technik', () => {
  const stati = [401, 403, 404, 409, 429, 0, 500, 400];
  const laden = stati.map((s) => arbeitFehlerText(s));
  assert.equal(new Set(laden).size, stati.length, 'jeder Fall hat einen eigenen Text');
  assert.match(arbeitFehlerText(403), /nicht nutzen/);
  assert.match(arbeitFehlerText(409, 'speichern'), /Jemand anderes/);
  assert.match(arbeitFehlerText(500, 'speichern'), /gespeichert/);
  assert.match(arbeitFehlerText(500), /nicht erreichbar/);
  assert.match(arbeitFehlerText(400, 'speichern'), /gespeichert/);
  assert.match(arbeitFehlerText(400), /geladen/);
  for (const s of stati) for (const a of ['laden', 'speichern']) assert.doesNotMatch(arbeitFehlerText(s, a), /\b\d{3}\b|JWT|function|rpc/i);
});

test('listeGueltig und detailGueltig: nur vollständige Antworten', () => {
  const liste = { grenzen: { mittel: 0.4, hoch: 0.65 }, geruechte: [{ geruecht_id: 1, status: 'offen' }] };
  assert.equal(listeGueltig(liste), true);
  assert.equal(listeGueltig({ ...liste, geruechte: [] }), true);
  assert.equal(listeGueltig({ ...liste, geruechte: [{ status: 'offen' }] }), false);
  assert.equal(listeGueltig({ ...liste, geruechte: [{ geruecht_id: 1 }] }), false);
  assert.equal(listeGueltig({ geruechte: [] }), false);
  assert.equal(listeGueltig(null), false);
  assert.equal(listeGueltig({ fehler: ['x'] }), false);
  const detail = { geruecht_id: 1, status: 'offen', meldungen: [], historie: [] };
  assert.equal(detailGueltig(detail), true);
  assert.equal(detailGueltig({ ...detail, meldungen: null }), false);
  assert.equal(detailGueltig({ ...detail, historie: undefined }), false);
  assert.equal(detailGueltig(null), false);
  assert.equal(detailGueltig({ fehler: ['x'] }), false);
});
