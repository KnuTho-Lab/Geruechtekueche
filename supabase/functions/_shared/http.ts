// Gemeinsamer Rahmen jeder Edge Function: Methode pruefen, API-Schluessel pruefen,
// Fehler abfangen, JSON antworten.
import { pruefeApiKey } from "./logik.ts";

export function json(status: number, body: unknown, header: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...header },
  });
}

type Handler = (req: Request) => Promise<Response> | Response;

export function endpunkt(methode: "GET" | "POST", handler: Handler): (req: Request) => Promise<Response> {
  return async (req) => {
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
  };
}
