// Reine Logik des Arbeitsbereichs (Tab 2): sortieren, filtern, Texte. Ohne DOM und ohne
// Netzwerk, getestet in tests/dashboard-k/arbeit-logik.test.mjs.
import { risikoStufe, STANDARD_GRENZEN } from './logik.js';

export const STATUS_WERTE = ['offen', 'bestätigt', 'widerlegt', 'nicht prüfbar'];

// Reihenfolge der Risikostufen in der Dringlichkeit, "ohne" = noch kein Risikowert.
const STUFEN_RANG = { hoch: 3, mittel: 2, niedrig: 1 };

// Dringlichkeit: offene zuerst, dann höheres Risiko, dann mehr Meldungen, dann neueres Gerücht.
// Gerüchte ohne Risikowert stehen hinter denen mit Wert: unbewertet ist nicht harmlos, aber auch
// nicht dringender als ein bekanntes hohes Risiko.
export function sortiereGeruechte(liste) {
  return [...liste].sort((a, b) => {
    const offenA = a.status === 'offen' ? 1 : 0, offenB = b.status === 'offen' ? 1 : 0;
    if (offenA !== offenB) return offenB - offenA;
    const rA = a.risiko === null || a.risiko === undefined ? -1 : Number(a.risiko);
    const rB = b.risiko === null || b.risiko === undefined ? -1 : Number(b.risiko);
    if (rA !== rB) return rB - rA;
    const mA = Number(a.anzahl_meldungen) || 0, mB = Number(b.anzahl_meldungen) || 0;
    if (mA !== mB) return mB - mA;
    return Number(b.geruecht_id) - Number(a.geruecht_id);
  });
}

export const STANDARD_FILTER = { status: 'alle', risiko: 'alle', kategorie: 'alle', suche: '' };

// risiko-Filter: 'alle' | 'hoch' | 'mittel' | 'niedrig' | 'ohne'
export function filterGeruechte(liste, filter = STANDARD_FILTER, grenzen = STANDARD_GRENZEN) {
  const f = { ...STANDARD_FILTER, ...filter };
  const suche = String(f.suche ?? '').trim().toLocaleLowerCase('de');
  return liste.filter((g) => {
    if (f.status !== 'alle' && g.status !== f.status) return false;
    if (f.kategorie !== 'alle' && g.kategorie !== f.kategorie) return false;
    if (f.risiko !== 'alle') {
      const stufe = risikoStufe(g.risiko, grenzen) ?? 'ohne';
      if (stufe !== f.risiko) return false;
    }
    if (suche) {
      const heu = `${g.kernaussage ?? ''} ${g.kategorie ?? ''} ${g.zweitkategorie ?? ''} #${g.geruecht_id}`.toLocaleLowerCase('de');
      if (!heu.includes(suche)) return false;
    }
    return true;
  });
}

export function kategorienAusListe(liste) {
  return [...new Set(liste.map((g) => g.kategorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
}

export function zaehleStatus(liste) {
  const z = { alle: liste.length };
  for (const s of STATUS_WERTE) z[s] = 0;
  for (const g of liste) if (g.status in z) z[g.status] += 1;
  return z;
}

export function andereStatus(aktuell) {
  return STATUS_WERTE.filter((s) => s !== aktuell);
}

export function datumZeit(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}

// "vor 3 Std." und so weiter, grob. Für Listen, wo das genaue Datum zu viel ist.
export function vorZeit(iso, jetzt = Date.now()) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((jetzt - t) / 60000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  const tage = Math.round(std / 24);
  return `vor ${tage} ${tage === 1 ? 'Tag' : 'Tagen'}`;
}

export function konfidenzText(k) {
  if (k === null || k === undefined || Number.isNaN(Number(k))) return '';
  return `${Math.round(Number(k) * 100)} %`;
}

export function risikoText(wert) {
  if (wert === null || wert === undefined || Number.isNaN(Number(wert))) return 'ohne Wert';
  return Number(wert).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function historieText(h) {
  return `${h.geaendert_von}: ${h.alt} → ${h.neu}`;
}

export function kurz(text, max = 140) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function meldungenText(n) {
  const z = Number(n) || 0;
  return `${z} ${z === 1 ? 'Meldung' : 'Meldungen'}`;
}

// Fehlertexte für Laden und Statuswechsel, bewusst ohne Technik.
export function arbeitFehlerText(status, aktion = 'laden') {
  if (status === 401) return 'Die Anmeldung ist abgelaufen. Bitte melde dich neu an.';
  if (status === 403) return 'Dein Konto darf den Arbeitsbereich nicht nutzen.';
  if (status === 404) return 'Dieses Gerücht gibt es nicht mehr.';
  if (status === 409) return 'Jemand anderes hat den Status inzwischen geändert. Die Ansicht wurde aktualisiert, bitte prüfe und versuche es erneut.';
  if (status === 429) return 'Zu viele Anfragen. Bitte warte einen Moment.';
  if (status === 0) return 'Keine Verbindung. Bitte versuche es noch einmal.';
  if (status >= 500) return aktion === 'speichern' ? 'Der Status konnte nicht gespeichert werden. Bitte später noch einmal versuchen.' : 'Der Arbeitsbereich ist gerade nicht erreichbar. Bitte später noch einmal versuchen.';
  return aktion === 'speichern' ? 'Der Status konnte nicht gespeichert werden.' : 'Der Arbeitsbereich konnte nicht geladen werden.';
}

export function listeGueltig(daten) {
  return !!daten && typeof daten === 'object' && Array.isArray(daten.geruechte) && !!daten.grenzen
    && daten.geruechte.every((g) => g && Number.isInteger(Number(g.geruecht_id)) && typeof g.status === 'string');
}

export function detailGueltig(daten) {
  return !!daten && typeof daten === 'object' && Number.isInteger(Number(daten.geruecht_id))
    && typeof daten.status === 'string' && Array.isArray(daten.meldungen) && Array.isArray(daten.historie);
}
