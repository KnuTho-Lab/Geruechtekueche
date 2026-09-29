// Meldungsseite der Gerüchteküche: Anmeldung per Supabase Auth, danach Chat mit dem Agenten.
// Der Agent wird nie direkt aus dem Browser angesprochen, sondern über die Edge Function
// KONFIG.agentFunktion. Die prüft das Login und hält die Zugangsdaten zu n8n serverseitig.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  eingabePruefen, anfrageBauen, antwortText, fehlerText, anmeldeFehlerText,
  sitzungLaden, sitzungNeu, verlaufLaden, verlaufSpeichern, nutzernameZuEmail, MAX_ZEICHEN,
} from './logik.js';

const KONFIG = {
  supabaseUrl: 'https://apdwjhufucblzxaoztsv.supabase.co',
  // Öffentlicher Schlüssel, für den Browser gedacht. Öffnet ohne Login nichts:
  // anon/authenticated haben seit 2026-09-26 keine Tabellenrechte.
  supabaseKey: 'sb_publishable_weKrqRKNYmPJmUDdkT8FWg_VCA7wJ1m',
  agentFunktion: 'agent-chat',
  // Auf false setzen, um die Seite ohne Agent zu zeigen (Nachrichten gehen dann nirgendwohin).
  agentVerbunden: true,
  zeitlimitMs: 60000,
};

// Lokaler Begrüßungstext, wird nicht an den Agenten geschickt.
const BEGRUESSUNG = 'Hallo! Erzähl mir in Ruhe, was du gehört hast. Namen brauchst du dabei nicht zu nennen.';

const supabase = createClient(KONFIG.supabaseUrl, KONFIG.supabaseKey);
const speicher = (() => { try { return window.sessionStorage; } catch { return null; } })();
const neueId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const $ = (id) => document.getElementById(id);
const el = {
  anmeldung: $('anmeldung'), chat: $('chat'), abmelden: $('abmelden'),
  anmeldeformular: $('anmeldeformular'), nutzername: $('nutzername'), passwort: $('passwort'),
  anmelden: $('anmelden'), anmeldefehler: $('anmeldefehler'),
  verlauf: $('verlauf'), eingabeformular: $('eingabeformular'), text: $('text'),
  senden: $('senden'), zaehler: $('zaehler'), neu: $('neu'),
  statuspunkt: $('statuspunkt'), statustext: $('statustext'),
};

let sitzungId = sitzungLaden(speicher, neueId);
let verlauf = verlaufLaden(speicher);
let wartet = false;

// ---------- Ansichten ----------

function zeigeAnmeldung() {
  el.chat.hidden = true;
  el.abmelden.hidden = true;
  el.anmeldung.hidden = false;
  el.nutzername.focus();
}

function zeigeChat() {
  el.anmeldung.hidden = true;
  el.chat.hidden = false;
  el.abmelden.hidden = false;
  setzeStatus();
  verlaufZeichnen();
  el.text.focus();
}

function setzeStatus() {
  el.statuspunkt.classList.toggle('aus', !KONFIG.agentVerbunden);
  el.statustext.textContent = KONFIG.agentVerbunden ? 'bereit' : 'noch nicht verbunden';
}

// ---------- Verlauf ----------

function blaseBauen({ rolle, text }) {
  const zeile = document.createElement('div');
  zeile.className = `nachricht ${rolle}`;
  if (rolle === 'agent') {
    const avatar = el.chat.querySelector('.chat-kopf .avatar').cloneNode(true);
    zeile.append(avatar);
  }
  const blase = document.createElement('div');
  blase.className = 'blase';
  blase.textContent = text; // nie innerHTML: Antworten kommen von einem LLM
  zeile.append(blase);
  return zeile;
}

function verlaufZeichnen() {
  el.verlauf.replaceChildren();
  if (!verlauf.length) el.verlauf.append(blaseBauen({ rolle: 'agent', text: BEGRUESSUNG }));
  for (const eintrag of verlauf) el.verlauf.append(blaseBauen(eintrag));
  nachUnten();
}

function hinzufuegen(eintrag) {
  verlauf.push(eintrag);
  verlaufSpeichern(speicher, verlauf);
  el.verlauf.append(blaseBauen(eintrag));
  nachUnten();
}

function nachUnten() {
  requestAnimationFrame(() => { el.verlauf.scrollTop = el.verlauf.scrollHeight; });
}

function tipptAnzeigen(an) {
  el.verlauf.querySelector('.tippt')?.remove();
  if (!an) return;
  const zeile = blaseBauen({ rolle: 'agent', text: '' });
  zeile.classList.add('tippt');
  zeile.querySelector('.blase').append(...[1, 2, 3].map(() => document.createElement('i')));
  zeile.setAttribute('aria-label', 'Der Agent schreibt');
  el.verlauf.append(zeile);
  nachUnten();
}

