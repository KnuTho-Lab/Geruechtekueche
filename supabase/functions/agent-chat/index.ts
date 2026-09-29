// POST /agent-chat: Proxy von der Meldungsseite (melden/) zu Thomas' n8n-Chat.
// - Nur angemeldete Nutzer: das Supabase-Login-Token wird hier geprueft (verify_jwt ist aus,
//   damit auch der CORS-Preflight ohne Token durchkommt).
// - Die n8n-Zugangsdaten liegen nur als Secrets N8N_CHAT_URL, N8N_CHAT_USER, N8N_CHAT_PASSWORD vor.
// - Anonym: zu n8n gehen nur action, sessionId und chatInput, nie Nutzer-ID oder E-Mail.
//   Ins Log kommen nur Status und Dauer, nie Text oder Nutzer.
import { db } from "../_shared/db.ts";
import {
  basicAuth,
  bearerToken,
  CHAT_ZEITLIMIT_MS,
  corsHeader,
  leseChatKonfig,
  leseN8nAntwort,
  validiereChatAnfrage,
} from "../_shared/chat_logik.ts";

function antwort(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

async function bearbeite(req: Request, cors: Record<string, string>): Promise<Response> {
  if (req.method !== "POST") return antwort(405, { fehler: ["Nur POST ist erlaubt"] }, cors);

  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return antwort(401, { fehler: ["Nicht angemeldet"] }, cors);
  const { data, error } = await db().auth.getUser(token);
  if (error || !data?.user) return antwort(401, { fehler: ["Anmeldung ungültig oder abgelaufen"] }, cors);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return antwort(400, { fehler: ["Der Body ist kein gültiges JSON"] }, cors);
  }
  const eingabe = validiereChatAnfrage(body);
  if (!eingabe.ok) return antwort(400, { fehler: eingabe.fehler }, cors);

  const konfig = leseChatKonfig((n) => Deno.env.get(n));
  if (!konfig) {
    console.error("agent-chat: Secrets N8N_CHAT_URL/USER/PASSWORD fehlen oder sind ungueltig");
    return antwort(503, { fehler: ["Der Agent ist nicht konfiguriert"] }, cors);
  }

  let n8n: Response;
  try {
    n8n = await fetch(konfig.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: basicAuth(konfig.nutzer, konfig.passwort) },
      body: JSON.stringify(eingabe.wert),
      signal: AbortSignal.timeout(CHAT_ZEITLIMIT_MS),
    });
  } catch (e) {
    const zeitlimit = e instanceof DOMException && e.name === "TimeoutError";
    console.error(`agent-chat: n8n ${zeitlimit ? "Zeitlimit" : "nicht erreichbar"}`);
    return antwort(zeitlimit ? 504 : 502, { fehler: ["Der Agent ist gerade nicht erreichbar"] }, cors);
  }
  const roh = await n8n.text();
  if (!n8n.ok) {
    console.error(`agent-chat: n8n antwortet ${n8n.status}`);
    return antwort(502, { fehler: ["Der Agent ist gerade nicht erreichbar"] }, cors);
  }
  const text = leseN8nAntwort(roh);
  if (!text) {
    console.error("agent-chat: n8n-Antwort ohne lesbaren Text");
    return antwort(502, { fehler: ["Der Agent hat keine lesbare Antwort geliefert"] }, cors);
  }
  return antwort(200, { output: text }, cors);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeader(origin);
  // Browser-Aufrufe nur von der eigenen Seite. Ohne Origin (curl, Server) ist es kein Browser,
  // das Login-Token wird trotzdem geprueft.
  if (origin && !cors) return new Response("Origin nicht erlaubt", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors ?? {} });

  const start = performance.now();
  let res: Response;
  try {
    res = await bearbeite(req, cors ?? {});
  } catch (e) {
    console.error("agent-chat: interner Fehler", e instanceof Error ? e.message : "");
    res = antwort(500, { fehler: ["Interner Fehler"] }, cors ?? {});
  }
  console.log(JSON.stringify({ log: "agent_chat", status: res.status, dauer_ms: Math.round(performance.now() - start) }));
  return res;
});
