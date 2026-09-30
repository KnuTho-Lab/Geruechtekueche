-- Test fuer die Zuordnungs-Pruefung (Migration 20260930120000_zuordnung_pruefung):
-- Average Linkage in geruecht_kandidaten, Zustand "Zuordnung offen", atomares Zuordnen per
-- meldung_zuordnen, Klassifizierungs-Trigger beim Nachholen, View offene_zuordnungen und
-- Protokoll zuordnung_pruefungen.
-- Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck, und pg_net verschickt
-- nichts, weil es erst nach einem Commit sendet.
-- Die Testvektoren haben nur in den ersten drei Dimensionen Werte. Zu den echten, dichten
-- Embeddings im Bestand ist ihre Aehnlichkeit nahe 0, sie stoeren die Faelle also nicht.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/zuordnung_test.sql
begin;

create function pg_temp.vek(a float8, b float8, c float8) returns extensions.halfvec
language sql as $$
  select (array[a, b, c] || array_fill(0::float8, array[3069]))::extensions.vector(3072)::extensions.halfvec(3072)
$$;

do $$
declare
  test_url constant text := 'https://example.invalid/zuordnung-test';
  ga      bigint;
  gb      bigint;
  gneu    bigint;
  mo      bigint;
  mo2     bigint;
  ergebnis bigint;
  zeile   record;
  anzahl  int;