// ---------- Agent ----------

async function agentFragen(text) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { fehler: fehlerText(401), abgemeldet: true };

  const abbruch = new AbortController();
  const timer = setTimeout(() => abbruch.abort(), KONFIG.zeitlimitMs);
  try {
    const antwort = await fetch(`${KONFIG.supabaseUrl}/functions/v1/${KONFIG.agentFunktion}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: KONFIG.supabaseKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(anfrageBauen({ sessionId: sitzungId, text })),
      signal: abbruch.signal,
    });
    if (!antwort.ok) return { fehler: fehlerText(antwort.status), abgemeldet: antwort.status === 401 };
    const json = await antwort.json().catch(() => null);
    const inhalt = antwortText(json);
    return inhalt ? { text: inhalt } : { fehler: fehlerText(500) };
  } catch (e) {
    return { fehler: e.name === 'AbortError' ? fehlerText(504) : fehlerText(0) };
  } finally {
    clearTimeout(timer);
  }
}

async function senden() {
  if (wartet) return;
  const pruefung = eingabePruefen(el.text.value);
  if (!pruefung.ok) return;

  hinzufuegen({ rolle: 'nutzer', text: pruefung.text });
  el.text.value = '';
  eingabeAnpassen();

  if (!KONFIG.agentVerbunden) {
    hinzufuegen({ rolle: 'hinweis', text: 'Der Agent ist noch nicht angebunden. Deine Nachricht wurde nirgendwohin geschickt.' });
    return;
  }

  wartet = true;
  eingabeAnpassen();
  tipptAnzeigen(true);
  const ergebnis = await agentFragen(pruefung.text);
  tipptAnzeigen(false);
  wartet = false;
  eingabeAnpassen();

  if (ergebnis.text) hinzufuegen({ rolle: 'agent', text: ergebnis.text });
  else hinzufuegen({ rolle: 'hinweis', text: ergebnis.fehler });
  if (ergebnis.abgemeldet) await abmelden();
  el.text.focus();
}

// ---------- Eingabe ----------

function eingabeAnpassen() {
  el.text.style.height = 'auto';
  el.text.style.height = `${Math.min(el.text.scrollHeight, 160)}px`;
  const laenge = el.text.value.length;
  el.senden.disabled = wartet || !el.text.value.trim();
  el.zaehler.textContent = laenge > MAX_ZEICHEN * 0.8 ? `${laenge} / ${MAX_ZEICHEN}` : '';
  el.zaehler.classList.toggle('warn', laenge > MAX_ZEICHEN * 0.95);
}

el.text.addEventListener('input', eingabeAnpassen);
el.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    senden();
  }
});
el.eingabeformular.addEventListener('submit', (e) => { e.preventDefault(); senden(); });

el.neu.addEventListener('click', () => {
  sitzungId = sitzungNeu(speicher, neueId);
  verlauf = [];
  verlaufZeichnen();
  el.text.focus();
});

// ---------- Anmeldung ----------

el.anmeldeformular.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.anmeldefehler.textContent = '';
  const password = el.passwort.value;
  if (!el.nutzername.value.trim() || !password) {
    el.anmeldefehler.textContent = 'Bitte Nutzername und Passwort eingeben.';
    return;
  }
  const email = nutzernameZuEmail(el.nutzername.value);
  if (!email) {
    el.anmeldefehler.textContent = 'Der Nutzername darf nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich enthalten.';
    return;
  }
  el.anmelden.disabled = true;
  el.anmelden.innerHTML = '<span class="spinner" aria-hidden="true"></span> Anmelden …';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  el.anmelden.disabled = false;
  el.anmelden.textContent = 'Anmelden';
  if (error) {
    el.anmeldefehler.textContent = anmeldeFehlerText(error);
    return;
  }
  el.passwort.value = '';
});

async function abmelden() {
  await supabase.auth.signOut();
  // Auf geteilten Geräten soll der nächste Mensch den Verlauf nicht sehen.
  sitzungId = sitzungNeu(speicher, neueId);
  verlauf = [];
}
el.abmelden.addEventListener('click', abmelden);

// Feuert beim Laden (INITIAL_SESSION), bei An-/Abmeldung und bei jedem Token-Refresh.
// Umgeschaltet wird nur, wenn sich der Anmeldezustand wirklich ändert.
let angemeldet = null;
supabase.auth.onAuthStateChange((_ereignis, sitzung) => {
  const jetzt = Boolean(sitzung);
  if (jetzt === angemeldet) return;
  angemeldet = jetzt;
  if (jetzt) zeigeChat();
  else zeigeAnmeldung();
});
