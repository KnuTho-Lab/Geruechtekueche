// Unit-Tests der reinen Logik des Statistik-Dashboards (dashboard-k/logik.js).
// Ausführen: node --test "tests/dashboard-k/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_GRENZEN, HEAT_STUFEN,
  risikoStufe, prozent, trendInfo, tagZuDatum, datumKurz, kalenderwoche,
  heatmapWochen, heatStufe, kategorieZeilen, zahl, dezimal, prozentText,
  abweisungsName, statistikFehlerText, statistikGueltig,
} from '../../dashboard-k/logik.js';

test('risikoStufe: Grenzen 0,40 und 0,65 gehören zur höheren Stufe', () => {
  assert.equal(risikoStufe(0), 'niedrig');
  assert.equal(risikoStufe(0.39), 'niedrig');
  assert.equal(risikoStufe(0.4), 'mittel');
  assert.equal(risikoStufe(0.64), 'mittel');
  assert.equal(risikoStufe(0.65), 'hoch');
  assert.equal(risikoStufe(1), 'hoch');
});

test('risikoStufe: kein Wert ergibt null, eigene Grenzen gewinnen', () => {
  assert.equal(risikoStufe(null), null);
  assert.equal(risikoStufe(undefined), null);
  assert.equal(risikoStufe('abc'), null);
  assert.equal(risikoStufe(0.5, { mittel: 0.6, hoch: 0.9 }), 'niedrig');
  assert.deepEqual(STANDARD_GRENZEN, { mittel: 0.4, hoch: 0.65 });
});

test('prozent: gerundet, 0 bei leerer Grundmenge', () => {
  assert.equal(prozent(1, 3), 33);
  assert.equal(prozent(2, 3), 67);
  assert.equal(prozent(0, 0), 0);
  assert.equal(prozent(5, 0), 0);
  assert.equal(prozent(5, 5), 100);
  assert.equal(prozent('x', 5), 0);
});

test('trendInfo: auf, ab, gleich, neu und ruhig', () => {
  assert.deepEqual(trendInfo(13.5, 10), { richtung: 'auf', prozent: 35, text: '+35 % gegen den Wochenschnitt' });
  assert.equal(trendInfo(5, 10).richtung, 'ab');
  assert.equal(trendInfo(5, 10).text, '−50 % gegen den Wochenschnitt');
  assert.equal(trendInfo(10, 10).richtung, 'gleich');
  assert.equal(trendInfo(10.9, 10).richtung, 'gleich', '+9 % zählt noch als gleich');
  assert.equal(trendInfo(11, 10).richtung, 'auf', '+10 % ist ein Anstieg');
  assert.equal(trendInfo(4, 0).richtung, 'neu');
  assert.equal(trendInfo(4, 0).prozent, null);
  assert.equal(trendInfo(0, 0).richtung, 'ruhig');
  assert.equal(trendInfo(0, 3).richtung, 'ab');
  assert.equal(trendInfo(0, 3).prozent, -100);
});

test('tagZuDatum und datumKurz: kein Zeitzonenversatz', () => {
  const d = tagZuDatum('2026-10-05');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 5);
  assert.equal(datumKurz('2026-10-05'), '05.10.');
  assert.equal(datumKurz('2026-01-31'), '31.01.');
});

test('kalenderwoche: ISO-Wochen, auch an den Jahresgrenzen', () => {
  assert.equal(kalenderwoche('2026-10-05'), 41);
  assert.equal(kalenderwoche('2026-09-28'), 40);
  assert.equal(kalenderwoche('2026-01-01'), 1);
  assert.equal(kalenderwoche('2025-12-29'), 1, 'Montag 29.12.2025 gehört schon zu KW 1/2026');
  assert.equal(kalenderwoche('2021-01-03'), 53, 'Sonntag 03.01.2021 gehört noch zu KW 53/2020');
  assert.equal(kalenderwoche('2024-12-30'), 1);
});

test('heatmapWochen: Wochenspalten zu 7, letzte Woche mit null aufgefüllt, Summen und KW', () => {
  const tage = [];
  // Montag 2026-09-28 bis Mittwoch 2026-10-07 = 10 Tage
  for (let i = 0; i < 10; i++) {
    const d = new Date(2026, 8, 28 + i);
    tage.push({ tag: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, anzahl: i + 1 });
  }
  const w = heatmapWochen(tage);
  assert.equal(w.length, 2);
  assert.equal(w[0].start, '2026-09-28');
  assert.equal(w[0].kw, 40);
  assert.equal(w[0].summe, 1 + 2 + 3 + 4 + 5 + 6 + 7);
  assert.equal(w[0].zellen.length, 7);
  assert.equal(w[1].start, '2026-10-05');
  assert.equal(w[1].kw, 41);
  assert.equal(w[1].summe, 8 + 9 + 10);
  assert.equal(w[1].zellen[2].anzahl, 10);
  assert.equal(w[1].zellen[3], null);
  assert.equal(w[1].zellen[6], null);
});