begin
  -- Fall 1: Average Linkage. A hat eine exakt passende und eine unpassende Meldung
  -- (Durchschnitt 0,5, Maximum 1), B eine fast passende (Durchschnitt etwa 0,99).
  -- Single Linkage haette A gewaehlt, Average Linkage waehlt B.
  insert into public.geruechte default values returning geruecht_id into ga;
  insert into public.geruechte default values returning geruecht_id into gb;
  insert into public.meldungen (geruecht_id, text, embedding, zuordnung_art) values
    (ga, '[TEST] A passt', pg_temp.vek(1, 0, 0), 'neu'),
    (ga, '[TEST] A passt nicht', pg_temp.vek(0, 1, 0), 'embedding'),
    (gb, '[TEST] B passt fast', pg_temp.vek(0.9, 0.1, 0), 'neu');

  select * into zeile from public.geruecht_kandidaten(pg_temp.vek(1, 0, 0), 3) limit 1;
  assert zeile.geruecht_id = gb, format('Fall 1: erster Kandidat ist %s statt B', zeile.geruecht_id);
  assert zeile.aehnlichkeit > 0.98, format('Fall 1: Aehnlichkeit B %s', zeile.aehnlichkeit);
  assert zeile.anzahl_meldungen = 1, 'Fall 1: Anzahl Meldungen B';
  select * into zeile from public.geruecht_kandidaten(pg_temp.vek(1, 0, 0), 3) where geruecht_id = ga;
  assert abs(zeile.aehnlichkeit - 0.5) < 0.01, format('Fall 1: Durchschnitt A %s', zeile.aehnlichkeit);
  assert abs(zeile.max_aehnlichkeit - 1) < 0.01, format('Fall 1: Maximum A %s', zeile.max_aehnlichkeit);
  assert zeile.anzahl_meldungen = 2, 'Fall 1: Anzahl Meldungen A';

  -- Fall 2: p_anzahl begrenzt die Kandidaten
  select count(*) into anzahl from public.geruecht_kandidaten(pg_temp.vek(1, 0, 0), 1);
  assert anzahl = 1, format('Fall 2: %s Kandidaten statt 1', anzahl);

  -- Fall 3: Zustand offen. Ohne Geruecht nur mit zuordnung_art 'offen' und umgekehrt
  insert into public.meldungen (geruecht_id, text, embedding, zuordnung_art)
    values (null, '[TEST] offen', pg_temp.vek(1, 0, 0), 'offen') returning meldung_id into mo;
  begin
    insert into public.meldungen (geruecht_id, text, zuordnung_art) values (null, '[TEST] x', 'neu');
    assert false, 'Fall 3: ohne Geruecht, aber nicht offen, wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    insert into public.meldungen (geruecht_id, text, zuordnung_art) values (ga, '[TEST] x', 'offen');
    assert false, 'Fall 3: offen, aber mit Geruecht, wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    insert into public.meldungen (geruecht_id, text, zuordnung_art) values (ga, '[TEST] x', 'unbekannt');
    assert false, 'Fall 3: unbekannte zuordnung_art wurde angenommen';
  exception when check_violation then null;
  end;

  -- Fall 4: eine offene Meldung ist kein Kandidat und zaehlt in keinem Durchschnitt
  select count(*) into anzahl from public.geruecht_kandidaten(pg_temp.vek(1, 0, 0), 3) where geruecht_id is null;
  assert anzahl = 0, 'Fall 4: offene Meldung als Kandidat';

  -- Fall 5: offene Meldung erzeugt keinen Klassifizierungs-Anstoss, erst das Zuordnen
  delete from vault.secrets where name in ('klassifizierer_webhook_url', 'klassifizierer_webhook_secret');
  perform vault.create_secret(test_url, 'klassifizierer_webhook_url');
  perform vault.create_secret('test-geheimnis', 'klassifizierer_webhook_secret');
  insert into public.meldungen (geruecht_id, text, embedding, zuordnung_art)
    values (null, '[TEST] offen zwei', pg_temp.vek(0, 0, 1), 'offen') returning meldung_id into mo2;
  select count(*) into anzahl from public.klassifizierung_anstoesse where meldung_id = mo2;
  assert anzahl = 0, 'Fall 5: offene Meldung hat einen Anstoss ausgeloest';

  -- Fall 6: offene Meldungen stehen in der View, mit Zahl der Versuche und letztem Fehler
  insert into public.zuordnung_pruefungen (meldung_id, kandidaten, ergebnis, fehler)
    values (mo2, '[]', 'fehler', 'Webhook nicht konfiguriert');
  select * into zeile from public.offene_zuordnungen where meldung_id = mo2;
  assert zeile.versuche = 1 and zeile.letzter_fehler = 'Webhook nicht konfiguriert',
    format('Fall 6: View zeigt %s', row_to_json(zeile));
  select count(*) into anzahl from public.offene_zuordnungen where meldung_id in (mo, mo2);
  assert anzahl = 2, format('Fall 6: %s offene statt 2', anzahl);

  -- Fall 7: Zuordnen in ein neues Geruecht, atomar: legt es an, setzt Art und Werte,
  -- stoesst die Klassifizierung an und verschwindet aus der View
  gneu := public.meldung_zuordnen(mo2, null, 'neu', 0.4, 0.3);
  assert gneu is not null, 'Fall 7: kein neues Geruecht';
  select * into zeile from public.meldungen where meldung_id = mo2;
  assert zeile.geruecht_id = gneu and zeile.zuordnung_art = 'neu'
    and zeile.beste_aehnlichkeit = 0.4 and zeile.geruecht_aehnlichkeit = 0.3,
    format('Fall 7: Meldung ist %s', row_to_json(zeile));
  select count(*) into anzahl from public.klassifizierung_anstoesse where meldung_id = mo2 and geruecht_id = gneu;
  assert anzahl = 1, format('Fall 7: %s Anstoesse statt 1', anzahl);
  select count(*) into anzahl from public.offene_zuordnungen where meldung_id = mo2;
  assert anzahl = 0, 'Fall 7: zugeordnete Meldung noch in der View';

  -- Fall 8: ein zweites Zuordnen derselben Meldung aendert nichts und legt nichts an
  select count(*) into anzahl from public.geruechte;
  ergebnis := public.meldung_zuordnen(mo2, null, 'neu', null, null);
  assert ergebnis is null, 'Fall 8: bereits zugeordnete Meldung wurde erneut zugeordnet';
  assert (select count(*) from public.geruechte) = anzahl, 'Fall 8: zusaetzliches Geruecht angelegt';
  assert (select geruecht_id from public.meldungen where meldung_id = mo2) = gneu, 'Fall 8: Geruecht geaendert';

  -- Fall 9: Zuordnen in ein bestehendes Geruecht als 'geprueft', kein Anstoss (nicht erste Meldung)
  ergebnis := public.meldung_zuordnen(mo, gb, 'geprueft', 0.99, 0.99);
  assert ergebnis = gb, 'Fall 9: nicht in B gelandet';
  assert (select zuordnung_art from public.meldungen where meldung_id = mo) = 'geprueft', 'Fall 9: Art';
  select count(*) into anzahl from public.klassifizierung_anstoesse where meldung_id = mo;
  assert anzahl = 0, 'Fall 9: Anstoss fuer ein Geruecht mit schon vorhandener Meldung';

  -- Fall 10: meldung_zuordnen nimmt nur embedding, geprueft und neu
  insert into public.meldungen (geruecht_id, text, zuordnung_art)
    values (null, '[TEST] offen drei', 'offen') returning meldung_id into mo;
  begin
    perform public.meldung_zuordnen(mo, gb, 'explizit', null, null);
    assert false, 'Fall 10: Art explizit wurde angenommen';
  exception when invalid_parameter_value then null;
  end;

  -- Fall 11: Protokoll-Regeln. 'gleich' nur mit Geruecht, 'fehler' nur mit Fehlertext
  begin
    insert into public.zuordnung_pruefungen (meldung_id, ergebnis) values (mo, 'gleich');
    assert false, 'Fall 11: gleich ohne Geruecht wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    insert into public.zuordnung_pruefungen (meldung_id, ergebnis) values (mo, 'fehler');
    assert false, 'Fall 11: fehler ohne Text wurde angenommen';
  exception when check_violation then null;
  end;
  insert into public.zuordnung_pruefungen (meldung_id, ergebnis, geruecht_id, begruendung)
    values (mo, 'gleich', gb, 'gleicher Sachverhalt');

  -- Fall 12: niemand ausser der Service Role kommt an Tabelle, View und Funktionen
  assert not has_table_privilege('anon', 'public.zuordnung_pruefungen', 'SELECT'), 'Fall 12: anon liest Protokoll';
  assert not has_table_privilege('authenticated', 'public.offene_zuordnungen', 'SELECT'), 'Fall 12: authenticated liest View';
  assert not has_function_privilege('anon', 'public.meldung_zuordnen(bigint, bigint, text, double precision, double precision)', 'EXECUTE'),
    'Fall 12: anon darf zuordnen';
  assert not has_function_privilege('authenticated', 'public.geruecht_kandidaten(extensions.halfvec, integer, integer)', 'EXECUTE'),
    'Fall 12: authenticated darf suchen';
  assert (select relrowsecurity from pg_class where oid = 'public.zuordnung_pruefungen'::regclass), 'Fall 12: RLS aus';
end;
$$;

select 'zuordnung_test: alle Faelle bestanden' as ergebnis;

rollback;
