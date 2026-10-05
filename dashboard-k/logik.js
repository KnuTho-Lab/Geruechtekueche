// Reine Logik des Statistik-Dashboards (dashboard-k/): Zahlen aufbereiten, ohne DOM und
// ohne Netzwerk. Getestet in tests/dashboard-k/logik.test.mjs.
// Die Zahlen selbst rechnet die SQL-Funktion dashboard_statistik, hier wird nur dargestellt.

export const RISIKO_STUFEN = ['niedrig', 'mittel', 'hoch'];
export const HEAT_STUFEN = 5; // 0 = keine Meldung, 1 bis 4 = zunehmend viele

// Dieselben Grenzen wie in der SQL-Funktion; die Antwort der Function liefert sie mit
// (grenzen.mittel, grenzen.hoch) und gewinnt gegen diesen Standard.
export const STANDARD_GRENZEN = { mittel: 0.4, hoch: 0.75 };

export function risikoStufe(wert, grenzen = STANDARD_GRENZEN) {
  if (wert === null || wert === undefined || Number.isNaN(Number(wert))) return null;
  const w = Number(wert);
  if (w >= grenzen.hoch) return 'hoch';
  if (w >= grenzen.mittel) return 'mittel';
  return 'niedrig';
}

// Anteil in ganzen Prozent, 0 bei leerer Grundmenge.
export function prozent(teil, ganz) {
  const t = Number(teil), g = Number(ganz);
  if (!g || g <= 0 || !Number.isFinite(t)) return 0;
  return Math.round((t / g) * 100);
}

// Trend der letzten 7 Tage gegen den Schnitt der vier 7-Tage-Fenster davor.
// richtung: 'auf' | 'ab' | 'gleich' | 'neu' (davor nichts) | 'ruhig' (beides null)
export function trendInfo(letzte7, schnittVorher) {
  const l = Number(letzte7) || 0;
  const s = Number(schnittVorher) || 0;
  if (l === 0 && s === 0) return { richtung: 'ruhig', prozent: 0, text: 'Keine Meldungen in den letzten Wochen' };
  if (s === 0) return { richtung: 'neu', prozent: null, text: `${l} in den letzten 7 Tagen, davor keine` };
  const p = Math.round(((l - s) / s) * 100);
  if (Math.abs(p) < 10) return { richtung: 'gleich', prozent: p, text: 'Etwa wie sonst' };
  return {
    richtung: p > 0 ? 'auf' : 'ab',
    prozent: p,
    text: `${p > 0 ? '+' : '−'}${Math.abs(p)} % gegen den Wochenschnitt`,
  };
}

// 'YYYY-MM-DD' ohne Zeitzonen-Fallen als lokales Datum bauen (kein new Date('YYYY-MM-DD'), das ist UTC).
export function tagZuDatum(tag) {
  const [j, m, d] = String(tag).split('-').map(Number);
  return new Date(j, m - 1, d);
}

