// Statistik-Dashboard der Gerüchteküche. Login per Supabase Auth (wie melden/), die Zahlen kommen
// von der Edge Function statistik, die nur Zählungen liefert. Kein Schlüssel für Tabellen im
// Browser: der öffentliche Schlüssel öffnet ohne Login nichts.
import { supabase, funktion } from './api.js';
import { aktiviereArbeit, leereArbeit } from './arbeit.js';
import { nutzernameZuEmail, anmeldeFehlerText } from '../melden/logik.js';
import {
  RISIKO_STUFEN, STANDARD_GRENZEN,
  prozent, trendInfo, datumKurz, heatmapWochen, heatStufe, kategorieZeilen,
  zahl, dezimal, prozentText, abweisungsName, statistikFehlerText, statistikGueltig,
} from './logik.js';

const KONFIG = {
  funktion: 'statistik',
  wochen: 12,
  autoAktualisierenMs: 120000,
};

// Nur lokale Vorschau: ?demo zeigt erfundene Zahlen ohne Login, ?demo=leer eine leere Datenbank.
// Auf der echten Seite (anderer Hostname) ist das nie aktiv.
const DEMO = ['localhost', '127.0.0.1'].includes(location.hostname) ? new URLSearchParams(location.search).get('demo') : null;

const $ = (id) => document.getElementById(id);
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const STATUS = [
  { key: 'offen', name: 'offen', farbe: 'var(--c4)' },
  { key: 'bestaetigt', name: 'bestätigt', farbe: 'var(--c2)' },
  { key: 'widerlegt', name: 'widerlegt', farbe: 'var(--c1)' },
  { key: 'nicht_pruefbar', name: 'nicht prüfbar', farbe: 'var(--faint)' },
];
const RISIKO = {
  niedrig: { name: 'niedrig', farbe: 'var(--c5)', symbol: '●' },
  mittel: { name: 'mittel', farbe: 'var(--c3)', symbol: '▲' },
  hoch: { name: 'hoch', farbe: 'var(--crit)', symbol: '■' },
};

let daten = null;
let heatModus = 'tage'; // 'tage' | 'kategorien'
let ladeNummer = 0;
let timer = null;
let tab = 'statistik'; // 'statistik' | 'arbeit'
let veraltet = false; // im Arbeitsbereich wurde ein Status geändert, die Statistik muss neu laden

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tipAttr = (t) => `data-tip="${esc(t)}"`;

// ---------- Ansichten ----------

function zeigeAnmeldung() {
  stopTimer();
  leereArbeit();
  tab = 'statistik';
  $('tab-statistik').setAttribute('aria-selected', 'true');
  $('tab-arbeit').setAttribute('aria-selected', 'false');
  $('statistik').hidden = true;
  $('arbeit').hidden = true;
  $('tabs').hidden = true;
  $('kopf-rechts').hidden = true;
  $('anmeldung').hidden = false;
  $('nutzername').focus();
}

function zeigeApp() {
  $('anmeldung').hidden = true;
  $('statistik').hidden = tab !== 'statistik';
  $('arbeit').hidden = tab !== 'arbeit';
  $('tabs').hidden = false;
  $('kopf-rechts').hidden = false;
}

function wechsleTab(neu) {
  if (neu === tab) return;
  tab = neu;
  for (const [id, name] of [['tab-statistik', 'statistik'], ['tab-arbeit', 'arbeit']]) {
    $(id).setAttribute('aria-selected', String(name === tab));
  }
  zeigeApp();
  if (tab === 'statistik') {
    if (veraltet) { veraltet = false; lade(); }
    startTimer();
  } else {
    stopTimer();
    aktiviereArbeit({ demo: DEMO });
  }
}

function banner(text) {
  const b = $('fehlerbanner');
  b.hidden = !text;
  b.textContent = text || '';
}

// ---------- Laden ----------

