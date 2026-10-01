// Tests fuer die reine Logik des Risikomodells (ohne Datenbank; das Netz wird ueber eine
// eingesetzte fetch-Funktion simuliert).
// Ausfuehren: deno test supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  leseRisikoKonfig,
  parseRisikoNachholAnzahl,
  RISIKO_NACHHOLEN_MAX,
  RISIKO_NACHHOLEN_STANDARD,
  RISIKO_STATUS_WERTE,
  RISIKO_ZEITLIMIT_MS,
  risikoStatusFuer,
  rufeRisikomodell,
  werteRisikoAntwortAus,
} from "../_shared/risiko_logik.ts";

const KONFIG = { url: "https://modell.example/risiko", token: "geheim", zeitlimit_ms: 5000 };
const antwort = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

// --- Status ------------------------------------------------------------------

Deno.test("risikoStatusFuer: Wert -> berechnet, nichts -> queue, auch bei 0", () => {
  assertEquals(risikoStatusFuer(0.62), "berechnet");
  assertEquals(risikoStatusFuer(0), "berechnet");
  assertEquals(risikoStatusFuer(null), "queue");
});

Deno.test("Statuswerte: drei, wie in der Migration", () => {
  assertEquals([...RISIKO_STATUS_WERTE], ["ausstehend", "berechnet", "queue"]);
});

// --- Body von risiko_nachholen -----------------------------------------------

Deno.test("parseRisikoNachholAnzahl: ohne Body oder ohne Feld die Standardanzahl", () => {
  assertEquals(parseRisikoNachholAnzahl(null), { ok: true, wert: RISIKO_NACHHOLEN_STANDARD });
  assertEquals(parseRisikoNachholAnzahl({}), { ok: true, wert: RISIKO_NACHHOLEN_STANDARD });
  assertEquals(parseRisikoNachholAnzahl({ anzahl: null }), { ok: true, wert: RISIKO_NACHHOLEN_STANDARD });
});

Deno.test("parseRisikoNachholAnzahl: Grenzen 1 bis Maximum", () => {
  assert(parseRisikoNachholAnzahl({ anzahl: 1 }).ok);
  assert(parseRisikoNachholAnzahl({ anzahl: RISIKO_NACHHOLEN_MAX }).ok);
  for (const schlecht of [0, RISIKO_NACHHOLEN_MAX + 1, 1.5, "5", -1]) {
    assert(!parseRisikoNachholAnzahl({ anzahl: schlecht }).ok, String(schlecht));
  }
});

Deno.test("parseRisikoNachholAnzahl: unbekannte Felder und falsche Form -> Fehler", () => {
  assert(!parseRisikoNachholAnzahl({ anzahl: 3, extra: 1 }).ok);
  assert(!parseRisikoNachholAnzahl([]).ok);
  assert(!parseRisikoNachholAnzahl("x").ok);
});

Deno.test("Maximum passt zum Modell-Dienst (50 Texte je Aufruf)", () => {
  assertEquals(RISIKO_NACHHOLEN_MAX, 50);
});

// --- Konfiguration -----------------------------------------------------------

Deno.test("leseRisikoKonfig: URL (https) und Token noetig, Zeitlimit optional und begrenzt", () => {
  const env = (m: Record<string, string>) => (n: string) => m[n];
  assertEquals(leseRisikoKonfig(env({})), null);
  assertEquals(leseRisikoKonfig(env({ RISIKO_URL: "https://a.example/risiko" })), null);
  assertEquals(leseRisikoKonfig(env({ RISIKO_URL: "http://a.example/risiko", RISIKO_TOKEN: "t" })), null);
  assertEquals(leseRisikoKonfig(env({ RISIKO_URL: "https://a.example/risiko", RISIKO_TOKEN: "  " })), null);
  assertEquals(leseRisikoKonfig(env({ RISIKO_URL: " https://a.example/risiko ", RISIKO_TOKEN: " t " })), {
    url: "https://a.example/risiko", token: "t", zeitlimit_ms: RISIKO_ZEITLIMIT_MS,
  });
  const mit = (z: string) => leseRisikoKonfig(env({ RISIKO_URL: "https://a.example/r", RISIKO_TOKEN: "t", RISIKO_TIMEOUT_MS: z }))!;
  assertEquals(mit("8000").zeitlimit_ms, 8000);
  assertEquals(mit("10").zeitlimit_ms, RISIKO_ZEITLIMIT_MS);
  assertEquals(mit("999999").zeitlimit_ms, RISIKO_ZEITLIMIT_MS);
  assertEquals(mit("abc").zeitlimit_ms, RISIKO_ZEITLIMIT_MS);
});