export function datumKurz(tag) {
  const d = tagZuDatum(tag);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

// ISO-Kalenderwoche eines Tages ('YYYY-MM-DD').
export function kalenderwoche(tag) {
  const d = tagZuDatum(tag);
  const donnerstag = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const ersterJanuar = new Date(donnerstag.getFullYear(), 0, 4);
  return 1 + Math.round(((donnerstag - ersterJanuar) / 86400000 - 3 + ((ersterJanuar.getDay() + 6) % 7)) / 7);
}

// Tage (aufsteigend, beginnend an einem Montag) in Wochenspalten zu je 7 Zellen.
// Zellen nach dem letzten Tag der letzten Woche sind null (Zukunft).
export function heatmapWochen(tage) {
  const wochen = [];
  for (let i = 0; i < tage.length; i += 7) {
    const zellen = tage.slice(i, i + 7).map((t) => ({ tag: t.tag, anzahl: Number(t.anzahl) || 0 }));
    while (zellen.length < 7) zellen.push(null);
    wochen.push({
      start: zellen[0].tag,
      kw: kalenderwoche(zellen[0].tag),
      summe: zellen.reduce((s, z) => s + (z ? z.anzahl : 0), 0),
      zellen,
    });
  }
  return wochen;
}

// Farbstufe 0 bis 4 relativ zum Maximum der Anzeige. Alles ueber 0 bekommt mindestens Stufe 1,
// damit eine einzelne Meldung neben einem starken Tag nicht wie "nichts" aussieht.
export function heatStufe(anzahl, maximum) {
  const a = Number(anzahl) || 0, m = Number(maximum) || 0;
  if (a <= 0 || m <= 0) return 0;
  return Math.min(HEAT_STUFEN - 1, Math.max(1, Math.ceil((a / m) * (HEAT_STUFEN - 1))));
}

// Kategorie-Heatmap: je Kategorie eine Zeile mit der Anzahl je Woche (in der Reihenfolge der
// uebergebenen Wochen), Zeilen nach Summe absteigend, dann nach Name. Kategorien ohne
// Meldung im Zeitraum fehlen.
export function kategorieZeilen(eintraege, wochenStarts) {
  const index = new Map(wochenStarts.map((w, i) => [w, i]));
  const zeilen = new Map();
  for (const e of eintraege) {
    const i = index.get(e.woche);
    if (i === undefined) continue;
    if (!zeilen.has(e.kategorie)) zeilen.set(e.kategorie, { kategorie: e.kategorie, wochen: wochenStarts.map(() => 0), summe: 0 });
    const z = zeilen.get(e.kategorie);
    z.wochen[i] += Number(e.anzahl) || 0;
    z.summe += Number(e.anzahl) || 0;
  }
  return [...zeilen.values()].sort((a, b) => b.summe - a.summe || a.kategorie.localeCompare(b.kategorie, 'de'));
}

export function zahl(n) {
  return new Intl.NumberFormat('de-DE').format(Number(n) || 0);
}

export function dezimal(n, stellen = 1) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: stellen }).format(Number(n) || 0);
}

export function prozentText(bruchteil) {
  const p = (Number(bruchteil) || 0) * 100;
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: p < 10 ? 1 : 0 }).format(p)} %`;
}

export const ABWEISUNGSGRUND_NAMEN = {
  prompt_injection: 'Prompt Injection',
  kein_geruecht: 'Kein Gerücht',
  beleidigung: 'Beleidigung',
  sonstiges: 'Sonstiges',
};

export function abweisungsName(grund) {
  return ABWEISUNGSGRUND_NAMEN[grund] ?? grund;
}

// Fehlertext fuer die Statistik-Abfrage, bewusst ohne Technik.
export function statistikFehlerText(status) {
  if (status === 401) return 'Die Anmeldung ist abgelaufen. Bitte melde dich neu an.';
  if (status === 403) return 'Diese Seite darf die Statistik nicht abrufen.';
  if (status === 429) return 'Zu viele Abfragen. Bitte warte einen Moment.';
  if (status >= 500) return 'Die Statistik ist gerade nicht erreichbar. Bitte später noch einmal versuchen.';
  return 'Die Statistik konnte nicht geladen werden.';
}

// Prueft, ob die Antwort der Function die Form hat, die die Seite zeichnen kann.
// Lieber eine klare Fehlermeldung als eine halb gezeichnete Seite.
export function statistikGueltig(daten) {
  if (!daten || typeof daten !== 'object') return false;
  const noetig = ['grenzen', 'meldungen', 'heatmap', 'geruechte', 'risiko', 'kategorien', 'verbreitung', 'abweisungen', 'system'];
  if (!noetig.every((k) => daten[k] && typeof daten[k] === 'object')) return false;
  return Array.isArray(daten.heatmap.tage) && Array.isArray(daten.heatmap.kategorien) && Array.isArray(daten.kategorien)
    && Array.isArray(daten.abweisungen.gruende) && Array.isArray(daten.system.tage);
}
