-- Test fuer public.dashboard_statistik (Migration 20261005100000): Zaehlung gegen bekannte
-- Testdaten, Risikostufen an den Grenzen 0,40 und 0,75, Tagesgrenze in Berliner Zeit,
-- Abweisungen, Eingabepruefung, Rechte. Misst immer die Differenz zum Stand vor den
-- Testdaten, weil die Live-Datenbank echte Eintraege hat.
-- Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/dashboard_statistik_test.sql
begin;

do $$
declare
  kat     bigint;
  vorher  jsonb;
  nachher jsonb;
  g1 bigint; g2 bigint; g3 bigint; g4 bigint; g5 bigint;
  heute   date := (now() at time zone 'Europe/Berlin')::date;
  montag  date := date_trunc('week', (now() at time zone 'Europe/Berlin'))::date;
  tag_vorher int;
  tag_nachher int;
  darf    boolean;
begin
  select kategorie_id into kat from public.kategorien order by kategorie_id limit 1;
  vorher := public.dashboard_statistik(12);

  -- Fall 1: Struktur und Grenzen
  assert vorher #>> '{grenzen,mittel}' = '0.40' and vorher #>> '{grenzen,hoch}' = '0.75', 'Fall 1: Grenzen';
  assert (vorher #>> '{heatmap,von}')::date = montag - 11 * 7, 'Fall 1: Heatmap beginnt nicht am Montag vor 11 Wochen';
  assert (vorher #> '{heatmap,tage}') -> -1 ->> 'tag' = heute::text, 'Fall 1: letzter Tag ist nicht heute (Berlin)';
  assert jsonb_array_length(vorher #> '{abweisungen,gruende}') = 4, 'Fall 1: vier Abweisungsgruende';
  assert jsonb_array_length(vorher #> '{system,tage}') = 14, 'Fall 1: 14 Systemtage';

  -- Fall 2: fuenf Geruechte an den Risikogrenzen, je eine Meldung
  insert into public.geruechte (kategorie_id, risiko_status, risiko, risiko_berechnet_am, risiko_modell, status)
    values (kat, 'berechnet', 0.39, now(), 't', 'offen') returning geruecht_id into g1;
  insert into public.geruechte (kategorie_id, risiko_status, risiko, risiko_berechnet_am, risiko_modell, status)
    values (kat, 'berechnet', 0.40, now(), 't', 'offen') returning geruecht_id into g2;
  insert into public.geruechte (kategorie_id, risiko_status, risiko, risiko_berechnet_am, risiko_modell, status)
    values (kat, 'berechnet', 0.74, now(), 't', 'widerlegt') returning geruecht_id into g3;
  insert into public.geruechte (kategorie_id, risiko_status, risiko, risiko_berechnet_am, risiko_modell, status)
    values (kat, 'berechnet', 0.75, now(), 't', 'offen') returning geruecht_id into g4;
  insert into public.geruechte (kategorie_id, risiko_status, status)
    values (kat, 'queue', 'bestätigt') returning geruecht_id into g5;
  insert into public.meldungen (geruecht_id, text) select g, '[TEST] statistik' from unnest(array[g1, g2, g3, g4, g5]) g;
  nachher := public.dashboard_statistik(12);

  assert (nachher #>> '{risiko,niedrig}')::int - (vorher #>> '{risiko,niedrig}')::int = 1, 'Fall 2: niedrig (0,39)';
  assert (nachher #>> '{risiko,mittel}')::int - (vorher #>> '{risiko,mittel}')::int = 2, 'Fall 2: mittel (0,40 und 0,74)';
  assert (nachher #>> '{risiko,hoch}')::int - (vorher #>> '{risiko,hoch}')::int = 1, 'Fall 2: hoch (0,75)';
  assert (nachher #>> '{risiko,ohne_wert}')::int - (vorher #>> '{risiko,ohne_wert}')::int = 1, 'Fall 2: ohne Wert (queue)';
  assert (nachher #>> '{risiko,hoch_offen}')::int - (vorher #>> '{risiko,hoch_offen}')::int = 1, 'Fall 2: hoch und offen';

  -- Fall 3: Status
  assert (nachher #>> '{geruechte,gesamt}')::int - (vorher #>> '{geruechte,gesamt}')::int = 5, 'Fall 3: gesamt';
  assert (nachher #>> '{geruechte,offen}')::int - (vorher #>> '{geruechte,offen}')::int = 3, 'Fall 3: offen';
  assert (nachher #>> '{geruechte,bearbeitet}')::int - (vorher #>> '{geruechte,bearbeitet}')::int = 2, 'Fall 3: bearbeitet';
  assert (nachher #>> '{geruechte,widerlegt}')::int - (vorher #>> '{geruechte,widerlegt}')::int = 1, 'Fall 3: widerlegt';
  assert (nachher #>> '{geruechte,bestaetigt}')::int - (vorher #>> '{geruechte,bestaetigt}')::int = 1, 'Fall 3: bestaetigt';
  assert (nachher #>> '{system,risiko_queue}')::int - (vorher #>> '{system,risiko_queue}')::int = 1, 'Fall 3: Risiko-Queue';

  -- Fall 4: Meldungen gesamt und letzte 7 Tage
  assert (nachher #>> '{meldungen,gesamt}')::int - (vorher #>> '{meldungen,gesamt}')::int = 5, 'Fall 4: Meldungen gesamt';
  assert (nachher #>> '{meldungen,letzte_7_tage}')::int - (vorher #>> '{meldungen,letzte_7_tage}')::int = 5, 'Fall 4: letzte 7 Tage';

  -- Fall 5: Tagesgrenze in Berliner Zeit. 23:30 UTC ist in Berlin (Sommer +2, Winter +1) schon
  -- am Folgetag: eine Meldung von 23:30 UTC am Tag heute-4 gehoert auf heute-3.
  tag_vorher := (select (t ->> 'anzahl')::int from jsonb_array_elements(nachher #> '{heatmap,tage}') t
                 where t ->> 'tag' = (heute - 3)::text);
  update public.meldungen set eingegangen_am = ((heute - 4)::timestamp + interval '23 hours 30 minutes') at time zone 'UTC'
    where geruecht_id = g1;
  nachher := public.dashboard_statistik(12);
  tag_nachher := (select (t ->> 'anzahl')::int from jsonb_array_elements(nachher #> '{heatmap,tage}') t
                  where t ->> 'tag' = (heute - 3)::text);
  assert tag_nachher = tag_vorher + 1,
    format('Fall 5: 23:30 UTC (heute-4) gehoert nach Berlin auf heute-3, war %s jetzt %s', tag_vorher, tag_nachher);

  -- Fall 6: aeltere Meldungen fallen aus der 7-Tage-Zaehlung, bleiben in der Gesamtzahl
  assert (nachher #>> '{meldungen,letzte_7_tage}')::int - (vorher #>> '{meldungen,letzte_7_tage}')::int = 5,
    'Fall 6: vier Tage alte Meldung zaehlt noch zu den letzten 7 Tagen';
  update public.meldungen set eingegangen_am = now() - interval '20 days' where geruecht_id = g2;
  nachher := public.dashboard_statistik(12);
  assert (nachher #>> '{meldungen,letzte_7_tage}')::int - (vorher #>> '{meldungen,letzte_7_tage}')::int = 4,
    'Fall 6: 20 Tage alte Meldung faellt aus den letzten 7 Tagen';
  assert (nachher #>> '{meldungen,gesamt}')::int - (vorher #>> '{meldungen,gesamt}')::int = 5, 'Fall 6: Gesamtzahl aendert sich nicht';
  assert (nachher #>> '{meldungen,schnitt_vorher}')::numeric - (vorher #>> '{meldungen,schnitt_vorher}')::numeric >= 0.2,
    'Fall 6: Schnitt der Vorwochen steigt um mindestens 0,25 (eine Meldung geteilt durch vier)';

  -- Fall 7: Heatmap nach Kategorie enthaelt die Testkategorie
  assert exists (select 1 from jsonb_array_elements(nachher #> '{heatmap,kategorien}') t
                 where t ->> 'kategorie' = (select name from public.kategorien where kategorie_id = kat)),
    'Fall 7: Kategorie fehlt in der Heatmap';

  -- Fall 8: Abweisungen und Quote
  insert into public.abweisungen (grund) values ('prompt_injection'), ('prompt_injection'), ('kein_geruecht');
  nachher := public.dashboard_statistik(12);
  assert (nachher #>> '{abweisungen,gesamt}')::int - (vorher #>> '{abweisungen,gesamt}')::int = 3, 'Fall 8: Abweisungen gesamt';
  assert (select (e ->> 'anzahl')::int from jsonb_array_elements(nachher #> '{abweisungen,gruende}') e where e ->> 'grund' = 'prompt_injection')
       - (select (e ->> 'anzahl')::int from jsonb_array_elements(vorher #> '{abweisungen,gruende}') e where e ->> 'grund' = 'prompt_injection') = 2,
    'Fall 8: Prompt Injection';
  assert (nachher #>> '{abweisungen,quote}')::numeric > 0 and (nachher #>> '{abweisungen,quote}')::numeric < 1,
    'Fall 8: Quote zwischen 0 und 1';

  -- Fall 9: System aus api_aufrufe: Fehler nur ab Status 500, Anfragefehler (4xx ohne 429)
  -- und Rate-Limit (429) getrennt
  insert into public.api_aufrufe (endpunkt, methode, status, dauer_ms)
    values ('/test', 'GET', 200, 10), ('/test', 'GET', 500, 10), ('/test', 'GET', 503, 10),
           ('/test', 'GET', 404, 10), ('/test', 'GET', 400, 10), ('/test', 'GET', 409, 10), ('/test', 'GET', 429, 10);
  nachher := public.dashboard_statistik(12);
  assert (nachher #>> '{system,aufrufe_7d}')::int - (vorher #>> '{system,aufrufe_7d}')::int = 7, 'Fall 9: Aufrufe';
  assert (nachher #>> '{system,fehler_7d}')::int - (vorher #>> '{system,fehler_7d}')::int = 2, 'Fall 9: Fehler zaehlen nur 500 und 503';
  assert (nachher #>> '{system,anfragefehler_7d}')::int - (vorher #>> '{system,anfragefehler_7d}')::int = 3, 'Fall 9: Anfragefehler 400, 404, 409 ohne 429';
  assert (nachher #>> '{system,rate_limit_7d}')::int - (vorher #>> '{system,rate_limit_7d}')::int = 1, 'Fall 9: Rate-Limit';

  -- Fall 10: Eingabepruefung
  begin
    perform public.dashboard_statistik(0);
    assert false, 'Fall 10: 0 Wochen angenommen';
  exception when raise_exception then
    assert sqlerrm like 'p_wochen muss%', 'Fall 10: falsche Meldung ' || sqlerrm;
  end;
  begin
    perform public.dashboard_statistik(53);
    assert false, 'Fall 10: 53 Wochen angenommen';
  exception when raise_exception then
    assert sqlerrm like 'p_wochen muss%', 'Fall 10: falsche Meldung ' || sqlerrm;
  end;

  -- Fall 11: kein Text und keine Kennung im Ergebnis
  assert position('[TEST] statistik' in nachher::text) = 0, 'Fall 11: Meldungstext im Ergebnis';
  assert position('user_id' in nachher::text) = 0, 'Fall 11: user_id im Ergebnis';

  -- Fall 12: nur service_role darf ausfuehren
  darf := has_function_privilege('anon', 'public.dashboard_statistik(int)', 'execute')
       or has_function_privilege('authenticated', 'public.dashboard_statistik(int)', 'execute');
  assert not darf, 'Fall 12: anon oder authenticated darf die Statistik ausfuehren';
  assert has_function_privilege('service_role', 'public.dashboard_statistik(int)', 'execute'), 'Fall 12: service_role darf nicht';
end;
$$;

rollback;
select 'dashboard_statistik_test: alle Faelle bestanden' as ergebnis;
