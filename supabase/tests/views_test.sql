-- Test fuer die Lese-Views geruechte_uebersicht und klassifizierung_protokoll
-- (Migration 20260928090000): Spaltenreihenfolge, Kategorienamen, Anzahl Meldungen und
-- jeder Wert der Spalte ergebnis.
-- Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck, und pg_net verschickt
-- nichts, weil es erst nach einem Commit sendet.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/views_test.sql
begin;

do $$
declare
  test_url constant text := 'https://example.invalid/views-test';
  standort bigint;
  personal bigint;
  g        bigint;
  m        bigint;
  anfrage  bigint;
  spalten  text;
  zeile    record;
begin
  -- Fall 1: Spaltenreihenfolge, zusammengehoerige Spalten nebeneinander
  select string_agg(column_name, ',' order by ordinal_position) into spalten
    from information_schema.columns where table_schema = 'public' and table_name = 'geruechte_uebersicht';
  assert spalten = 'geruecht_id,status,kernaussage,kategorie_id,kategorie,kategorie_konfidenz,'
    'zweitkategorie_id,zweitkategorie,zweitkategorie_konfidenz,risiko,risiko_status,risiko_berechnet_am,'
    'risiko_modell,kategorie_begruendung,manuell_pruefen,'
    'anzahl_meldungen,angelegt_am,klassifiziert_am',
    format('Fall 1: geruechte_uebersicht hat %s', spalten);
  select string_agg(column_name, ',' order by ordinal_position) into spalten
    from information_schema.columns where table_schema = 'public' and table_name = 'klassifizierung_protokoll';
  assert spalten = 'anstoss_id,meldung_id,geruecht_id,angestossen_am,ergebnis,kategorie,klassifiziert_am,'
    'http_status,zeitueberschreitung,fehler,request_id,antwort_abgeholt_am',
    format('Fall 1: klassifizierung_protokoll hat %s', spalten);

  select kategorie_id into standort from public.kategorien where name = 'Standortschließung oder Massenentlassung';
  select kategorie_id into personal from public.kategorien where name = 'Übernahme oder Verkauf';

  -- Fall 2: Anstoss verschickt, noch keine Antwort -> wartet
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  perform vault.create_secret(test_url, 'klassifizierer_webhook_url');
  perform vault.create_secret('test-geheimnis', 'klassifizierer_webhook_secret');
  insert into public.geruechte default values returning geruecht_id into g;
  insert into public.meldungen (geruecht_id, text) values (g, '[TEST] Views erste Meldung') returning meldung_id into m;
  insert into public.meldungen (geruecht_id, text) values (g, '[TEST] Views zweite Meldung');

  select * into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.meldung_id = m, 'Fall 2: falsche Meldung im Protokoll';
  assert zeile.ergebnis = 'wartet auf Antwort', format('Fall 2: ergebnis ist %s', zeile.ergebnis);
  anfrage := zeile.request_id;

  -- Fall 3: Antworten von n8n, noch nicht abgeholt, kommen live aus pg_net
  insert into net._http_response (id, status_code, content, timed_out, created)
    values (anfrage, 403, 'x', false, now());
  select ergebnis into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.ergebnis = 'HTTP 403', format('Fall 3: ergebnis ist %s', zeile.ergebnis);

  update net._http_response set status_code = null, timed_out = true where id = anfrage;
  select ergebnis into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.ergebnis = 'Zeitüberschreitung', format('Fall 3: ergebnis ist %s', zeile.ergebnis);

  update net._http_response set timed_out = false, error_msg = 'Couldn''t resolve host' where id = anfrage;
  select ergebnis into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.ergebnis = 'Fehler: Couldn''t resolve host', format('Fall 3: ergebnis ist %s', zeile.ergebnis);

  update net._http_response set error_msg = null, status_code = 200 where id = anfrage;
  select ergebnis into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.ergebnis = 'angenommen, Kategorie fehlt', format('Fall 3: ergebnis ist %s', zeile.ergebnis);

  -- Fall 4: auch nach dem Abholen ins Protokoll gleich
  perform public.klassifizierung_antworten_abholen();
  delete from net._http_response where id = anfrage;
  select ergebnis into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.ergebnis = 'angenommen, Kategorie fehlt', format('Fall 4: ergebnis ist %s', zeile.ergebnis);

  -- Fall 5: Rueckmeldung des Klassifizierers schlaegt jeden HTTP-Befund, auch einen Timeout
  update public.klassifizierung_anstoesse set zeitueberschreitung = true, http_status = null where geruecht_id = g;
  update public.geruechte
    set kategorie_id = standort, kategorie_konfidenz = 0.7, zweitkategorie_id = personal, zweitkategorie_konfidenz = 0.4
    where geruecht_id = g;
  select * into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.ergebnis = 'klassifiziert', format('Fall 5: ergebnis ist %s', zeile.ergebnis);
  assert zeile.kategorie = 'Standortschließung oder Massenentlassung' and zeile.klassifiziert_am is not null, 'Fall 5: Kategorie oder Zeit fehlt';

  -- Fall 6: Uebersicht mit Namen beider Kategorien und live gezaehlten Meldungen
  select * into zeile from public.geruechte_uebersicht where geruecht_id = g;
  assert zeile.kategorie = 'Standortschließung oder Massenentlassung' and zeile.zweitkategorie = 'Übernahme oder Verkauf',
    format('Fall 6: Kategorien %s / %s', zeile.kategorie, zeile.zweitkategorie);
  assert zeile.anzahl_meldungen = 2, format('Fall 6: anzahl_meldungen ist %s', zeile.anzahl_meldungen);

  -- Fall 7: nicht verschickt -> Grund steht im ergebnis; Geruecht ohne Meldungen zaehlt 0
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  insert into public.geruechte default values returning geruecht_id into g;
  insert into public.meldungen (geruecht_id, text) values (g, '[TEST] Views ohne Konfiguration');
  select ergebnis into zeile from public.klassifizierung_protokoll where geruecht_id = g;
  assert zeile.ergebnis = 'nicht verschickt: Webhook nicht konfiguriert, nichts verschickt',
    format('Fall 7: ergebnis ist %s', zeile.ergebnis);
  insert into public.geruechte default values returning geruecht_id into g;
  select * into zeile from public.geruechte_uebersicht where geruecht_id = g;
  assert zeile.anzahl_meldungen = 0 and zeile.kategorie is null and zeile.zweitkategorie is null,
    'Fall 7: leeres Geruecht falsch dargestellt';
end;
$$;

rollback;

select 'views_test: alle Faelle bestanden' as ergebnis;
