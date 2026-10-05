// Tests fuer die Logik der Functions arbeitsbereich und arbeitsbereich_status (ohne Netzwerk).
// Ausfuehren: deno test --allow-read supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  bearbeiterName,
  BEARBEITER,
  NUTZER_DOMAIN,
  statusErgebnisZuHttp,
  validiereStatusAnfrage,
} from "../_shared/arbeitsbereich_logik.ts";
import { STATUS_WERTE } from "../_shared/logik.ts";

Deno.test("bearbeiterName: nur knut und thomas mit der festen Domain", () => {
  assertEquals(bearbeiterName(`knut@${NUTZER_DOMAIN}`), "knut");
  assertEquals(bearbeiterName(`thomas@${NUTZER_DOMAIN}`), "thomas");
  assertEquals(bearbeiterName(`KNUT@${NUTZER_DOMAIN}`), "knut");
  assertEquals(bearbeiterName(`  Thomas@${NUTZER_DOMAIN} `), "thomas");
  assertEquals([...BEARBEITER], ["knut", "thomas"]);
});

Deno.test("bearbeiterName: andere Konten, fremde Domain und Tricks werden abgelehnt", () => {
  for (const email of [
    `max@${NUTZER_DOMAIN}`,
    "knut@evil.example",
    `knut@${NUTZER_DOMAIN}.evil.example`,
    `knut@evil.example@${NUTZER_DOMAIN}`,
    `knut+x@${NUTZER_DOMAIN}`,
    `knut2@${NUTZER_DOMAIN}`,
    `xknut@${NUTZER_DOMAIN}`,
    "knut",
    "",
    "@",
  ]) {
    assertEquals(bearbeiterName(email), null, email);
  }
  assertEquals(bearbeiterName(null), null);
  assertEquals(bearbeiterName(undefined), null);
  assertEquals(bearbeiterName(42 as unknown as string), null);
});

Deno.test("validiereStatusAnfrage: gueltige Anfragen mit und ohne erwartet", () => {
  assertEquals(validiereStatusAnfrage({ geruecht_id: 12, status: "bestätigt", erwartet: "offen" }), {
    ok: true,
    wert: { geruecht_id: 12, status: "bestätigt", erwartet: "offen" },
  });
  assertEquals(validiereStatusAnfrage({ geruecht_id: 1, status: "nicht prüfbar" }), {
    ok: true,
    wert: { geruecht_id: 1, status: "nicht prüfbar", erwartet: null },
  });
  assertEquals(validiereStatusAnfrage({ geruecht_id: 1, status: "offen", erwartet: null }).ok, true);
  for (const s of STATUS_WERTE) assert(validiereStatusAnfrage({ geruecht_id: 5, status: s }).ok, s);
});

Deno.test("validiereStatusAnfrage: ungueltige Anfragen nennen jeden Fehler", () => {
  const schlecht: unknown[] = [
    null, "text", [], 5,
    {},
    { geruecht_id: 0, status: "offen" },
    { geruecht_id: -3, status: "offen" },
    { geruecht_id: 1.5, status: "offen" },
    { geruecht_id: "12", status: "offen" },
    { geruecht_id: Number.MAX_SAFE_INTEGER + 2, status: "offen" },
    { geruecht_id: 1, status: "erledigt" },
    { geruecht_id: 1, status: "OFFEN" },
    { geruecht_id: 1 },
    { geruecht_id: 1, status: "offen", erwartet: "egal" },
    { geruecht_id: 1, status: "offen", erwartet: 3 },
    { geruecht_id: 1, status: "offen", von: "thomas" },
    { geruecht_id: 1, status: "offen", user: "knut" },
  ];
  for (const body of schlecht) {
    const r = validiereStatusAnfrage(body);
    assert(!r.ok, JSON.stringify(body));
    if (!r.ok) assert(r.fehler.length > 0);
  }
  const mehrere = validiereStatusAnfrage({ geruecht_id: 0, status: "x" });
  assert(!mehrere.ok && mehrere.fehler.length === 2, "beide Fehler werden genannt");
});

Deno.test("validiereStatusAnfrage: der Bearbeiter kommt nie aus dem Body", () => {
  const r = validiereStatusAnfrage({ geruecht_id: 1, status: "offen", geaendert_von: "thomas" });
  assert(!r.ok);
});

Deno.test("statusErgebnisZuHttp: jedes Ergebnis der SQL-Funktion hat einen eigenen HTTP-Status", () => {
  assertEquals(statusErgebnisZuHttp({ ergebnis: "ok", status: "bestätigt", vorher: "offen" }), {
    status: 200,
    body: { ergebnis: "ok", status: "bestätigt", vorher: "offen" },
  });
  assertEquals(statusErgebnisZuHttp({ ergebnis: "unveraendert", status: "offen" }).status, 200);
  const konflikt = statusErgebnisZuHttp({ ergebnis: "konflikt", status: "widerlegt" });
  assertEquals(konflikt.status, 409);
  assertEquals(konflikt.body.aktuell, "widerlegt");
  assertEquals(statusErgebnisZuHttp({ ergebnis: "nicht_gefunden" }).status, 404);
  assertEquals(statusErgebnisZuHttp({ ergebnis: "komisch" }).status, 500);
  assertEquals(statusErgebnisZuHttp(null).status, 500);
});