// --- Antwort des Modells -----------------------------------------------------

Deno.test("werteRisikoAntwortAus: gueltige Antwort", () => {
  assertEquals(werteRisikoAntwortAus(200, '{"risiko":[0.04,0.88]}', 2), { ok: true, wert: [0.04, 0.88] });
  assert(werteRisikoAntwortAus(200, '{"risiko":[0,1]}', 2).ok);
});

Deno.test("werteRisikoAntwortAus: jeder Fehlerfall ist ein Fehler mit lesbarem Grund", () => {
  const faelle: [number, string, string][] = [
    [401, "{}", "Token"],
    [429, "{}", "ausgelastet"],
    [503, "{}", "503"],
    [200, "kein json", "JSON"],
    [200, '{"risiko":[0.1]}', "2 Werte"],
    [200, '{"anderes":[0.1,0.2]}', "2 Werte"],
    [200, '{"risiko":[0.1,1.5]}', "außerhalb"],
    [200, '{"risiko":[0.1,"0.5"]}', "außerhalb"],
    [200, "null", "2 Werte"],
  ];
  for (const [status, text, teil] of faelle) {
    const r = werteRisikoAntwortAus(status, text, 2);
    assert(!r.ok, `${status} ${text}`);
    assert(r.fehler[0].includes(teil), `${status} ${text}: ${r.fehler[0]}`);
  }
});

// --- Aufruf ------------------------------------------------------------------

Deno.test("rufeRisikomodell: schickt Bearer-Token und die Texte, liefert die Werte", async () => {
  let gesehen: { url: string; init: RequestInit } | null = null;
  const abruf = ((url: string, init: RequestInit) => {
    gesehen = { url, init };
    return antwort(200, { risiko: [0.5, 0.7] })();
  }) as unknown as typeof fetch;
  const r = await rufeRisikomodell(KONFIG, ["a", "b"], abruf);
  assertEquals(r, { ok: true, wert: [0.5, 0.7] });
  assertEquals(gesehen!.url, KONFIG.url);
  assertEquals(gesehen!.init.method, "POST");
  const kopf = gesehen!.init.headers as Record<string, string>;
  assertEquals(kopf["Authorization"], "Bearer geheim");
  assertEquals(JSON.parse(gesehen!.init.body as string), { texte: ["a", "b"] });
  assert(gesehen!.init.signal instanceof AbortSignal);
});

Deno.test("rufeRisikomodell: nicht erreichbar -> Fehler mit Hinweis auf Rechner oder Container", async () => {
  const abruf = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
  const r = await rufeRisikomodell(KONFIG, ["a"], abruf);
  assert(!r.ok);
  assert(r.fehler[0].includes("nicht erreichbar"));
  assert(r.fehler[0].includes("Container"));
});

Deno.test("rufeRisikomodell: Zeitlimit -> Fehler, der das Limit nennt", async () => {
  const abruf = (() => Promise.reject(new DOMException("t", "TimeoutError"))) as unknown as typeof fetch;
  const r = await rufeRisikomodell(KONFIG, ["a"], abruf);
  assert(!r.ok);
  assert(r.fehler[0].includes("5000"));
});

Deno.test("rufeRisikomodell: HTTP-Fehler und kaputte Antworten sind Fehler, nie ein Wert", async () => {
  for (const [status, body] of [[401, {}], [429, {}], [502, {}], [200, "x"], [200, { risiko: [] }]] as const) {
    const r = await rufeRisikomodell(KONFIG, ["a"], antwort(status, body) as unknown as typeof fetch);
    assert(!r.ok, `${status}`);
  }
});

Deno.test("rufeRisikomodell: das Token steht nie in einer Fehlermeldung", async () => {
  const faelle = [
    antwort(401, {}), antwort(500, "geheim"), antwort(200, "geheim"),
    () => Promise.reject(new TypeError("geheim")),
  ];
  for (const f of faelle) {
    const r = await rufeRisikomodell(KONFIG, ["a"], f as unknown as typeof fetch);
    assert(!r.ok);
    assert(!r.fehler.join(" ").includes("geheim"));
  }
});
