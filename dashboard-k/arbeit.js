// Arbeitsbereich (Tab 2): Gerüchte ansehen, filtern und den Status ändern. Die Daten kommen von
// den Edge Functions arbeitsbereich (lesen) und arbeitsbereich_status (schreiben), beide nur für
// berechtigte Konten. Texte aus Meldungen und Kernaussagen kommen aus freier Eingabe bzw. von
// einem LLM und gehen deshalb nie durch innerHTML, nur durch textContent.
import { supabase, funktion } from './api.js';
import { risikoStufe, STANDARD_GRENZEN } from './logik.js';
import {
  STATUS_WERTE, STANDARD_FILTER,
  sortiereGeruechte, filterGeruechte, kategorienAusListe, zaehleStatus,
  datumZeit, vorZeit, konfidenzText, risikoText, historieText, kurz, meldungenText,
  arbeitFehlerText, listeGueltig, detailGueltig,
} from './arbeit-logik.js';

const $ = (id) => document.getElementById(id);
const STATUS_FARBE = { offen: 'var(--c4)', 'bestätigt': 'var(--c2)', widerlegt: 'var(--c1)', 'nicht prüfbar': 'var(--faint)' };
const RISIKO = {
  niedrig: { symbol: '●', klasse: 'r-niedrig' },
  mittel: { symbol: '▲', klasse: 'r-mittel' },
  hoch: { symbol: '■', klasse: 'r-hoch' },
  ohne: { symbol: '○', klasse: 'r-ohne' },
};

let quelle = null; // echte Functions oder Demo
let liste = [];
let grenzen = STANDARD_GRENZEN;
let filter = { ...STANDARD_FILTER };
let gewaehlt = null; // geruecht_id
let detail = null;
let schreibt = false;
let rueckmeldung = null; // { text, fehler }
let geladen = false;
let listeNr = 0;
let detailNr = 0;
let verdrahtet = false;

// Kleiner DOM-Helfer: Kinder sind Texte (als textContent) oder Elemente.
function h(tag, eigenschaften = {}, ...kinder) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschaften)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kind of kinder.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    el.append(kind.nodeType ? kind : document.createTextNode(String(kind)));
  }
  return el;
}

function banner(text) {
  const b = $('a-banner');
  b.hidden = !text;
  b.textContent = text || '';
}

function statusPunkt(status) {
  return h('i', { class: 'punkt', style: `background:${STATUS_FARBE[status] ?? 'var(--faint)'}`, 'aria-hidden': 'true' });
}

// ---------- Quellen: echt oder Demo ----------

function echteQuelle() {
  return {
    liste: () => funktion('arbeitsbereich'),
    detail: (id) => funktion('arbeitsbereich', { query: { geruecht_id: id } }),
    setze: (id, status, erwartet) => funktion('arbeitsbereich_status', { methode: 'POST', body: { geruecht_id: id, status, erwartet } }),
  };
}

async function demoQuelle() {
  const d = await import('./demo-daten.js');
  const antwort = (json, status = 200) => Promise.resolve({ status, json });
  return {
    liste: () => antwort(d.demoArbeitsliste()),
    detail: (id) => { const x = d.demoDetail(id); return x ? antwort(x) : antwort(null, 404); },
    setze: (id, status, erwartet) => { const r = d.demoStatusSetzen(id, status, erwartet); return antwort(r.body, r.status); },
  };
}

// ---------- Öffentliche Eingänge für app.js ----------

export async function aktiviereArbeit({ demo = null, neu = false } = {}) {
  if (!quelle) quelle = demo !== null ? await demoQuelle() : echteQuelle();
  verdrahten();
  if (!geladen || neu) await ladeListe({ behalteAuswahl: true });
  else zeichneAlles();
}

export function leereArbeit() {
  quelle = null; liste = []; gewaehlt = null; detail = null; geladen = false; rueckmeldung = null; schreibt = false;
  filter = { ...STANDARD_FILTER };
  listeNr++; detailNr++;
  banner('');
  for (const id of ['a-liste', 'a-detail', 'a-status-chips', 'a-zaehler']) { const el = $(id); if (el) el.replaceChildren(); }
}

