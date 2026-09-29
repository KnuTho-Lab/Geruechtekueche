// Tests fuer die Logik der Function agent-chat (ohne Netzwerk).
// Ausfuehren: deno test supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  basicAuth,
  bearerToken,
  CHAT_MAX_ZEICHEN,
  corsHeader,
  leseChatKonfig,
  leseN8nAntwort,
  validiereChatAnfrage,
} from "../_shared/chat_logik.ts";

const gueltig = { action: "sendMessage", sessionId: "3f2a9c1e-0000-4000-8000-123456789abc", chatInput: "Werk B schließt" };

Deno.test("corsHeader: erlaubt nur die eigene Pages-Seite und die lokale Vorschau", () => {
  assertEquals(corsHeader("https://knutho-lab.github.io")?.["Access-Control-Allow-Origin"], "https://knutho-lab.github.io");
  assertEquals(corsHeader("http://localhost:8792")?.["Access-Control-Allow-Origin"], "http://localhost:8792");
  assertEquals(corsHeader("https://evil.example"), null);
  assertEquals(corsHeader("https://knutho-lab.github.io.evil.example"), null);
  assertEquals(corsHeader(null), null);
});

Deno.test("corsHeader: erlaubt die Header, die supabase-js und die Seite schicken", () => {
  const h = corsHeader("https://knutho-lab.github.io")!;
  for (const name of ["authorization", "apikey", "content-type"]) {
    assert(h["Access-Control-Allow-Headers"].includes(name), name);
  }
  assert(h["Access-Control-Allow-Methods"].includes("POST"));
});

Deno.test("bearerToken: liest das Token, sonst null", () => {
  assertEquals(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assertEquals(bearerToken("bearer   xyz"), "xyz");
  assertEquals(bearerToken("Basic abc"), null);
  assertEquals(bearerToken("Bearer"), null);
  assertEquals(bearerToken(null), null);
});

Deno.test("validiereChatAnfrage: gueltige Anfrage wird getrimmt durchgelassen", () => {
  const e = validiereChatAnfrage({ ...gueltig, chatInput: "  Werk B schließt \n" });
  assert(e.ok);
  assertEquals(e.wert, gueltig);
});

Deno.test("validiereChatAnfrage: fremde Felder werden abgelehnt (keine Kontodaten zu n8n)", () => {
  const e = validiereChatAnfrage({ ...gueltig, user_id: "abc", email: "x@y" });
  assert(!e.ok);
  assertEquals(e.fehler.length, 2);
});

Deno.test("validiereChatAnfrage: Pflichtfelder und Grenzen", () => {
  assert(!validiereChatAnfrage(null).ok);
  assert(!validiereChatAnfrage([gueltig]).ok);
  assert(!validiereChatAnfrage({ ...gueltig, action: "loadPreviousSession" }).ok);
  assert(!validiereChatAnfrage({ ...gueltig, sessionId: "kurz" }).ok);
  assert(!validiereChatAnfrage({ ...gueltig, sessionId: "../../etc/passwd-xxxx" }).ok);
  assert(!validiereChatAnfrage({ ...gueltig, chatInput: "   " }).ok);
  assert(!validiereChatAnfrage({ ...gueltig, chatInput: 42 }).ok);
  assert(validiereChatAnfrage({ ...gueltig, chatInput: "a".repeat(CHAT_MAX_ZEICHEN) }).ok);
  assert(!validiereChatAnfrage({ ...gueltig, chatInput: "a".repeat(CHAT_MAX_ZEICHEN + 1) }).ok);
});

Deno.test("basicAuth: Base64 von nutzer:passwort, auch mit Umlauten", () => {
  assertEquals(basicAuth("Aladdin", "open sesame"), "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
  assertEquals(basicAuth("ä", "ö"), `Basic ${btoa("\xc3\xa4:\xc3\xb6")}`);
});

Deno.test("leseN8nAntwort: Antwortmodus lastNode", () => {
  assertEquals(leseN8nAntwort('{"output":"Danke für deine Meldung."}'), "Danke für deine Meldung.");
  assertEquals(leseN8nAntwort('[{"output":"Erstes"}]'), "Erstes");
  assertEquals(leseN8nAntwort('{"text":"Alt"}'), "Alt");
});

Deno.test("leseN8nAntwort: Streaming-Format wird zusammengesetzt", () => {
  const roh = [
    '{"type":"begin","metadata":{}}',
    '{"type":"item","content":"Danke, "}',
    '{"type":"item","content":"ich habe es notiert."}',
    '{"type":"end","metadata":{}}',
    "",
  ].join("\n");
  assertEquals(leseN8nAntwort(roh), "Danke, ich habe es notiert.");
});

Deno.test("leseN8nAntwort: leer, HTML oder unbekannt ergibt null", () => {
  assertEquals(leseN8nAntwort(""), null);
  assertEquals(leseN8nAntwort("<html>Fehler</html>"), null);
  assertEquals(leseN8nAntwort('{"message":"Workflow was started"}'), null);
  assertEquals(leseN8nAntwort('{"output":"  "}'), null);
});

Deno.test("leseChatKonfig: alle drei Secrets noetig, URL nur https", () => {
  const env = (werte: Record<string, string>) => (n: string) => werte[n];
  const voll = { N8N_CHAT_URL: "https://x.app.n8n.cloud/webhook/abc/chat", N8N_CHAT_USER: "u", N8N_CHAT_PASSWORD: "p" };
  assertEquals(leseChatKonfig(env(voll)), { url: voll.N8N_CHAT_URL, nutzer: "u", passwort: "p" });
  assertEquals(leseChatKonfig(env({ ...voll, N8N_CHAT_PASSWORD: "" })), null);
  assertEquals(leseChatKonfig(env({ ...voll, N8N_CHAT_URL: "http://x/chat" })), null);
  assertEquals(leseChatKonfig(env({ N8N_CHAT_USER: "u", N8N_CHAT_PASSWORD: "p" })), null);
});
