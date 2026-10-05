// Gemeinsamer Rahmen der Dashboard-Functions mit Login (arbeitsbereich, arbeitsbereich_status):
// CORS nur für die eigene Seite, Login-Token prüfen, nur berechtigte Konten durchlassen.
// verify_jwt ist bei diesen Functions aus, damit der CORS-Preflight ohne Token durchkommt.
import { db } from "./db.ts";
import { bearerToken, corsHeader } from "./chat_logik.ts";
import { bearbeiterName } from "./arbeitsbereich_logik.ts";

export function antwort(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}

type Pruefung = { ok: true; name: string } | { ok: false; res: Response };

// 401 ohne gültiges Login, 403 mit gültigem Login eines nicht berechtigten Kontos.
export async function pruefeBearbeiter(req: Request, cors: Record<string, string>): Promise<Pruefung> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return { ok: false, res: antwort(401, { fehler: ["Nicht angemeldet"] }, cors) };
  const { data, error } = await db().auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, res: antwort(401, { fehler: ["Anmeldung ungültig oder abgelaufen"] }, cors) };
  }
  const name = bearbeiterName(data.user.email);
  if (!name) return { ok: false, res: antwort(403, { fehler: ["Dieses Konto darf den Arbeitsbereich nicht nutzen"] }, cors) };
  return { ok: true, name };
}

// Rahmen: Origin-Prüfung, Preflight, Fehlerfang, ein Logeintrag mit Status und Dauer (nie Nutzer oder Inhalt).
export function mitLogin(
  logName: string,
  methode: "GET" | "POST",
  handler: (req: Request, cors: Record<string, string>, bearbeiter: string) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get("origin");
    const cors = corsHeader(origin, `${methode}, OPTIONS`);
    // Browser-Aufrufe nur von der eigenen Seite. Ohne Origin (curl, Server) ist es kein Browser,
    // das Login-Token wird trotzdem geprüft.
    if (origin && !cors) return new Response("Origin nicht erlaubt", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors ?? {} });

    const start = performance.now();
    let res: Response;
    try {
      if (req.method !== methode) {
        res = antwort(405, { fehler: [`Nur ${methode} ist erlaubt`] }, cors ?? {});
      } else {
        const p = await pruefeBearbeiter(req, cors ?? {});
        res = p.ok ? await handler(req, cors ?? {}, p.name) : p.res;
      }
    } catch (e) {
      console.error(`${logName}: interner Fehler`, e instanceof Error ? e.message : "");
      res = antwort(500, { fehler: ["Interner Fehler"] }, cors ?? {});
    }
    console.log(JSON.stringify({ log: logName, status: res.status, dauer_ms: Math.round(performance.now() - start) }));
    return res;
  };
}
