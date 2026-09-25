-- Test fuer den Trigger meldung_klassifizierung_anstossen.
-- Laeuft komplett in einer Transaktion und endet mit ROLLBACK: es bleibt nichts in
-- der Datenbank, und pg_net verschickt nichts, weil es erst nach einem Commit sendet.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/klassifizierung_trigger_test.sql
begin;

do $$
declare
  test_url constant text := 'https://example.invalid/klassifizierer-test';
  g_neu      bigint;
  g_fertig   bigint;
  g_ohne     bigint;
  anzahl     int;
  anfrage    record;
  inhalt     jsonb;
begin
  -- Testkonfiguration im Vault (wird mit dem Rollback wieder entfernt)
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  perform vault.create_secret(test_url, 'klassifizierer_webhook_url');
  perform vault.create_secret('test-geheimnis', 'klassifizierer_webhook_secret');

  -- Fall 1: neues Geruecht, erste Meldung -> genau ein Aufruf mit geruecht_id und Text,
  -- ohne user_id und ohne meldung_id
  insert into public.geruechte default values returning geruecht_id into g_neu;
  insert into public.meldungen (geruecht_id, text, user_id)
    values (g_neu, '[TEST] erste Meldung', 'geheime-person');

  select count(*) into anzahl from net.http_request_queue where url = test_url;
  assert anzahl = 1, format('Fall 1: erwartet 1 Aufruf, gefunden %s', anzahl);

  select * into anfrage from net.http_request_queue where url = test_url;
  inhalt := convert_from(anfrage.body, 'UTF8')::jsonb;
  assert anfrage.method = 'POST', 'Fall 1: Methode ist nicht POST';
  assert inhalt = jsonb_build_object('geruecht_id', g_neu, 'text', '[TEST] erste Meldung'),
    format('Fall 1: unerwarteter Body %s', inhalt);
  assert not inhalt ? 'user_id', 'Fall 1: user_id darf nicht verschickt werden';
  assert anfrage.headers ->> 'x-webhook-secret' = 'test-geheimnis', 'Fall 1: Header x-webhook-secret fehlt';

  -- Fall 2: zweite Meldung zum selben Geruecht -> kein weiterer Aufruf
  insert into public.meldungen (geruecht_id, text) values (g_neu, '[TEST] zweite Meldung');
  select count(*) into anzahl from net.http_request_queue where url = test_url;
  assert anzahl = 1, format('Fall 2: erwartet weiterhin 1 Aufruf, gefunden %s', anzahl);

  -- Fall 3: Geruecht hat schon eine Kategorie -> kein Aufruf
  insert into public.geruechte (kategorie_id)
    values ((select kategorie_id from public.kategorien order by kategorie_id limit 1))
    returning geruecht_id into g_fertig;
  insert into public.meldungen (geruecht_id, text) values (g_fertig, '[TEST] schon klassifiziert');
  select count(*) into anzahl from net.http_request_queue where url = test_url;
  assert anzahl = 1, format('Fall 3: klassifiziertes Geruecht hat Aufruf ausgeloest (%s)', anzahl);

  -- Fall 4: Webhook nicht konfiguriert -> kein Aufruf, Meldung wird trotzdem gespeichert
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  insert into public.geruechte default values returning geruecht_id into g_ohne;
  insert into public.meldungen (geruecht_id, text) values (g_ohne, '[TEST] ohne Konfiguration');
  select count(*) into anzahl from public.meldungen where geruecht_id = g_ohne;
  assert anzahl = 1, 'Fall 4: Meldung wurde nicht gespeichert';
  select count(*) into anzahl from net.http_request_queue where url = test_url;
  assert anzahl = 1, format('Fall 4: Aufruf trotz fehlender Konfiguration (%s)', anzahl);

  raise notice 'klassifizierung_trigger_test: alle 4 Faelle OK';
end;
$$;

rollback;
