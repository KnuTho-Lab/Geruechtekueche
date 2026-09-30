// Tests fuer die reine Logik der Zuordnungs-Pruefung (ohne Datenbank; das Netz wird ueber
// eine eingesetzte fetch-Funktion simuliert).
// Ausfuehren: deno test supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  BEISPIELE_MAX,
  baueMeldungAntwort,
  baueZuordnungsAnfrage,
  entscheideZone,
  type Kandidat,
  KANDIDATEN_MAX,
  kennzahlen,
  leseZuordnungsKonfig,
  NACHHOLEN_MAX,
  NACHHOLEN_STANDARD,
  parseKandidaten,
  parseNachholAnzahl,
  PRUEF_BEGRUENDUNG_MAX,
  rufeZuordnungsWebhook,
  werteZuordnungsAntwortAus,
  ZUORDNUNG_PRUEFEN_AB,
  ZUORDNUNG_SICHER_AB,
  ZUORDNUNG_ZEITLIMIT_MS,
} from "../_shared/zuordnung_logik.ts";

const k = (geruecht_id: number, aehnlichkeit: number, max_aehnlichkeit = aehnlichkeit): Kandidat => ({
  geruecht_id,
  aehnlichkeit,
  max_aehnlichkeit,
  anzahl_meldungen: 1,
});

// --- Konstanten ----------------------------------------------------------------

Deno.test("zonen: Grenzen sind die mit Knut festgelegten Platzhalter", () => {
  assertEquals([ZUORDNUNG_SICHER_AB, ZUORDNUNG_PRUEFEN_AB], [0.95, 0.75]);
  assertEquals([KANDIDATEN_MAX, BEISPIELE_MAX, ZUORDNUNG_ZEITLIMIT_MS], [3, 3, 10000]);
});

// --- parseKandidaten -----------------------------------------------------------

Deno.test("kandidaten: leere Liste ist gueltig, Zeilen werden uebernommen", () => {
  assertEquals(parseKandidaten([]), { ok: true, wert: [] });
  assertEquals(
    parseKandidaten([{ geruecht_id: 7, aehnlichkeit: 0.9, max_aehnlichkeit: 0.95, anzahl_meldungen: 2 }]),
    { ok: true, wert: [{ geruecht_id: 7, aehnlichkeit: 0.9, max_aehnlichkeit: 0.95, anzahl_meldungen: 2 }] },
  );
});

Deno.test("kandidaten: kaputte Formen -> Fehler", () => {
  for (const roh of [null, {}, "x", [null], [{}], [{ geruecht_id: "7", aehnlichkeit: 0.9, max_aehnlichkeit: 0.9, anzahl_meldungen: 1 }],
    [{ geruecht_id: 0, aehnlichkeit: 0.9, max_aehnlichkeit: 0.9, anzahl_meldungen: 1 }],
    [{ geruecht_id: 7, aehnlichkeit: NaN, max_aehnlichkeit: 0.9, anzahl_meldungen: 1 }],
    [{ geruecht_id: 7, aehnlichkeit: 0.9, anzahl_meldungen: 1 }]]) {
    assert(!parseKandidaten(roh).ok, `sollte ungueltig sein: ${JSON.stringify(roh)}`);
  }
});

// --- entscheideZone ------------------------------------------------------------

Deno.test("zone: kein Kandidat -> neu", () => {
  assertEquals(entscheideZone([]), { zone: "neu" });
});

Deno.test("zone: ab 0,95 sicher, die Grenze selbst zaehlt", () => {
  assertEquals(entscheideZone([k(3, 0.95), k(4, 0.9)]), { zone: "sicher", kandidat: k(3, 0.95) });
  assertEquals(entscheideZone([k(3, 0.99)]).zone, "sicher");
});

Deno.test("zone: 0,75 bis unter 0,95 pruefen, mit allen Kandidaten ab 0,75", () => {
  assertEquals(entscheideZone([k(3, 0.949), k(4, 0.8), k(5, 0.7499)]), {
    zone: "pruefen",
    kandidaten: [k(3, 0.949), k(4, 0.8)],
  });
  assertEquals(entscheideZone([k(3, 0.75)]), { zone: "pruefen", kandidaten: [k(3, 0.75)] });
});

