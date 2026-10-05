// GET /statistik?wochen=12: Kennzahlen fuers Dashboard (dashboard-k/) als ein JSON.
// - Nur angemeldete Nutzer: das Supabase-Login-Token wird hier geprueft (verify_jwt ist aus,
//   damit auch der CORS-Preflight ohne Token durchkommt), wie bei agent-chat.
// - Die Zahlen rechnet die SQL-Funktion dashboard_statistik, hier steckt keine Fachlogik.
//   Das Ergebnis enthaelt nur Zaehlungen, nie Meldungstexte oder Kennungen.
// - Ins Log kommen nur Status und Dauer, nie der Nutzer.
import { db } from "../_shared/db.ts";
import { bearerToken, corsHeader } from "../_shared/chat_logik.ts";
import { parseWochen } from "../_shared/statistik_logik.ts";

function antwort(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}

async function bearbeite(req: Request, cors: Record<string, string>): Promise<Response> {
  if (req.method !== "GET") return antwort(405, { fehler: ["Nur GET ist erlaubt"] }, cors);

  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return antwort(401, { fehler: ["Nicht angemeldet"] }, cors);
  const { data: nutzer, error: authFehler } = await db().auth.getUser(token);
  if (authFehler || !nutzer?.user) return antwort(401, { fehler: ["Anmeldung ungültig oder abgelaufen"] }, cors);

  const wochen = parseWochen(new URL(req.url).searchParams.get("wochen"));
  if (!wochen.ok) return antwort(400, { fehler: wochen.fehler }, cors);

  const { data, error } = await db().rpc("dashboard_statistik", { p_wochen: wochen.wert });
  if (error) {
    console.error("statistik: Abfrage fehlgeschlagen:", error.message);
    return antwort(500, { fehler: ["Die Statistik konnte nicht berechnet werden"] }, cors);
  }
  return antwort(200, data, cors);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeader(origin, "GET, OPTIONS");
  // Browser-Aufrufe nur von der eigenen Seite. Ohne Origin (curl, Server) ist es kein Browser,
  // das Login-Token wird trotzdem geprueft.
  if (origin && !cors) return new Response("Origin nicht erlaubt", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors ?? {} });

  const start = performance.now();
  let res: Response;
  try {
    res = await bearbeite(req, cors ?? {});
  } catch (e) {
    console.error("statistik: interner Fehler", e instanceof Error ? e.message : "");
    res = antwort(500, { fehler: ["Interner Fehler"] }, cors ?? {});
  }
  console.log(JSON.stringify({ log: "statistik", status: res.status, dauer_ms: Math.round(performance.now() - start) }));
  return res;
});
