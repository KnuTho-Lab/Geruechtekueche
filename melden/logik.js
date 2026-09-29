// Reine Logik der Meldungsseite, ohne DOM. Getestet in tests/melden/logik.test.mjs.

export const MAX_ZEICHEN = 2000;
export const MAX_VERLAUF = 100;
// Supabase Auth kennt nur E-Mail oder Telefon. Die Seite fragt einen Nutzernamen ab und
// meldet sich mit <name>@NUTZER_DOMAIN an. Die Domain gehoert der GitHub-Organisation
// und nimmt keine Mails an; die Konten werden im Dashboard mit Auto Confirm angelegt.
export const NUTZER_DOMAIN = 'knutho-lab.github.io';
const NUTZERNAME_MUSTER = /^[a-z0-9._-]{1,40}$/;
const SCHLUESSEL_SITZUNG = 'gk-sitzung';
const SCHLUESSEL_VERLAUF = 'gk-verlauf';
const ROLLEN = new Set(['nutzer', 'agent', 'hinweis']);

export function nutzernameZuEmail(roh) {
  const name = typeof roh === 'string' ? roh.trim().toLowerCase() : '';
  return NUTZERNAME_MUSTER.test(name) ? `${name}@${NUTZER_DOMAIN}` : null;
}

export function eingabePruefen(roh) {
  const text = typeof roh === 'string' ? roh.trim() : '';
  if (!text) return { ok: false, fehler: 'Bitte schreib zuerst etwas.' };
  if (text.length > MAX_ZEICHEN) {
    return { ok: false, fehler: `Die Nachricht ist zu lang (höchstens ${MAX_ZEICHEN} Zeichen).` };
  }
  return { ok: true, text };
}

// Format des n8n Chat Triggers. Bewusst ohne Nutzer-ID oder E-Mail:
// die sessionId ist zufällig und hängt nicht am Konto.
export function anfrageBauen({ sessionId, text }) {
  return { action: 'sendMessage', sessionId, chatInput: text };
}

export function antwortText(json) {
  if (Array.isArray(json)) return json.length ? antwortText(json[0]) : null;
  if (typeof json === 'string') return json.trim() ? json : null;
  if (!json || typeof json !== 'object') return null;
  for (const feld of ['output', 'text']) {
    const wert = json[feld];
    if (typeof wert === 'string' && wert.trim()) return wert;
  }
  return null;
}

export function fehlerText(status) {
  if (status === 401 || status === 403) return 'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.';
  if (status === 429) return 'Einen Moment bitte, gerade kommen sehr viele Nachrichten an. Versuch es gleich noch einmal.';
  if (status === 502 || status === 503 || status === 504) return 'Der Agent ist gerade nicht erreichbar. Versuch es in ein paar Minuten noch einmal.';
  if (!status) return 'Keine Verbindung. Prüf dein Netz und versuch es noch einmal.';
  return 'Das hat leider nicht geklappt. Versuch es noch einmal.';
}

export function anmeldeFehlerText(fehler) {
  const text = String(fehler?.message ?? '');
  if (/invalid login credentials/i.test(text)) return 'Nutzername oder Passwort stimmen nicht.';
  if (/email not confirmed/i.test(text)) return 'Dieses Konto ist noch nicht freigeschaltet.';
  if (fehler?.status === 429 || /rate limit/i.test(text)) return 'Zu viele Versuche. Bitte versuche es in ein paar Minuten erneut.';
  if (/failed to fetch|network/i.test(text)) return 'Keine Verbindung. Prüf dein Netz und versuch es noch einmal.';
  return 'Die Anmeldung hat nicht geklappt. Versuch es noch einmal.';
}

function lesen(speicher, schluessel) {
  try { return speicher ? speicher.getItem(schluessel) : null; } catch { return null; }
}
function schreiben(speicher, schluessel, wert) {
  try { speicher?.setItem(schluessel, wert); } catch { /* Speicher blockiert: Seite läuft ohne weiter */ }
}
function entfernen(speicher, schluessel) {
  try { speicher?.removeItem(schluessel); } catch { /* s. o. */ }
}

export function sitzungLaden(speicher, erzeugen) {
  const vorhanden = lesen(speicher, SCHLUESSEL_SITZUNG);
  if (vorhanden) return vorhanden;
  const neu = erzeugen();
  schreiben(speicher, SCHLUESSEL_SITZUNG, neu);
  return neu;
}

export function sitzungNeu(speicher, erzeugen) {
  entfernen(speicher, SCHLUESSEL_VERLAUF);
  const neu = erzeugen();
  schreiben(speicher, SCHLUESSEL_SITZUNG, neu);
  return neu;
}

export function verlaufLaden(speicher) {
  let daten;
  try { daten = JSON.parse(lesen(speicher, SCHLUESSEL_VERLAUF) ?? '[]'); } catch { return []; }
  if (!Array.isArray(daten)) return [];
  return daten
    .filter((e) => e && ROLLEN.has(e.rolle) && typeof e.text === 'string')
    .map(({ rolle, text }) => ({ rolle, text }))
    .slice(-MAX_VERLAUF);
}

export function verlaufSpeichern(speicher, verlauf) {
  schreiben(speicher, SCHLUESSEL_VERLAUF, JSON.stringify(verlauf.slice(-MAX_VERLAUF)));
}