Deno.test("zone: unter 0,75 neu, auch wenn die naechste Einzelmeldung sehr aehnlich ist", () => {
  // Average Linkage: der Durchschnitt entscheidet, nicht das Maximum
  assertEquals(entscheideZone([k(3, 0.7499, 0.99)]), { zone: "neu" });
});

Deno.test("zone: sortiert selbst nach Durchschnitt und begrenzt auf KANDIDATEN_MAX", () => {
  const z = entscheideZone([k(1, 0.8), k(2, 0.9), k(3, 0.85), k(4, 0.76)]);
  assertEquals(z, { zone: "pruefen", kandidaten: [k(2, 0.9), k(3, 0.85), k(1, 0.8)] });
  assertEquals(entscheideZone([k(1, 0.8), k(2, 0.96)]).zone, "sicher");
});

Deno.test("zone: eigene Grenzen moeglich (Kalibrieren)", () => {
  assertEquals(entscheideZone([k(3, 0.9)], 0.9, 0.5).zone, "sicher");
  assertEquals(entscheideZone([k(3, 0.6)], 0.9, 0.5).zone, "pruefen");
});

// --- kennzahlen ----------------------------------------------------------------

Deno.test("kennzahlen: beste Einzel- und beste Geruecht-Aehnlichkeit, leer ohne Kandidaten", () => {
  assertEquals(kennzahlen([k(1, 0.8, 0.85), k(2, 0.7, 0.93)]), { beste_aehnlichkeit: 0.93, geruecht_aehnlichkeit: 0.8 });
  assertEquals(kennzahlen([]), { beste_aehnlichkeit: null, geruecht_aehnlichkeit: null });
});

// --- baueZuordnungsAnfrage -----------------------------------------------------

Deno.test("anfrage: Form wie in docs/zuordnung-pruefung.md, ohne Aehnlichkeitswerte, Beispiele begrenzt", () => {
  const a = baueZuordnungsAnfrage({ meldung_id: 234, text: "Vertrieb +7 %" }, [
    { geruecht_id: 104, kernaussage: "Bonus halbiert", beispiele: ["a", "b", "c", "d"] },
    { geruecht_id: 47, kernaussage: null, beispiele: ["e"] },
  ]);
  assertEquals(a, {
    meldung: { meldung_id: 234, text: "Vertrieb +7 %" },
    kandidaten: [
      { geruecht_id: 104, kernaussage: "Bonus halbiert", beispiele: ["a", "b", "c"] },
      { geruecht_id: 47, kernaussage: null, beispiele: ["e"] },
    ],
  });
  assert(!JSON.stringify(a).includes("aehnlichkeit"));
});

// --- werteZuordnungsAntwortAus -------------------------------------------------

Deno.test("antwort: angebotene ID oder null wird uebernommen, Begruendung getrimmt", () => {
  assertEquals(werteZuordnungsAntwortAus(200, '{"geruecht_id": 104, "begruendung": " gleich "}', [104, 47]), {
    ok: true,
    wert: { geruecht_id: 104, begruendung: "gleich" },
  });
  assertEquals(werteZuordnungsAntwortAus(200, '{"geruecht_id": null, "begruendung": "keiner"}', [104]), {
    ok: true,
    wert: { geruecht_id: null, begruendung: "keiner" },
  });
});

Deno.test("antwort: n8n-Liste mit einem Eintrag, fehlende Begruendung und Zusatzfelder sind erlaubt", () => {
  assertEquals(werteZuordnungsAntwortAus(200, '[{"geruecht_id": 47, "extra": 1}]', [104, 47]), {
    ok: true,
    wert: { geruecht_id: 47, begruendung: null },
  });
});

Deno.test("antwort: zu lange Begruendung wird gekuerzt", () => {
  const lang = "x".repeat(PRUEF_BEGRUENDUNG_MAX + 50);
  const e = werteZuordnungsAntwortAus(200, JSON.stringify({ geruecht_id: null, begruendung: lang }), [1]);
  assert(e.ok);
  assertEquals(e.wert.begruendung?.length, PRUEF_BEGRUENDUNG_MAX);
});