// ---------- Laden ----------

async function fehlerBehandeln(status, aktion) {
  if (status === 401) { await supabase.auth.signOut(); return; }
  banner(arbeitFehlerText(status, aktion));
}

async function ladeListe({ behalteAuswahl = true } = {}) {
  const nr = ++listeNr;
  $('neu-laden').disabled = true;
  try {
    const { status, json } = await quelle.liste();
    if (nr !== listeNr) return;
    if (status !== 200 || !listeGueltig(json)) {
      await fehlerBehandeln(status === 200 ? 502 : status, 'laden');
      if (!geladen) zeichneAlles();
      return;
    }
    banner('');
    liste = json.geruechte;
    grenzen = json.grenzen ?? STANDARD_GRENZEN;
    geladen = true;
    if (!behalteAuswahl || !liste.some((g) => g.geruecht_id === gewaehlt)) { gewaehlt = null; detail = null; }
    if (gewaehlt === null && window.innerWidth > 900) {
      const erstes = filterGeruechte(sortiereGeruechte(liste), filter, grenzen)[0];
      if (erstes) gewaehlt = erstes.geruecht_id;
    }
    zeichneAlles();
    if (gewaehlt !== null) await ladeDetail(gewaehlt);
  } catch (e) {
    if (nr === listeNr) { banner(arbeitFehlerText(e.status ?? 0)); if (!geladen) zeichneAlles(); }
  } finally {
    if (nr === listeNr) $('neu-laden').disabled = false;
  }
}

async function ladeDetail(id) {
  const nr = ++detailNr;
  try {
    const { status, json } = await quelle.detail(id);
    if (nr !== detailNr) return;
    if (status !== 200 || !detailGueltig(json)) {
      if (status === 404) { banner(arbeitFehlerText(404)); await ladeListe({ behalteAuswahl: false }); return; }
      await fehlerBehandeln(status === 200 ? 502 : status, 'laden');
      return;
    }
    banner('');
    detail = json;
    zeichneDetail();
  } catch (e) {
    if (nr === detailNr) banner(arbeitFehlerText(e.status ?? 0));
  }
}