test('heatmapWochen: leere Eingabe ergibt keine Wochen', () => {
  assert.deepEqual(heatmapWochen([]), []);
});

test('heatStufe: 0 bleibt 0, alles darüber mindestens 1, Maximum ist die höchste Stufe', () => {
  assert.equal(HEAT_STUFEN, 5);
  assert.equal(heatStufe(0, 10), 0);
  assert.equal(heatStufe(1, 100), 1, 'einzelne Meldung neben starkem Tag bleibt sichtbar');
  assert.equal(heatStufe(10, 10), 4);
  assert.equal(heatStufe(5, 10), 2);
  assert.equal(heatStufe(7, 10), 3);
  assert.equal(heatStufe(3, 0), 0, 'ohne Maximum keine Farbe');
  assert.equal(heatStufe(20, 10), 4, 'nie über die höchste Stufe');
});

test('kategorieZeilen: Summen je Kategorie und Woche, absteigend sortiert, fremde Wochen ignoriert', () => {
  const wochen = ['2026-09-28', '2026-10-05'];
  const z = kategorieZeilen([
    { woche: '2026-09-28', kategorie: 'B', anzahl: 2 },
    { woche: '2026-10-05', kategorie: 'B', anzahl: 3 },
    { woche: '2026-10-05', kategorie: 'A', anzahl: 5 },
    { woche: '2026-10-05', kategorie: 'C', anzahl: 6 },
    { woche: '2020-01-06', kategorie: 'A', anzahl: 99 },
  ], wochen);
  assert.deepEqual(z.map((x) => x.kategorie), ['C', 'A', 'B'], 'C (6) vor A und B (je 5), bei Gleichstand nach Name');
  assert.deepEqual(z.find((x) => x.kategorie === 'B').wochen, [2, 3]);
  assert.equal(z.find((x) => x.kategorie === 'A').summe, 5, 'die Woche von 2020 zählt nicht');
});

test('zahl, dezimal, prozentText: deutsche Schreibweise', () => {
  assert.equal(zahl(1234), '1.234');
  assert.equal(zahl(null), '0');
  assert.equal(dezimal(2.5), '2,5');
  assert.equal(dezimal(3), '3');
  assert.equal(prozentText(0.0286), '2,9 %');
  assert.equal(prozentText(0.5), '50 %');
  assert.equal(prozentText(0), '0 %');
});

test('abweisungsName: Klartext, Unbekanntes bleibt wie es ist', () => {
  assert.equal(abweisungsName('prompt_injection'), 'Prompt Injection');
  assert.equal(abweisungsName('kein_geruecht'), 'Kein Gerücht');
  assert.equal(abweisungsName('neu'), 'neu');
});

test('statistikFehlerText: je Status ein eigener Text ohne Technik', () => {
  const texte = new Set([401, 403, 429, 500, 404].map(statistikFehlerText));
  assert.equal(texte.size, 5, 'jeder Status hat einen eigenen Text');
  assert.match(statistikFehlerText(401), /neu an/);
  assert.match(statistikFehlerText(503), /nicht erreichbar/);
  assert.match(statistikFehlerText(404), /nicht geladen/);
  for (const s of [401, 403, 429, 500, 404]) assert.doesNotMatch(statistikFehlerText(s), /\d{3}|JWT|function/i);
});

test('statistikGueltig: nur vollständige Antworten', () => {
  const ok = {
    grenzen: {}, meldungen: {}, heatmap: { tage: [], kategorien: [] }, geruechte: {}, risiko: {},
    kategorien: [], verbreitung: {}, abweisungen: { gruende: [] }, system: { tage: [] },
  };
  assert.equal(statistikGueltig(ok), true);
  assert.equal(statistikGueltig(null), false);
  assert.equal(statistikGueltig({}), false);
  assert.equal(statistikGueltig({ ...ok, heatmap: { tage: [] } }), false);
  assert.equal(statistikGueltig({ ...ok, kategorien: null }), false);
  assert.equal(statistikGueltig({ fehler: ['Nicht angemeldet'] }), false);
});
