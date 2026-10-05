// Tests fuer die Logik der Function statistik (ohne Netzwerk).
// Ausfuehren: deno test supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import { MAX_WOCHEN, parseWochen, STANDARD_WOCHEN } from "../_shared/statistik_logik.ts";
import { corsHeader } from "../_shared/chat_logik.ts";

Deno.test("parseWochen: ohne Angabe gilt der Standard", () => {
  assertEquals(parseWochen(null), { ok: true, wert: STANDARD_WOCHEN });
  assertEquals(parseWochen(""), { ok: true, wert: STANDARD_WOCHEN });
});

Deno.test("parseWochen: gueltige Werte und die Grenzen 1 und 52", () => {
  assertEquals(parseWochen("1"), { ok: true, wert: 1 });
  assertEquals(parseWochen("8"), { ok: true, wert: 8 });
  assertEquals(parseWochen(String(MAX_WOCHEN)), { ok: true, wert: MAX_WOCHEN });
});

Deno.test("parseWochen: ausserhalb, Dezimal, Text und Sonderschreibweisen werden abgelehnt", () => {
  for (const roh of ["0", "53", "999", "1000", "-1", "1.5", "12abc", "abc", " 12", "0x10", "1e1", "+5"]) {
    const r = parseWochen(roh);
    assert(!r.ok, `${roh} wurde angenommen`);
    if (!r.ok) assert(r.fehler[0].includes("wochen"), roh);
  }
});

Deno.test("corsHeader: eigene Methodenliste fuer GET, Standard bleibt POST", () => {
  assertEquals(corsHeader("https://knutho-lab.github.io", "GET, OPTIONS")?.["Access-Control-Allow-Methods"], "GET, OPTIONS");
  assertEquals(corsHeader("https://knutho-lab.github.io")?.["Access-Control-Allow-Methods"], "POST, OPTIONS");
  assertEquals(corsHeader("https://evil.example", "GET, OPTIONS"), null);
});