async function lade() {
  const nr = ++ladeNummer;
  if (DEMO !== null) {
    const { demoStatistik } = await import('./demo-daten.js');
    daten = demoStatistik({ leer: DEMO === 'leer' });
    zeigeApp();
    zeichne();
    $('stand').textContent = 'Demo-Daten';
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.access_token) return zeigeAnmeldung();
  zeigeApp();
  $('neu-laden').disabled = true;
  try {
    const { status, json } = await funktion(KONFIG.funktion, { query: { wochen: KONFIG.wochen } });
    if (nr !== ladeNummer) return; // eine neuere Abfrage läuft, diese Antwort ist überholt
    if (status === 401) {
      await supabase.auth.signOut();
      return zeigeAnmeldung();
    }
    if (status !== 200) throw Object.assign(new Error('http'), { status });
    if (!statistikGueltig(json)) throw Object.assign(new Error('form'), { status: 502 });
    daten = json;
    banner('');
    zeichne();
    $('stand').textContent = `Stand ${new Date(json.erzeugt_am).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })}`;
  } catch (e) {
    if (nr !== ladeNummer) return;
    banner(daten ? `${statistikFehlerText(e.status ?? 0)} Angezeigt wird der letzte erfolgreiche Stand.` : statistikFehlerText(e.status ?? 0));
    if (!daten) zeichneLeer();
  } finally {
    if (nr === ladeNummer) $('neu-laden').disabled = false;
  }
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => { if (!document.hidden && tab === 'statistik') lade(); }, KONFIG.autoAktualisierenMs);
}
function stopTimer() { if (timer) clearInterval(timer); timer = null; }

// ---------- Zeichnen ----------

function zeichneLeer() {
  $('kpis').innerHTML = [1, 2, 3, 4].map(() => '<div class="card kpi"><div class="label skeleton">Lade</div><div class="wert skeleton">000</div><div class="sub skeleton">Lade</div></div>').join('');
}

function zeichne() {
  const d = daten;
  zeichneKpis(d);
  zeichneHeat(d);
  zeichneStatus(d);
  zeichneRisiko(d);
  zeichneKategorien(d);
  zeichneAbweisungen(d);
  zeichneSystem(d);
}

function zeichneKpis(d) {
  const t = trendInfo(d.meldungen.letzte_7_tage, d.meldungen.schnitt_vorher);
  const pfeil = { auf: '▲', ab: '▼', gleich: '●', neu: '▲', ruhig: '●' }[t.richtung];
  const hochOffen = Number(d.risiko.hoch_offen) || 0;
  const g = d.geruechte;
  $('kpis').innerHTML = `
    <div class="card kpi">
      <div class="label">Meldungen gesamt</div>
      <div class="wert">${zahl(d.meldungen.gesamt)}</div>
      <div class="sub">${zahl(d.meldungen.letzte_7_tage)} in den letzten 7 Tagen</div>
      <span class="chip ${t.richtung === 'auf' || t.richtung === 'neu' ? 'auf' : ''}"><span aria-hidden="true">${pfeil}</span>${esc(t.text)}</span>
    </div>
    <div class="card kpi">
      <div class="label">Gerüchte offen</div>
      <div class="wert">${zahl(g.offen)}</div>
      <div class="sub">${zahl(g.bearbeitet)} bearbeitet von ${zahl(g.gesamt)} Gerüchten</div>
    </div>
    <div class="card kpi ${hochOffen > 0 ? 'alarm' : 'ruhig'}">
      <div class="label">${hochOffen > 0 ? '■' : '✓'} Hohes Risiko, noch offen</div>
      <div class="wert">${zahl(hochOffen)}</div>
      <div class="sub">${hochOffen > 0 ? `Risiko ab ${dezimal(d.grenzen.hoch, 2)}, noch nicht bearbeitet` : 'Nichts Dringendes offen'}</div>
    </div>
    <div class="card kpi">
      <div class="label">Abgewiesene Eingaben</div>
      <div class="wert">${zahl(d.abweisungen.gesamt)}</div>
      <div class="sub">${prozentText(d.abweisungen.quote)} aller Eingaben</div>
    </div>`;
}

