// Nur für die lokale Vorschau: ?demo an der Adresse von http://localhost:… zeigt erfundene Zahlen
// ohne Login und ohne Abfrage. Auf der echten Seite wird dieses Modul nie geladen (app.js prüft
// den Hostnamen). Alle Werte sind Illustration, keine echten Daten.
const KATEGORIEN = [
  'Sicherheit und Gesundheit', 'Schwere Vorwürfe gegen Personen', 'Insolvenz oder Zahlungsunfähigkeit',
  'Umwelt- oder Compliance-Verstoß', 'Standortschließung oder Massenentlassung', 'Qualität und Produkt',
  'Datenleck oder Cyberangriff', 'Übernahme oder Verkauf', 'Vergütung', 'Annehmlichkeiten und Arbeitsumfeld', 'Sonstiges',
];

function zufall(startwert) {
  let s = startwert;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function demoStatistik({ leer = false } = {}) {
  const r = zufall(42);
  const heute = new Date();
  const montag = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - ((heute.getDay() + 6) % 7) - 11 * 7);
  const tage = [];
  for (let d = new Date(montag); d <= heute; d.setDate(d.getDate() + 1)) {
    const woche = Math.floor((d - montag) / 86400000 / 7);
    const grundlast = leer ? 0 : Math.max(0, Math.round(woche / 3 + r() * 5 - 1.5));
    tage.push({ tag: iso(d), anzahl: grundlast });
  }
  const wochenStarts = [...new Set(tage.map((t, i) => (i % 7 === 0 ? t.tag : null)).filter(Boolean))];
  const kategorien = [];
  wochenStarts.forEach((w, wi) => {
    const summe = tage.slice(wi * 7, wi * 7 + 7).reduce((s, t) => s + t.anzahl, 0);
    KATEGORIEN.forEach((k, ki) => {
      const n = Math.round(summe * (ki < 3 ? 0.2 : 0.06) * (0.6 + r()));
      if (n > 0) kategorien.push({ woche: w, kategorie: k, anzahl: n });
    });
  });
  const gesamt = tage.reduce((s, t) => s + t.anzahl, 0);
  const letzte7 = tage.slice(-7).reduce((s, t) => s + t.anzahl, 0);
  const geruechte = leer ? 0 : 74;
  return {
    erzeugt_am: new Date().toISOString(),
    zeitzone: 'Europe/Berlin',
    grenzen: { mittel: 0.4, hoch: 0.75 },
    meldungen: { gesamt, letzte_7_tage: letzte7, schnitt_vorher: leer ? 0 : 18.5 },
    heatmap: { von: tage[0].tag, wochen: 12, tage, kategorien },
    geruechte: leer
      ? { gesamt: 0, offen: 0, bearbeitet: 0, bestaetigt: 0, widerlegt: 0, nicht_pruefbar: 0 }
      : { gesamt: geruechte, offen: 41, bearbeitet: 33, bestaetigt: 14, widerlegt: 15, nicht_pruefbar: 4 },
    risiko: leer
      ? { niedrig: 0, mittel: 0, hoch: 0, ohne_wert: 0, hoch_offen: 0 }
      : { niedrig: 38, mittel: 25, hoch: 8, ohne_wert: 3, hoch_offen: 3 },
    kategorien: KATEGORIEN.map((name, i) => ({ name, anzahl: leer ? 0 : Math.max(1, Math.round(16 - i * 1.4)) })),
    verbreitung: { median: leer ? 0 : 2, maximum: leer ? 0 : 17 },
    abweisungen: {
      gesamt: leer ? 0 : 12, quote: leer ? 0 : 0.0286,
      gruende: [
        { grund: 'prompt_injection', anzahl: leer ? 0 : 5 }, { grund: 'kein_geruecht', anzahl: leer ? 0 : 4 },
        { grund: 'beleidigung', anzahl: leer ? 0 : 2 }, { grund: 'sonstiges', anzahl: leer ? 0 : 1 },
      ],
    },
    system: {
      tage: Array.from({ length: 14 }, (_, i) => {
        const d = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - 13 + i);
        const aufrufe = leer ? 0 : Math.round(20 + r() * 60);
        return { tag: iso(d), aufrufe, fehler: leer ? 0 : Math.round(aufrufe * r() * 0.08) };
      }),
      aufrufe_7d: leer ? 0 : 312, fehler_7d: leer ? 0 : 9, antwortzeit_median_ms: leer ? 0 : 412,
      rate_limit_7d: 0, haengende: leer ? 0 : 1, risiko_queue: leer ? 0 : 3,
    },
  };
}
