-- Lese-Views mit sinnvoller Spaltenreihenfolge. Postgres kann die Position einer Spalte
-- nachtraeglich nicht aendern, neue Spalten landen immer hinten. Die Tabellen bleiben das
-- Rohprotokoll, die Views sind das, was man im Table Editor anschaut (Knut, 2026-09-28).
-- security_invoker: die Views pruefen die Rechte des Aufrufers, nicht die ihres Eigentuemers.
-- anon und authenticated haben ueber die Default-Privileges ohnehin keine Rechte darauf.

-- Geruechte: zusammengehoerige Spalten nebeneinander, Kategorien mit Namen, die Anzahl der
-- Meldungen live gezaehlt (bewusst keine Zaehler-Spalte in der Tabelle, siehe Datenmodell).
create view public.geruechte_uebersicht
with (security_invoker = true)
as
select
  g.geruecht_id,
  g.status,
  g.kernaussage,
  g.kategorie_id,
  k1.name as kategorie,
  g.kategorie_konfidenz,
  g.zweitkategorie_id,
  k2.name as zweitkategorie,
  g.zweitkategorie_konfidenz,
  g.kategorie_begruendung,
  g.manuell_pruefen,
  (select count(*) from public.meldungen m where m.geruecht_id = g.geruecht_id) as anzahl_meldungen,
  g.angelegt_am,
  g.klassifiziert_am
from public.geruechte g
left join public.kategorien k1 on k1.kategorie_id = g.kategorie_id
left join public.kategorien k2 on k2.kategorie_id = g.zweitkategorie_id
order by g.geruecht_id desc;

comment on view public.geruechte_uebersicht is
  'Geruechte zum Anschauen: Kategorie und Zweitkategorie mit Namen nebeneinander, Anzahl Meldungen live gezaehlt, neueste zuerst.';

-- Anstoss-Protokoll: die ausloesende Meldung vorne, dazu ein ergebnis im Klartext.
-- Erfolgsbeleg ist das Zurueckschreiben der Kategorie (klassifiziert_am am Geruecht), nicht
-- HTTP 200: das hiesse nur, dass n8n den Aufruf angenommen hat. Solange pg_net die Antwort
-- noch nicht ans Protokoll abgegeben hat, kommt sie live aus net._http_response.
create view public.klassifizierung_protokoll
with (security_invoker = true)
as
select
  a.anstoss_id,
  a.meldung_id,
  a.geruecht_id,
  a.angestossen_am,
  case
    when a.request_id is null then 'nicht verschickt: ' || coalesce(a.fehler, 'ohne Grund')
    when g.klassifiziert_am is not null then 'klassifiziert'
    when coalesce(a.zeitueberschreitung, r.timed_out) then 'Zeitüberschreitung'
    when coalesce(a.fehler, r.error_msg) is not null then 'Fehler: ' || coalesce(a.fehler, r.error_msg)
    when coalesce(a.http_status, r.status_code) >= 400 then 'HTTP ' || coalesce(a.http_status, r.status_code)
    when coalesce(a.http_status, r.status_code) is not null then 'angenommen, Kategorie fehlt'
    else 'wartet auf Antwort'
  end as ergebnis,
  k.name as kategorie,
  g.klassifiziert_am,
  coalesce(a.http_status, r.status_code) as http_status,
  coalesce(a.zeitueberschreitung, r.timed_out) as zeitueberschreitung,
  coalesce(a.fehler, r.error_msg) as fehler,
  a.request_id,
  a.antwort_abgeholt_am
from public.klassifizierung_anstoesse a
join public.geruechte g on g.geruecht_id = a.geruecht_id
left join public.kategorien k on k.kategorie_id = g.kategorie_id
left join net._http_response r on r.id = a.request_id and a.antwort_abgeholt_am is null
order by a.anstoss_id desc;

comment on view public.klassifizierung_protokoll is
  'Anstoss-Protokoll zum Anschauen: ausloesende Meldung vorne, ergebnis im Klartext, neueste zuerst. Rohdaten in klassifizierung_anstoesse.';