Deno.test("antwort: nicht angebotene ID, falscher Typ oder fehlendes Feld -> Fehler", () => {
  for (const roh of [
    '{"geruecht_id": 45, "begruendung": "x"}',
    '{"geruecht_id": "104"}',
    '{"geruecht_id": 104.5}',
    '{"begruendung": "x"}',
    "[]",
    '[{"geruecht_id": 104}, {"geruecht_id": null}]',
    "null",
    "kein json",
    "",
  ]) {
    const e = werteZuordnungsAntwortAus(200, roh, [104]);
    assert(!e.ok, `sollte ungueltig sein: ${roh}`);
  }
});

Deno.test("antwort: Status ausser 200 ist ein Fehler mit dem Status im Text", () => {
  const e = werteZuordnungsAntwortAus(500, '{"geruecht_id": null}', [104]);
  assert(!e.ok);
  assert(e.fehler[0].includes("500"));
});

// --- leseZuordnungsKonfig ------------------------------------------------------

const umgebung = (werte: Record<string, string>) => (name: string) => werte[name];

Deno.test("konfig: URL und Geheimnis noetig, nur https, Zeitlimit mit Standard", () => {
  assertEquals(leseZuordnungsKonfig(umgebung({})), null);
  assertEquals(leseZuordnungsKonfig(umgebung({ ZUORDNUNG_WEBHOOK_URL: "https://x.test/w" })), null);
  assertEquals(
    leseZuordnungsKonfig(umgebung({ ZUORDNUNG_WEBHOOK_URL: "http://x.test/w", ZUORDNUNG_WEBHOOK_SECRET: "g" })),
    null,
  );
  assertEquals(
    leseZuordnungsKonfig(umgebung({ ZUORDNUNG_WEBHOOK_URL: " https://x.test/w ", ZUORDNUNG_WEBHOOK_SECRET: "g" })),
    { url: "https://x.test/w", geheimnis: "g", zeitlimit_ms: ZUORDNUNG_ZEITLIMIT_MS },
  );
});

Deno.test("konfig: Zeitlimit per Secret ueberschreibbar, Unsinn faellt auf den Standard", () => {
  const basis = { ZUORDNUNG_WEBHOOK_URL: "https://x.test/w", ZUORDNUNG_WEBHOOK_SECRET: "g" };
  assertEquals(leseZuordnungsKonfig(umgebung({ ...basis, ZUORDNUNG_TIMEOUT_MS: "15000" }))?.zeitlimit_ms, 15000);
  for (const w of ["abc", "0", "500", "999999", "1.5"]) {
    assertEquals(leseZuordnungsKonfig(umgebung({ ...basis, ZUORDNUNG_TIMEOUT_MS: w }))?.zeitlimit_ms, ZUORDNUNG_ZEITLIMIT_MS, w);
  }
});

// --- rufeZuordnungsWebhook -----------------------------------------------------

const KONFIG = { url: "https://x.test/w", geheimnis: "geheim", zeitlimit_ms: 50 };
const ANFRAGE = baueZuordnungsAnfrage({ meldung_id: 1, text: "t" }, [{ geruecht_id: 104, kernaussage: null, beispiele: ["b"] }]);

Deno.test("webhook: schickt POST mit Geheimnis und JSON, wertet die Antwort aus", async () => {
  let gesehen: { url: string; init: RequestInit } | null = null;
  const abruf = (url: string | URL | Request, init?: RequestInit) => {
    gesehen = { url: String(url), init: init! };
    return Promise.resolve(new Response('{"geruecht_id": 104, "begruendung": "gleich"}', { status: 200 }));
  };
  const e = await rufeZuordnungsWebhook(KONFIG, ANFRAGE, [104], abruf as typeof fetch);
  assertEquals(e, { ok: true, wert: { geruecht_id: 104, begruendung: "gleich" } });
  assertEquals(gesehen!.url, KONFIG.url);
  assertEquals(gesehen!.init.method, "POST");
  const header = new Headers(gesehen!.init.headers);
  assertEquals(header.get("x-webhook-secret"), "geheim");
  assertEquals(header.get("content-type"), "application/json");
  assertEquals(JSON.parse(String(gesehen!.init.body)), ANFRAGE);
});

