// Gemeinsamer Rahmen jeder Edge Function: Methode pruefen, API-Schluessel pruefen,
// Fehler abfangen, JSON antworten, jeden Aufruf protokollieren.
import { db } from "./db.ts";
import { baueAufrufProtokoll, pruefeApiKey, sollInDbProtokolliertWerden } from "./logik.ts";

export function json(status: number, body: unknown, header: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...header },
  });
}

type Handler = (req: Request) => Promise<Response> | Response;

async function bearbeite(req: Request, methode: "GET" | "POST", handler: Handler): Promise<Response> {
  if (req.method !== methode) {
    return json(405, { fehler: [`Nur ${methode} ist erlaubt, nicht ${req.method}`] });
  }
  if (!pruefeApiKey(req.headers.get("x-api-key"), Deno.env.get("GERUECHTE_API_KEY"))) {
    return json(401, { fehler: ["Header 'x-api-key' fehlt oder ist falsch"] });
  }
  try {
    return await handler(req);
  } catch (e) {
    console.error(e);
    return json(500, { fehler: ["Interner Fehler, Details im Function-Log"] });
  }
}

// Eine JSON-Zeile ins Function-Log (immer) und ein Eintrag in api_aufrufe (nur Aufrufe mit
// gueltigem Schluessel). Das Protokoll darf nie die Antwort verhindern.
async function protokolliere(req: Request, status: number, dauerMs: number): Promise<void> {
  const eintrag = baueAufrufProtokoll(new URL(req.url).pathname, req.method, status, dauerMs);
  console.log(JSON.stringify({ log: "api_aufruf", ...eintrag }));
  if (!sollInDbProtokolliertWerden(status)) return;
  try {
    const { error } = await db().from("api_aufrufe").insert(eintrag);
    if (error) console.error("Aufruf-Protokoll nicht gespeichert:", error.message);
  } catch (e) {
    console.error("Aufruf-Protokoll nicht gespeichert:", e);
  }
}

export function endpunkt(methode: "GET" | "POST", handler: Handler): (req: Request) => Promise<Response> {
  return async (req) => {
    const start = performance.now();
    const antwort = await bearbeite(req, methode, handler);
    await protokolliere(req, antwort.status, performance.now() - start);
    return antwort;
  };
}