// --- Heatmap ---

function zeichneHeat(d) {
  const wochen = heatmapWochen(d.heatmap.tage);
  const modus = heatModus;
  const kopf = `
    <div class="heat-kopf">
      <div>
        <h3>Meldungen pro Woche</h3>
        <p class="hint">${modus === 'tage' ? 'Je Tag, letzte' : 'Je Thema, letzte'} ${wochen.length} Wochen. Dunkler heißt mehr Meldungen.</p>
      </div>
      <div class="umschalter" role="group" aria-label="Heatmap-Ansicht">
        <button type="button" data-modus="tage" aria-pressed="${modus === 'tage'}">Wochentage</button>
        <button type="button" data-modus="kategorien" aria-pressed="${modus === 'kategorien'}">Themen</button>
      </div>
    </div>`;
  const skala = `<div class="skala" aria-hidden="true">weniger ${[0, 1, 2, 3, 4].map((s) => `<span class="zelle h${s}"></span>`).join('')} mehr</div>`;
  $('heat-karte').innerHTML = kopf + (modus === 'tage' ? heatTage(wochen) : heatKategorien(d, wochen)) + skala;
  $('heat-karte').querySelectorAll('[data-modus]').forEach((b) => b.addEventListener('click', () => {
    heatModus = b.dataset.modus;
    zeichneHeat(daten);
  }));
}

function heatTage(wochen) {
  const max = Math.max(0, ...wochen.flatMap((w) => w.zellen.map((z) => (z ? z.anzahl : 0))));
  const spalten = `grid-template-columns: 30px repeat(${wochen.length}, minmax(0, 1fr));`;
  let html = `<div class="heat-scroll"><div class="heat" style="${spalten}" role="table" aria-label="Meldungen je Tag und Woche">`;
  html += '<div></div>' + wochen.map((w) => `<div class="kw">KW ${w.kw}</div>`).join('');
  for (let r = 0; r < 7; r++) {
    html += `<div class="tag">${WOCHENTAGE[r]}</div>`;
    for (const w of wochen) {
      const z = w.zellen[r];
      if (!z) { html += '<div class="zelle leer"></div>'; continue; }
      const n = z.anzahl;
      html += `<div class="zelle h${heatStufe(n, max)}" ${tipAttr(`${WOCHENTAGE[r]} ${datumKurz(z.tag)}: ${n} ${n === 1 ? 'Meldung' : 'Meldungen'}`)} role="cell" aria-label="${esc(WOCHENTAGE[r])} ${esc(datumKurz(z.tag))}: ${n}">${n > 0 && wochen.length <= 14 ? n : ''}</div>`;
    }
  }
  html += '<div class="tag" style="font-weight:600">Summe</div>' + wochen.map((w) => `<div class="summe" ${tipAttr(`KW ${w.kw} ab ${datumKurz(w.start)}: ${w.summe} Meldungen`)}>${w.summe}</div>`).join('');
  return html + '</div></div>';
}

