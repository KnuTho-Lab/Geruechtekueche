// Reine Logik der Function agent-chat (Proxy zwischen Meldungsseite und Thomas' n8n-Chat).
// Ohne Netzwerk, getestet in tests/chat_logik_test.ts.

export const CHAT_MAX_ZEICHEN = 2000;
export const CHAT_ZEITLIMIT_MS = 55000;

// Nur diese Seiten duerfen die Function aus dem Browser aufrufen.
export const ERLAUBTE_URSPRUENGE = [
  "https://knutho-lab.github.io",
  "http://localhost:8792",
];

export function corsHeader(origin: string | null, methoden = "POST, OPTIONS"): Record<string, string> | null {
  if (!origin || !ERLAUBTE_URSPRUENGE.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methoden,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

export function bearerToken(header: string | null): string | null {
  const treffer = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return treffer ? treffer[1] : null;
}

export type ChatAnfrage = { action: "sendMessage"; sessionId: string; chatInput: string };
type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string[] };

const SITZUNG_MUSTER = /^[A-Za-z0-9-]{8,100}$/;
const ERLAUBTE_FELDER = new Set(["action", "sessionId", "chatInput"]);

// Nimmt genau die drei Felder an, die die Meldungsseite schickt. Alles andere wird
// abgelehnt, damit nie versehentlich Kontodaten zu n8n durchgereicht werden.
export function validiereChatAnfrage(body: unknown): Ergebnis<ChatAnfrage> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, fehler: ["Der Body muss ein JSON-Objekt sein"] };
  }
  const b = body as Record<string, unknown>;
  const fehler: string[] = [];
  for (const feld of Object.keys(b)) {
    if (!ERLAUBTE_FELDER.has(feld)) fehler.push(`Unbekanntes Feld '${feld}'`);
  }
  if (b.action !== "sendMessage") fehler.push("'action' muss 'sendMessage' sein");
  if (typeof b.sessionId !== "string" || !SITZUNG_MUSTER.test(b.sessionId)) {
    fehler.push("'sessionId' muss 8 bis 100 Zeichen aus Buchstaben, Ziffern und '-' haben");
  }
  const text = typeof b.chatInput === "string" ? b.chatInput.trim() : "";
  if (!text) fehler.push("'chatInput' fehlt oder ist leer");
  else if (text.length > CHAT_MAX_ZEICHEN) fehler.push(`'chatInput' ist länger als ${CHAT_MAX_ZEICHEN} Zeichen`);
  if (fehler.length) return { ok: false, fehler };
  return { ok: true, wert: { action: "sendMessage", sessionId: b.sessionId as string, chatInput: text } };
}

export function basicAuth(nutzer: string, passwort: string): string {
  const bytes = new TextEncoder().encode(`${nutzer}:${passwort}`);
  let binaer = "";
  for (const b of bytes) binaer += String.fromCharCode(b);
  return `Basic ${btoa(binaer)}`;
}

function textAus(wert: unknown): string | null {
  if (Array.isArray(wert)) return wert.length ? textAus(wert[0]) : null;
  if (!wert || typeof wert !== "object") return null;
  for (const feld of ["output", "text"]) {
    const t = (wert as Record<string, unknown>)[feld];
    if (typeof t === "string" && t.trim()) return t;
  }
  return null;
}

// Liest die Antwort des n8n Chat Triggers. Antwortmodus "When Last Node Finishes" liefert
// {output: "..."}, der Modus "Streaming" liefert eine Zeile JSON pro Stueck
// ({type: "item", content: "..."}). Beides wird zu einem Text.
export function leseN8nAntwort(roh: string): string | null {
  try {
    return textAus(JSON.parse(roh));
  } catch { /* kein einzelnes JSON, weiter mit Streaming-Format */ }
  let text = "";
  let gefunden = false;
  for (const zeile of roh.split("\n")) {
    if (!zeile.trim()) continue;
    try {
      const stueck = JSON.parse(zeile);
      if (stueck?.type === "item" && typeof stueck.content === "string") {
        text += stueck.content;
        gefunden = true;
      }
    } catch { /* Zeile ueberspringen */ }
  }
  return gefunden && text.trim() ? text : null;
}

export type ChatKonfig = { url: string; nutzer: string; passwort: string };

export function leseChatKonfig(env: (name: string) => string | undefined): ChatKonfig | null {
  const url = env("N8N_CHAT_URL")?.trim();
  const nutzer = env("N8N_CHAT_USER")?.trim();
  const passwort = env("N8N_CHAT_PASSWORD");
  if (!url || !/^https:\/\//.test(url) || !nutzer || !passwort) return null;
  return { url, nutzer, passwort };
}
