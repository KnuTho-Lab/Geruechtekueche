-- Test fuer den Arbeitsbereich (Migration 20261005140000): Statushistorie per Trigger,
-- status_setzen mit Konfliktschutz, Liste und Detail ohne user_id und Embeddings, Rechte.
-- Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/arbeitsbereich_test.sql
begin;

do $$
declare
  kat   bigint;
  g     bigint;
  g2    bigint;
  r     jsonb;
  zeile record;
  n     int;
  darf  boolean;
begin
  select kategorie_id into kat from public.kategorien order by kategorie_id limit 1;
  insert into public.geruechte (kategorie_id, kernaussage) values (kat, 'Testgeruecht Arbeitsbereich') returning geruecht_id into g;
  insert into public.meldungen (geruecht_id, text, user_id, standort, emotion, quellenkette)
    values (g, 'qzx7731 erste Meldung', 'geheime-user-id', 'Werk A', 'besorgt', 'weitererzählt');
  insert into public.meldungen (geruecht_id, text) values (g, 'qzx7731 zweite Meldung');

  -- Fall 1: ein Direktupdate (ohne status_setzen) wird trotzdem protokolliert, von 'system'
  update public.geruechte set status = 'nicht prüfbar' where geruecht_id = g;
  select * into zeile from public.status_historie where geruecht_id = g;
  assert zeile.alt = 'offen' and zeile.neu = 'nicht prüfbar' and zeile.geaendert_von = 'system',
    format('Fall 1: Historie %s -> %s von %s', zeile.alt, zeile.neu, zeile.geaendert_von);
  update public.geruechte set status = 'offen' where geruecht_id = g;

  -- Fall 2: ein Update ohne Statusaenderung schreibt nichts
  select count(*) into n from public.status_historie where geruecht_id = g;
  update public.geruechte set kernaussage = 'Testgeruecht geaendert' where geruecht_id = g;
  update public.geruechte set status = 'offen' where geruecht_id = g;
  assert (select count(*) from public.status_historie where geruecht_id = g) = n, 'Fall 2: Historie ohne Statuswechsel';

  -- Fall 3: status_setzen mit Nutzername
  r := public.status_setzen(g, 'bestätigt', 'offen', 'knut');
  assert r ->> 'ergebnis' = 'ok' and r ->> 'status' = 'bestätigt' and r ->> 'vorher' = 'offen', 'Fall 3: ' || r::text;
  select * into zeile from public.status_historie where geruecht_id = g order by historie_id desc limit 1;
  assert zeile.alt = 'offen' and zeile.neu = 'bestätigt' and zeile.geaendert_von = 'knut',
    format('Fall 3: Historie von %s', zeile.geaendert_von);
  assert (select status from public.geruechte where geruecht_id = g) = 'bestätigt', 'Fall 3: Status nicht gesetzt';

  -- Fall 4: der Nutzername haengt nicht an der Sitzung fest: ein spaeteres Direktupdate ist wieder 'system'
  update public.geruechte set status = 'widerlegt' where geruecht_id = g;
  select geaendert_von into zeile from public.status_historie where geruecht_id = g order by historie_id desc limit 1;
  assert zeile.geaendert_von = 'system', 'Fall 4: Nutzername blieb haengen: ' || zeile.geaendert_von;

  -- Fall 5: Konfliktschutz, wer einen veralteten Stand gesehen hat, ueberschreibt nichts
  r := public.status_setzen(g, 'offen', 'bestätigt', 'thomas');
  assert r ->> 'ergebnis' = 'konflikt' and r ->> 'status' = 'widerlegt', 'Fall 5: ' || r::text;
  assert (select status from public.geruechte where geruecht_id = g) = 'widerlegt', 'Fall 5: Status trotz Konflikt geaendert';

  -- Fall 6: gleicher Status -> unveraendert, keine neue Historienzeile
  select count(*) into n from public.status_historie where geruecht_id = g;
  r := public.status_setzen(g, 'widerlegt', 'widerlegt', 'knut');
  assert r ->> 'ergebnis' = 'unveraendert', 'Fall 6: ' || r::text;
  assert (select count(*) from public.status_historie where geruecht_id = g) = n, 'Fall 6: Historie bei unverändertem Status';

  -- Fall 7: ohne p_erwartet wird ohne Konfliktpruefung gesetzt
  r := public.status_setzen(g, 'offen', null, 'thomas');
  assert r ->> 'ergebnis' = 'ok', 'Fall 7: ' || r::text;

  -- Fall 8: unbekanntes Geruecht, ungueltiger Status, fehlender Nutzer
  assert public.status_setzen(-1, 'offen', null, 'knut') ->> 'ergebnis' = 'nicht_gefunden', 'Fall 8: nicht_gefunden';
  begin
    perform public.status_setzen(g, 'erledigt', null, 'knut');
    assert false, 'Fall 8: ungueltiger Status angenommen';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.status_setzen(g, 'offen', null, '');
    assert false, 'Fall 8: leerer Nutzer angenommen';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.status_setzen(g, 'offen', null, repeat('x', 41));
    assert false, 'Fall 8: zu langer Nutzer angenommen';
  exception when invalid_parameter_value then null;
  end;

  -- Fall 9: die Historie selbst lehnt unsinnige Zeilen ab
  begin
    insert into public.status_historie (geruecht_id, alt, neu, geaendert_von) values (g, 'offen', 'offen', 'knut');
    assert false, 'Fall 9: alt = neu angenommen';
  exception when check_violation then null;
  end;

  -- Fall 10: Detail enthaelt Meldungen in Reihenfolge, Historie, aber nie user_id oder Embeddings
  r := public.arbeitsbereich_geruecht(g);
  assert r ->> 'kernaussage' = 'Testgeruecht geaendert', 'Fall 10: Kernaussage';
  assert jsonb_array_length(r -> 'meldungen') = 2, 'Fall 10: Meldungen';
  assert r -> 'meldungen' -> 0 ->> 'text' = 'qzx7731 erste Meldung' and r -> 'meldungen' -> 0 ->> 'standort' = 'Werk A', 'Fall 10: erste Meldung';
  assert r -> 'meldungen' -> 0 ->> 'emotion' = 'besorgt' and r -> 'meldungen' -> 0 ->> 'quellenkette' = 'weitererzählt', 'Fall 10: Zusatzfelder';
  assert jsonb_array_length(r -> 'historie') >= 4, 'Fall 10: Historie ' || jsonb_array_length(r -> 'historie')::text;
  assert r -> 'historie' -> 0 ->> 'alt' = 'offen', 'Fall 10: Historie beginnt mit dem ersten Wechsel';
  assert position('user_id' in r::text) = 0 and position('geheime-user-id' in r::text) = 0, 'Fall 10: user_id im Detail';
  assert position('embedding' in r::text) = 0, 'Fall 10: Embedding im Detail';
  assert public.arbeitsbereich_geruecht(-1) is null, 'Fall 10: unbekanntes Gerücht ist null';

  -- Fall 11: Liste enthaelt das Geruecht mit Anzahl Meldungen, aber keine Texte
  r := public.arbeitsbereich_liste();
  assert r #>> '{grenzen,hoch}' = '0.75' and r #>> '{grenzen,mittel}' = '0.40', 'Fall 11: Grenzen';
  select e into zeile from jsonb_array_elements(r -> 'geruechte') e where (e ->> 'geruecht_id')::bigint = g;
  assert (zeile.e ->> 'anzahl_meldungen')::int = 2, 'Fall 11: anzahl_meldungen';
  assert zeile.e ->> 'status_geaendert_am' is not null, 'Fall 11: status_geaendert_am fehlt';
  assert position('qzx7731' in r::text) = 0, 'Fall 11: Meldungstext in der Liste';
  assert position('user_id' in r::text) = 0, 'Fall 11: user_id in der Liste';
  -- neueste zuerst
  assert (r -> 'geruechte' -> 0 ->> 'geruecht_id')::bigint = (select max(geruecht_id) from public.geruechte), 'Fall 11: nicht neueste zuerst';

  -- Fall 12: nur service_role darf ausfuehren
  darf := has_function_privilege('anon', 'public.status_setzen(bigint,text,text,text)', 'execute')
       or has_function_privilege('authenticated', 'public.status_setzen(bigint,text,text,text)', 'execute')
       or has_function_privilege('anon', 'public.arbeitsbereich_liste()', 'execute')
       or has_function_privilege('authenticated', 'public.arbeitsbereich_liste()', 'execute')
       or has_function_privilege('anon', 'public.arbeitsbereich_geruecht(bigint)', 'execute')
       or has_function_privilege('authenticated', 'public.arbeitsbereich_geruecht(bigint)', 'execute');
  assert not darf, 'Fall 12: anon oder authenticated darf ausfuehren';
  assert has_function_privilege('service_role', 'public.status_setzen(bigint,text,text,text)', 'execute')
     and has_function_privilege('service_role', 'public.arbeitsbereich_liste()', 'execute')
     and has_function_privilege('service_role', 'public.arbeitsbereich_geruecht(bigint)', 'execute'), 'Fall 12: service_role darf nicht';

  -- Fall 13: Tabelle status_historie ist fuer anon und authenticated gesperrt
  assert not has_table_privilege('anon', 'public.status_historie', 'select')
     and not has_table_privilege('authenticated', 'public.status_historie', 'select'), 'Fall 13: status_historie lesbar';
end;
$$;

rollback;
select 'arbeitsbereich_test: alle Faelle bestanden' as ergebnis;