function heatKategorien(d, wochen) {
  const starts = wochen.map((w) => w.start);
  const zeilen = kategorieZeilen(d.heatmap.kategorien, starts);
  if (!zeilen.length) return '<p class="leer-hinweis">In diesem Zeitraum gibt es keine Meldungen.</p>';
  const max = Math.max(...zeilen.flatMap((z) => z.wochen));
  const spalten = `grid-template-columns: minmax(110px, 26%) repeat(${wochen.length}, minmax(0, 1fr));`;
  let html = `<div class="heat-scroll"><div class="heat hk" style="${spalten}" role="table" aria-label="Meldungen je Thema und Woche">`;
  html += '<div></div>' + wochen.map((w) => `<div class="kw">KW ${w.kw}</div>`).join('');
  for (const z of zeilen) {
    html += `<div class="zeile" ${tipAttr(`${z.kategorie}: ${z.summe} Meldungen im Zeitraum`)}>${esc(z.kategorie)}</div>`;
    z.wochen.forEach((n, i) => {
      html += `<div class="zelle h${heatStufe(n, max)}" ${tipAttr(`${z.kategorie}, KW ${wochen[i].kw}: ${n} ${n === 1 ? 'Meldung' : 'Meldungen'}`)} role="cell" aria-label="${esc(z.kategorie)} KW ${wochen[i].kw}: ${n}">${n > 0 && wochen.length <= 14 ? n : ''}</div>`;
    });
  }
  html += '<div class="zeile" style="font-weight:600">Summe</div>' + wochen.map((w) => `<div class="summe">${w.summe}</div>`).join('');
  return html + '</div></div>';
}

// --- Status und Risiko ---

function stapel(teile, gesamt) {
  if (!gesamt) return '<div class="gestapelt"><i style="flex:1;background:var(--skeleton)"></i></div>';
  return `<div class="gestapelt" role="img" aria-label="${esc(teile.map((t) => `${t.name} ${t.n}`).join(', '))}">${teile.filter((t) => t.n > 0)
    .map((t) => `<i style="flex:${t.n};background:${t.farbe}" ${tipAttr(`${t.name}: ${t.n} (${prozent(t.n, gesamt)} %)`)}></i>`).join('')}</div>`;
}

function zeichneStatus(d) {
  const g = d.geruechte;
  const teile = STATUS.map((s) => ({ ...s, n: Number(g[s.key]) || 0 }));
  $('status-karte').innerHTML = `
    <h3>Offen und bearbeitet</h3>
    <p class="hint">${zahl(g.gesamt)} Gerüchte, bearbeitet heißt Status nicht mehr offen.</p>
    <div style="display:flex;gap:28px;margin-bottom:14px;flex-wrap:wrap">
      <div><div class="sys-wert">${zahl(g.offen)}</div><div class="hint" style="margin:0">offen (${prozent(g.offen, g.gesamt)} %)</div></div>
      <div><div class="sys-wert">${zahl(g.bearbeitet)}</div><div class="hint" style="margin:0">bearbeitet (${prozent(g.bearbeitet, g.gesamt)} %)</div></div>
    </div>
    ${stapel(teile, g.gesamt)}
    <div class="legende">${teile.map((t) => `<span><i class="punkt" style="background:${t.farbe}"></i>${esc(t.name)} <b>${zahl(t.n)}</b></span>`).join('')}</div>`;
}

function zeichneRisiko(d) {
  const r = d.risiko;
  const grenzen = d.grenzen ?? STANDARD_GRENZEN;
  const stufen = RISIKO_STUFEN.map((k) => ({ k, n: Number(r[k]) || 0 }));
  const bewertet = stufen.reduce((s, x) => s + x.n, 0);
  const max = Math.max(1, ...stufen.map((x) => x.n));
  const bereich = { niedrig: `unter ${dezimal(grenzen.mittel, 2)}`, mittel: `${dezimal(grenzen.mittel, 2)} bis unter ${dezimal(grenzen.hoch, 2)}`, hoch: `ab ${dezimal(grenzen.hoch, 2)}` };
  $('risiko-karte').innerHTML = `
    <h3>Risikobewertung</h3>
    <p class="hint">${zahl(bewertet)} bewertete Gerüchte in drei Stufen.</p>
    ${[...stufen].reverse().map(({ k, n }) => `
      <div class="balken-zeile" ${tipAttr(`${RISIKO[k].name}: ${n} (${prozent(n, bewertet)} % der bewerteten)`)}>
        <div class="name"><span aria-hidden="true" style="color:${RISIKO[k].farbe}">${RISIKO[k].symbol}</span> ${RISIKO[k].name} <span style="color:var(--muted)">${bereich[k]}</span></div>
        <div class="spur"><i style="width:${(n / max) * 100}%;background:${RISIKO[k].farbe}"></i></div>
        <div class="zahl">${zahl(n)}</div>
      </div>`).join('')}
    <p class="fussnote">${Number(r.ohne_wert) > 0 ? `${zahl(r.ohne_wert)} Gerüchte noch ohne Risikowert (nicht klassifiziert oder Modell wartet).` : 'Alle Gerüchte haben einen Risikowert.'}</p>`;
}