async function waehle(id, { scrollen = false } = {}) {
  if (id === gewaehlt && detail) return;
  gewaehlt = id;
  detail = null;
  rueckmeldung = null;
  zeichneListe();
  zeichneDetail();
  if (scrollen && window.innerWidth <= 900) $('a-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await ladeDetail(id);
}

async function setzeStatus(neu) {
  if (!detail || schreibt) return;
  const id = detail.geruecht_id;
  schreibt = true;
  rueckmeldung = null;
  zeichneDetail();
  try {
    const { status } = await quelle.setze(id, neu, detail.status);
    if (status === 200) {
      rueckmeldung = { text: `Status auf „${neu}“ gesetzt.`, fehler: false };
      document.dispatchEvent(new CustomEvent('geruechte-geaendert'));
    } else if (status === 401) {
      await supabase.auth.signOut();
      return;
    } else {
      rueckmeldung = { text: arbeitFehlerText(status, 'speichern'), fehler: true };
    }
    // Nach Erfolg und nach Konflikt den echten Stand holen, bei Konflikt sieht man so, was die andere Person gesetzt hat.
    if (status === 200 || status === 409) await Promise.all([ladeListe({ behalteAuswahl: true }), ladeDetail(id)]);
  } catch (e) {
    rueckmeldung = { text: arbeitFehlerText(e.status ?? 0, 'speichern'), fehler: true };
  } finally {
    schreibt = false;
    zeichneDetail();
  }
}

// ---------- Zeichnen ----------

function sichtbar() {
  return filterGeruechte(sortiereGeruechte(liste), filter, grenzen);
}

function zeichneAlles() {
  zeichneFilter();
  zeichneListe();
  zeichneDetail();
}

function zeichneFilter() {
  const z = zaehleStatus(liste);
  const chips = [['alle', 'alle'], ...STATUS_WERTE.map((s) => [s, s])].map(([wert, name]) =>
    h('button', {
      class: 'a-chip', type: 'button', 'aria-pressed': String(filter.status === wert),
      onclick: () => { filter.status = wert; zeichneAlles(); auswahlSichern(); },
    }, name, h('b', { text: String(z[wert] ?? 0) })));
  $('a-status-chips').replaceChildren(...chips);

  const sel = $('a-kategorie');
  const kategorien = kategorienAusListe(liste);
  sel.replaceChildren(h('option', { value: 'alle', text: 'alle' }), ...kategorien.map((k) => h('option', { value: k, text: k })));
  if (!kategorien.includes(filter.kategorie)) filter.kategorie = 'alle';
  sel.value = filter.kategorie;
  $('a-risiko').value = filter.risiko;
  if ($('a-suche').value !== filter.suche) $('a-suche').value = filter.suche;
}

function zeichneListe() {
  const sicht = sichtbar();
  $('a-zaehler').textContent = geladen ? `${sicht.length} von ${liste.length} Gerüchten, dringendste zuerst` : '';
  if (!geladen) { $('a-liste').replaceChildren(h('div', { class: 'a-leer', text: 'Lade …' })); return; }
  if (!sicht.length) {
    $('a-liste').replaceChildren(h('div', { class: 'a-leer', text: liste.length ? 'Keine Gerüchte passen zum Filter.' : 'Noch keine Gerüchte vorhanden.' }));
    return;
  }
  $('a-liste').replaceChildren(...sicht.map((g) => {
    const stufe = risikoStufe(g.risiko, grenzen) ?? 'ohne';
    return h('button', {
      class: `a-eintrag ${RISIKO[stufe].klasse}`, type: 'button', role: 'listitem',
      'aria-current': String(g.geruecht_id === gewaehlt),
      onclick: () => waehle(g.geruecht_id, { scrollen: true }),
    },
    h('div', { class: 'zeile1' },
      h('span', {}, `#${g.geruecht_id} · `, statusPunkt(g.status), ` ${g.status}`),
      h('span', { class: `badge ${stufe === 'hoch' ? 'hoch' : ''}`, title: `Risiko ${stufe}` }, h('span', { 'aria-hidden': 'true', text: RISIKO[stufe].symbol }), ` ${stufe === 'ohne' ? 'ohne Wert' : risikoText(g.risiko)}`)),
    h('div', { class: 'aussage', text: g.kernaussage ? kurz(g.kernaussage, 160) : '(noch ohne Kernaussage)' }),
    h('div', { class: 'meta', text: [g.kategorie ?? 'noch ohne Thema', meldungenText(g.anzahl_meldungen), g.letzte_meldung_am ? `zuletzt ${vorZeit(g.letzte_meldung_am)}` : null].filter(Boolean).join(' · ') }));
  }));
}

function zeichneDetail() {
  const box = $('a-detail');
  if (!geladen) { box.replaceChildren(); return; }
  if (gewaehlt === null) { box.replaceChildren(h('div', { class: 'a-leer', text: 'Wähle links ein Gerücht aus.' })); return; }
  if (!detail || detail.geruecht_id !== gewaehlt) { box.replaceChildren(h('div', { class: 'a-leer', text: 'Lade …' })); return; }
  const d = detail;
  const stufe = risikoStufe(d.risiko, grenzen) ?? 'ohne';

  const klassifizierung = h('dl', { class: 'a-kv' },
    h('dt', { text: 'Thema' }), h('dd', { text: d.kategorie ? `${d.kategorie}${d.kategorie_konfidenz !== null ? ` (${konfidenzText(d.kategorie_konfidenz)})` : ''}` : 'noch nicht klassifiziert' }),
    d.zweitkategorie ? [h('dt', { text: 'Zweitthema' }), h('dd', { text: `${d.zweitkategorie}${d.zweitkategorie_konfidenz !== null ? ` (${konfidenzText(d.zweitkategorie_konfidenz)})` : ''}` })] : null,
    h('dt', { text: 'Risiko' }), h('dd', {}, h('span', { class: `badge ${stufe === 'hoch' ? 'hoch' : ''}` }, h('span', { 'aria-hidden': 'true', text: RISIKO[stufe].symbol }), ` ${stufe === 'ohne' ? 'ohne Wert' : `${stufe}, ${risikoText(d.risiko)}`}`)),
    d.kategorie_begruendung ? [h('dt', { text: 'Begründung' }), h('dd', { text: d.kategorie_begruendung })] : null);

  const statusKnoepfe = h('div', { class: 'a-status', role: 'group', 'aria-label': 'Status ändern' },
    STATUS_WERTE.map((s) => h('button', {
      type: 'button', 'aria-pressed': String(s === d.status), disabled: schreibt || s === d.status,
      onclick: () => setzeStatus(s),
    }, statusPunkt(s), ` ${s}`)));

  // replaceChildren nimmt weder null noch verschachtelte Listen: erst flachziehen und leere Einträge entfernen.
  box.replaceChildren(...[
    h('div', { class: 'a-kopfzeile' }, `Gerücht #${d.geruecht_id}`, h('span', { class: 'badge' }, statusPunkt(d.status), ` ${d.status}`), `angelegt ${datumZeit(d.angelegt_am)}`),
    h('h2', { text: d.kernaussage || '(noch ohne Kernaussage)' }),
    klassifizierung,
    d.manuell_pruefen ? h('div', { class: 'a-hinweis', text: 'Die Klassifizierung ist unsicher und sollte von einem Menschen geprüft werden.' }) : null,
    h('h4', { text: 'Status' }),
    statusKnoepfe,
    h('div', { class: `a-rueckmeldung ${rueckmeldung?.fehler ? 'fehler' : ''}`, role: rueckmeldung?.fehler ? 'alert' : 'status', text: schreibt ? 'Speichere …' : (rueckmeldung?.text ?? '') }),
    h('h4', { text: `${meldungenText(d.meldungen.length)}` }),
    d.meldungen.length ? d.meldungen.map((m) => h('div', { class: 'a-meldung' },
      h('div', { class: 'kopf' },
        h('span', { text: datumZeit(m.eingegangen_am) }),
        m.standort ? h('span', { text: `Standort: ${m.standort}` }) : null,
        m.emotion ? h('span', { text: `Stimmung: ${m.emotion}` }) : null,
        m.quellenkette ? h('span', { text: `Quelle: ${m.quellenkette}` }) : null),
      h('p', { text: m.text }))) : h('div', { class: 'a-leer', text: 'Keine Meldungen.' }),
    h('h4', { text: 'Verlauf des Status' }),
    d.historie.length
      ? h('ul', { class: 'a-historie' }, d.historie.map((x) => h('li', {}, h('span', { text: historieText(x) }), h('span', { text: datumZeit(x.geaendert_am), style: 'color:var(--muted)' }))))
      : h('div', { class: 'a-leer', style: 'padding:8px 0;text-align:left', text: 'Der Status wurde noch nie geändert.' }),
  ].flat().filter(Boolean));
}

// Filter ändern darf die Auswahl nicht verlieren, solange das Gerücht noch sichtbar ist; sonst das erste sichtbare wählen.
function auswahlSichern() {
  const sicht = sichtbar();
  if (gewaehlt !== null && sicht.some((g) => g.geruecht_id === gewaehlt)) return;
  if (window.innerWidth > 900 && sicht.length) waehle(sicht[0].geruecht_id);
  else { gewaehlt = null; detail = null; zeichneListe(); zeichneDetail(); }
}

function verdrahten() {
  if (verdrahtet) return;
  verdrahtet = true;
  $('a-risiko').addEventListener('change', (e) => { filter.risiko = e.target.value; zeichneAlles(); auswahlSichern(); });
  $('a-kategorie').addEventListener('change', (e) => { filter.kategorie = e.target.value; zeichneAlles(); auswahlSichern(); });
  let verzug = null;
  $('a-suche').addEventListener('input', (e) => {
    filter.suche = e.target.value;
    clearTimeout(verzug);
    verzug = setTimeout(() => { zeichneFilter(); zeichneListe(); auswahlSichern(); }, 150);
  });
  $('a-zuruecksetzen').addEventListener('click', () => { filter = { ...STANDARD_FILTER }; zeichneAlles(); auswahlSichern(); });
}