Deno.test("webhook: Zeitlimit -> Fehler mit Hinweis auf das Zeitlimit", async () => {
  const abruf = (_u: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, nein) => {
      init?.signal?.addEventListener("abort", () => nein(init.signal!.reason));
    });
  const e = await rufeZuordnungsWebhook(KONFIG, ANFRAGE, [104], abruf as typeof fetch);
  assert(!e.ok);
  assert(e.fehler[0].includes("Zeitlimit"), e.fehler[0]);
});

Deno.test("webhook: nicht erreichbar oder Status 500 -> Fehler", async () => {
  const kaputt = () => Promise.reject(new TypeError("dns"));
  const e1 = await rufeZuordnungsWebhook(KONFIG, ANFRAGE, [104], kaputt as unknown as typeof fetch);
  assert(!e1.ok && e1.fehler[0].includes("nicht erreichbar"));
  const fuenfhundert = () => Promise.resolve(new Response("{}", { status: 500 }));
  const e2 = await rufeZuordnungsWebhook(KONFIG, ANFRAGE, [104], fuenfhundert as unknown as typeof fetch);
  assert(!e2.ok && e2.fehler[0].includes("500"));
});

// --- parseNachholAnzahl --------------------------------------------------------

Deno.test("nachholen: ohne Body oder ohne anzahl der Standard, sonst 1 bis NACHHOLEN_MAX", () => {
  assertEquals(parseNachholAnzahl(null), { ok: true, wert: NACHHOLEN_STANDARD });
  assertEquals(parseNachholAnzahl({}), { ok: true, wert: NACHHOLEN_STANDARD });
  assertEquals(parseNachholAnzahl({ anzahl: 1 }), { ok: true, wert: 1 });
  assertEquals(parseNachholAnzahl({ anzahl: NACHHOLEN_MAX }), { ok: true, wert: NACHHOLEN_MAX });
  for (const b of [{ anzahl: 0 }, { anzahl: NACHHOLEN_MAX + 1 }, { anzahl: 1.5 }, { anzahl: "3" }, { x: 1 }, [], "3"]) {
    assert(!parseNachholAnzahl(b).ok, JSON.stringify(b));
  }
});

// --- baueMeldungAntwort --------------------------------------------------------

Deno.test("meldung-antwort: zugeordnet, neu und offen", () => {
  assertEquals(
    baueMeldungAntwort(9, { art: "geprueft", geruecht_id: 104, neues_geruecht: false, geruecht_aehnlichkeit: 0.81 }, null),
    {
      meldung_id: 9, geruecht_id: 104, neues_geruecht: false, zuordnung: "geprueft", zuordnung_offen: false,
      per_embedding_zugeordnet: true, aehnlichkeit: 0.81, embedding_fehler: null,
    },
  );
  const neu = baueMeldungAntwort(9, { art: "neu", geruecht_id: 5, neues_geruecht: true, geruecht_aehnlichkeit: 0.6 }, null);
  assertEquals([neu.per_embedding_zugeordnet, neu.aehnlichkeit, neu.neues_geruecht], [false, null, true]);
  const offen = baueMeldungAntwort(9, { art: "offen", geruecht_id: null, neues_geruecht: false, geruecht_aehnlichkeit: 0.8 }, "x");
  assertEquals([offen.geruecht_id, offen.zuordnung_offen, offen.aehnlichkeit, offen.embedding_fehler], [null, true, null, "x"]);
  const explizit = baueMeldungAntwort(9, { art: "explizit", geruecht_id: 3, neues_geruecht: false, geruecht_aehnlichkeit: null }, null);
  assertEquals([explizit.zuordnung, explizit.per_embedding_zugeordnet], ["explizit", false]);
});