// --- Kategorien und Abweisungen ---

function balken(zeilen, farbe, leer) {
  const max = Math.max(1, ...zeilen.map((z) => z.n));
  if (!zeilen.length) return `<p class="leer-hinweis">${leer}</p>`;
  return zeilen.map((z) => `
    <div class="balken-zeile" ${tipAttr(`${z.name}: ${z.n}`)}>
      <div class="name" title="${esc(z.name)}">${esc(z.name)}</div>
      <div class="spur"><i style="width:${(z.n / max) * 100}%;background:${farbe}"></i></div>
      <div class="zahl">${zahl(z.n)}</div>
    </div>`).join('');
}

function zeichneKategorien(d) {
  const zeilen = d.kategorien.map((k) => ({ name: k.name, n: Number(k.anzahl) || 0 }));
  const v = d.verbreitung;
  $('kategorie-karte').innerHTML = `
    <h3>Gerüchte nach Thema</h3>
    <p class="hint">Hauptkategorie je Gerücht, alle Themen.</p>
    ${balken(zeilen, 'var(--c2)', 'Noch keine Themen vorhanden.')}
    <p class="fussnote">Meldungen pro Gerücht: Median ${dezimal(v.median)}, Maximum ${zahl(v.maximum)}.</p>`;
}

function zeichneAbweisungen(d) {
  const a = d.abweisungen;
  const zeilen = a.gruende.map((g) => ({ name: abweisungsName(g.grund), n: Number(g.anzahl) || 0 }));
  $('abweisung-karte').innerHTML = `
    <h3>Abgewiesene Eingaben</h3>
    <p class="hint">${zahl(a.gesamt)} Eingaben, ${prozentText(a.quote)} von allen Eingaben. Gespeichert wird nur der Grund, nie der Text.</p>
    ${balken(zeilen, 'var(--c4)', 'Keine Abweisungen.')}`;
}

// --- System ---

function zeichneSystem(d) {
  const s = d.system;
  const quote = (Number(s.aufrufe_7d) || 0) === 0 ? 0 : (Number(s.fehler_7d) || 0) / Number(s.aufrufe_7d);
  const kachel = (label, wert, warn, hint) => `
    <div class="card kpi"><div class="label">${label}</div><div class="sys-wert ${warn ? 'warn' : ''}">${wert}</div><div class="sub">${hint}</div></div>`;
  $('system-kacheln').innerHTML = [
    kachel('Aufrufe', zahl(s.aufrufe_7d), false, 'letzte 7 Tage'),
    kachel('Fehlerquote', prozentText(quote), quote > 0.05, `${zahl(s.fehler_7d)} Serverfehler (ab 500), dazu ${zahl(s.anfragefehler_7d)} Anfragefehler (4xx)`),
    kachel('Antwortzeit', `${zahl(s.antwortzeit_median_ms)} ms`, false, 'Median, 7 Tage'),
    kachel('Rate-Limit', zahl(s.rate_limit_7d), Number(s.rate_limit_7d) > 0, 'Treffer, 7 Tage'),
    kachel('Hängende', zahl(s.haengende), Number(s.haengende) > 0, 'Klassifizierungen > 10 Min.'),
    kachel('Risiko-Queue', zahl(s.risiko_queue), false, 'warten auf Risikowert'),
  ].join('');

  const max = Math.max(1, ...s.tage.map((t) => Number(t.aufrufe) || 0));
  $('system-verlauf').innerHTML = `
    <h3>API-Aufrufe pro Tag</h3>
    <p class="hint">Letzte ${s.tage.length} Tage, <span style="color:var(--crit)">rot</span> der Anteil mit Serverfehlern (Status ab 500).</p>
    <div class="tage-balken" role="img" aria-label="Aufrufe pro Tag">${s.tage.map((t) => {
      const n = Number(t.aufrufe) || 0, f = Math.min(n, Number(t.fehler) || 0);
      const h = (n / max) * 100;
      return `<div class="spalte" ${tipAttr(`${datumKurz(t.tag)}: ${n} Aufrufe, ${f} Fehler`)}>
        ${n ? `<div class="fehler" style="height:${(f / n) * h}%;${f ? '' : 'display:none'}"></div><i class="ok" style="height:${((n - f) / n) * h}%"></i>` : ''}</div>`;
    }).join('')}</div>
    <div class="tage-achse">${s.tage.map((t, i) => `<span>${i % 2 === 0 ? datumKurz(t.tag).slice(0, 5) : ''}</span>`).join('')}</div>`;
}

