-- Test fuer das Logging (Migrationen 20260927120000 bis 20260927140100): Zeitstempel am
-- Geruecht, Anstoss-Protokoll, Abholen der pg_net-Antworten, View haengende_klassifizierungen,
-- Zusatzfelder der Meldung und Abweisungen.
-- Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck, und pg_net verschickt
-- nichts, weil es erst nach einem Commit sendet.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/logging_test.sql
begin;

do $$
declare
  test_url constant text := 'https://example.invalid/logging-test';
  kat1       bigint;
  kat2       bigint;
  g_neu      bigint;
  g_ohne     bigint;
  g_fertig   bigint;
  zeit       timestamptz;
  anstoss    record;
  anzahl     int;
  haengend   record;
begin
  select kategorie_id into kat1 from public.kategorien order by kategorie_id limit 1;
  select kategorie_id into kat2 from public.kategorien order by kategorie_id offset 1 limit 1;

  -- Fall 1: neues Geruecht bekommt angelegt_am, klassifiziert_am bleibt leer
  insert into public.geruechte default values returning geruecht_id into g_fertig;
  select klassifiziert_am into zeit from public.geruechte where geruecht_id = g_fertig;
  assert zeit is null, 'Fall 1: klassifiziert_am ist gesetzt, obwohl keine Kategorie da ist';
  assert (select angelegt_am from public.geruechte where geruecht_id = g_fertig) = now(),
    'Fall 1: angelegt_am ist nicht der Anlagezeitpunkt';

  -- Fall 2: erste Kategorie setzt klassifiziert_am, eine spaetere Aenderung nicht erneut
  update public.geruechte set kategorie_id = kat1 where geruecht_id = g_fertig;
  select klassifiziert_am into zeit from public.geruechte where geruecht_id = g_fertig;
  assert zeit is not null, 'Fall 2: klassifiziert_am wurde nicht gesetzt';
  update public.geruechte set klassifiziert_am = '2000-01-01', kategorie_id = kat2 where geruecht_id = g_fertig;
  assert (select klassifiziert_am from public.geruechte where geruecht_id = g_fertig) = '2000-01-01',
    'Fall 2: klassifiziert_am wurde bei einer spaeteren Aenderung ueberschrieben';

  -- Fall 3: erste Meldung eines neuen Geruechts -> genau ein Anstoss mit der request_id von pg_net
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  perform vault.create_secret(test_url, 'klassifizierer_webhook_url');
  perform vault.create_secret('test-geheimnis', 'klassifizierer_webhook_secret');

  insert into public.geruechte default values returning geruecht_id into g_neu;
  insert into public.meldungen (geruecht_id, text) values (g_neu, '[TEST] Logging erste Meldung');
  insert into public.meldungen (geruecht_id, text) values (g_neu, '[TEST] Logging zweite Meldung');

  select count(*) into anzahl from public.klassifizierung_anstoesse where geruecht_id = g_neu;
  assert anzahl = 1, format('Fall 3: erwartet 1 Anstoss, gefunden %s', anzahl);
  select * into anstoss from public.klassifizierung_anstoesse where geruecht_id = g_neu;
  assert anstoss.request_id = (select id from net.http_request_queue where url = test_url),
    'Fall 3: request_id passt nicht zur Anfrage in pg_net';
  assert anstoss.fehler is null and anstoss.antwort_abgeholt_am is null, 'Fall 3: Anstoss ist schon abgeschlossen';

  -- Fall 4: Antwort von n8n (hier nachgestellt: 403) wird ins Protokoll uebernommen, genau
  -- einmal, aber ohne den Inhalt der Antwort: der koennte Meldungstext spiegeln
  insert into net._http_response (id, status_code, content, timed_out, created)
    values (anstoss.request_id, 403, 'Echo: [TEST] Logging erste Meldung', false, now());
  assert public.klassifizierung_antworten_abholen() = 1, 'Fall 4: Antwort wurde nicht uebernommen';
  assert public.klassifizierung_antworten_abholen() = 0, 'Fall 4: Antwort wurde doppelt uebernommen';
  select * into anstoss from public.klassifizierung_anstoesse where geruecht_id = g_neu;
  assert anstoss.http_status = 403, format('Fall 4: http_status ist %s, erwartet 403', anstoss.http_status);
  assert anstoss.fehler is null, format('Fall 4: Inhalt der Antwort im Protokoll: %s', anstoss.fehler);
  assert anstoss.zeitueberschreitung = false, 'Fall 4: zeitueberschreitung falsch';

  -- Fall 5: Webhook nicht konfiguriert -> Meldung gespeichert, Anstoss mit Grund, ohne request_id
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  insert into public.geruechte default values returning geruecht_id into g_ohne;
  insert into public.meldungen (geruecht_id, text) values (g_ohne, '[TEST] Logging ohne Konfiguration');
  select * into anstoss from public.klassifizierung_anstoesse where geruecht_id = g_ohne;
  assert anstoss.request_id is null, 'Fall 5: request_id gesetzt, obwohl nichts verschickt wurde';
  assert anstoss.fehler like 'Webhook nicht konfiguriert%', format('Fall 5: fehler ist %s', anstoss.fehler);

  -- Fall 6: die View zeigt nur unklassifizierte Geruechte, die aelter als 10 Minuten sind
  select count(*) into anzahl from public.haengende_klassifizierungen where geruecht_id in (g_neu, g_ohne);
  assert anzahl = 0, 'Fall 6: frische Geruechte gelten schon als haengend';
  update public.geruechte set angelegt_am = now() - interval '1 hour' where geruecht_id in (g_neu, g_ohne, g_fertig);
  select * into haengend from public.haengende_klassifizierungen where geruecht_id = g_neu;
  assert haengend.geruecht_id is not null, 'Fall 6: altes unklassifiziertes Geruecht fehlt';
  assert haengend.http_status = 403 and haengend.anstoesse = 1, 'Fall 6: letzter Anstoss fehlt in der View';
  assert haengend.fehler is null, 'Fall 6: View zeigt den Inhalt der Antwort';
  assert exists (select 1 from public.haengende_klassifizierungen where geruecht_id = g_ohne),
    'Fall 6: nicht angestossenes Geruecht fehlt';
  assert not exists (select 1 from public.haengende_klassifizierungen where geruecht_id = g_fertig),
    'Fall 6: klassifiziertes Geruecht gilt als haengend';

  -- Fall 7: Loeschen eines Geruechts nimmt sein Protokoll mit
  delete from public.meldungen where geruecht_id = g_neu;
  delete from public.geruechte where geruecht_id = g_neu;
  select count(*) into anzahl from public.klassifizierung_anstoesse where geruecht_id = g_neu;
  assert anzahl = 0, 'Fall 7: Protokoll bleibt nach dem Loeschen zurueck';

  -- Fall 8: api_aufrufe nimmt nur gueltige Werte
  insert into public.api_aufrufe (endpunkt, methode, status, dauer_ms) values ('calls', 'GET', 200, 12);
  begin
    insert into public.api_aufrufe (endpunkt, methode, status, dauer_ms) values ('calls', 'GET', 200, -1);
    assert false, 'Fall 8: negative Dauer wurde angenommen';
  exception when check_violation then
    null;
  end;

  -- Fall 9: scheitert der Versand selbst, bleibt die Meldung gespeichert und der Grund steht
  -- im Protokoll. Ausgeloest mit einer URL, die pg_net ablehnt.
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  perform vault.create_secret(repeat('x', 3), 'klassifizierer_webhook_url');
  perform vault.create_secret('test-geheimnis', 'klassifizierer_webhook_secret');
  insert into public.geruechte default values returning geruecht_id into g_ohne;
  insert into public.meldungen (geruecht_id, text) values (g_ohne, '[TEST] Logging Versandfehler');
  assert exists (select 1 from public.meldungen where geruecht_id = g_ohne), 'Fall 9: Meldung verloren';
  select * into anstoss from public.klassifizierung_anstoesse where geruecht_id = g_ohne;
  -- pg_net wirft hier "invalid URL" (gemessen 2026-09-27)
  assert anstoss.request_id is null and anstoss.fehler like 'Versand fehlgeschlagen: invalid URL%',
    format('Fall 9: request_id=%s, fehler=%s', anstoss.request_id, anstoss.fehler);

  -- Fall 10: Zusatzfelder nehmen nur Werte aus den festen Listen
  insert into public.meldungen (geruecht_id, text, standort, emotion, quellenkette, geschwaerzte_namen)
    values (g_ohne, '[TEST] Zusatzfelder', 'Werk B', 'besorgt', 'weitererzählt', 2);
  begin
    insert into public.meldungen (geruecht_id, text, emotion) values (g_ohne, '[TEST] x', 'wütend');
    assert false, 'Fall 10: unbekannte emotion wurde angenommen';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.meldungen (geruecht_id, text, geschwaerzte_namen) values (g_ohne, '[TEST] x', -1);
    assert false, 'Fall 10: negative Anzahl geschwaerzter Namen wurde angenommen';
  exception when check_violation then
    null;
  end;

  -- Fall 11: abweisungen nimmt nur bekannte Gruende
  insert into public.abweisungen (grund) values ('prompt_injection');
  begin
    insert into public.abweisungen (grund) values ('irgendwas');
    assert false, 'Fall 11: unbekannter Grund wurde angenommen';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;

select 'logging_test: alle Faelle bestanden' as ergebnis;