// ---------- Tooltip ----------

const tip = $('tip');
function tipZeigen(e) {
  const ziel = e.target.closest?.('[data-tip]');
  if (!ziel) return tipVerstecken();
  tip.textContent = ziel.dataset.tip;
  tip.classList.add('sichtbar');
  const breite = tip.offsetWidth, hoehe = tip.offsetHeight;
  const x = Math.min(window.innerWidth - breite - 8, Math.max(8, e.clientX + 12));
  const y = e.clientY + 16 + hoehe > window.innerHeight ? e.clientY - hoehe - 12 : e.clientY + 16;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
function tipVerstecken() { tip.classList.remove('sichtbar'); }
document.addEventListener('pointermove', tipZeigen);
document.addEventListener('pointerdown', tipZeigen);
document.addEventListener('scroll', tipVerstecken, true);
document.addEventListener('pointerleave', tipVerstecken);

// ---------- Anmeldung ----------

$('anmeldeformular').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fehler = $('anmeldefehler');
  fehler.textContent = '';
  const email = nutzernameZuEmail($('nutzername').value);
  const passwort = $('passwort').value;
  if (!email || !passwort) { fehler.textContent = 'Bitte Nutzername und Passwort eingeben.'; return; }
  $('anmelden').disabled = true;
  const { error } = await supabase.auth.signInWithPassword({ email, password: passwort });
  $('anmelden').disabled = false;
  if (error) { fehler.textContent = anmeldeFehlerText(error); return; }
  $('passwort').value = '';
});

$('abmelden').addEventListener('click', async () => {
  daten = null;
  await supabase.auth.signOut();
});
$('neu-laden').addEventListener('click', () => (tab === 'statistik' ? lade() : aktiviereArbeit({ demo: DEMO, neu: true })));
$('tab-statistik').addEventListener('click', () => wechsleTab('statistik'));
$('tab-arbeit').addEventListener('click', () => wechsleTab('arbeit'));
document.addEventListener('geruechte-geaendert', () => { veraltet = true; });
document.addEventListener('visibilitychange', () => { if (!document.hidden && daten && tab === 'statistik' && !$('statistik').hidden) lade(); });

supabase.auth.onAuthStateChange((ereignis, sitzung) => {
  if (DEMO !== null) { if (ereignis === 'INITIAL_SESSION') setTimeout(lade, 0); return; }
  if (ereignis === 'SIGNED_OUT' || !sitzung) { zeigeAnmeldung(); return; }
  if (ereignis === 'SIGNED_IN' || ereignis === 'INITIAL_SESSION') {
    // Aufruf aus dem Callback herausnehmen: supabase-js verbietet weitere Auth-Aufrufe darin.
    setTimeout(() => { if (tab === 'statistik') { lade(); startTimer(); } else { zeigeApp(); } }, 0);
  }
});
