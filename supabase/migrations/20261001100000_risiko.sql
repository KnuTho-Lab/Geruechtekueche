-- Risikowert je Geruecht aus dem Risikomodell (gbert-large v2, Knut, 2026-10-01).
-- Das Modell laeuft lokal auf Knuts Rechner. Antwortet es nicht, darf das die Klassifizierung
-- nie blockieren: das Geruecht bekommt risiko_status 'queue' und wird auf Knuts Anstoss
-- (POST risiko_nachholen) nachgeliefert.
--
-- risiko_status:
--   ausstehend  Geruecht ist noch nicht klassifiziert, das Risiko kommt zusammen mit der Kategorie
--   berechnet   risiko ist gesetzt
--   queue       klassifiziert, aber das Modell hat nicht geantwortet: wartet auf risiko_nachholen
--
-- Bewertet wird der Text der ERSTEN Meldung des Geruechts (Gewaehlt: so wurde das Modell
-- trainiert, auf einzelnen Meldungstexten; die Kernaussage ist ein anderes Textformat).
-- Spaetere Meldungen aendern das Risiko nicht.

alter table public.geruechte
  add column risiko numeric check (risiko between 0 and 1),
  add column risiko_status text not null default 'ausstehend'
    check (risiko_status in ('ausstehend', 'berechnet', 'queue')),
  add column risiko_berechnet_am timestamptz,
  add column risiko_modell text;

alter table public.geruechte
  -- berechnet heisst: Wert, Zeitpunkt und Modell sind da, und nur dann
  add constraint geruechte_risiko_vollstaendig
    check (
      (risiko_status = 'berechnet') = (risiko is not null)
      and (risiko is not null) = (risiko_berechnet_am is not null)
      and (risiko is not null) = (risiko_modell is not null)
    ),
  -- queue und berechnet gibt es erst nach der Klassifizierung
  add constraint geruechte_risiko_nach_klassifizierung
    check (risiko_status = 'ausstehend' or kategorie_id is not null);

comment on column public.geruechte.risiko is
  'Risikowert 0 (harmlos) bis 1 (dringend) aus dem Risikomodell, leer solange risiko_status nicht berechnet ist.';
comment on column public.geruechte.risiko_status is
  'ausstehend = noch nicht klassifiziert, berechnet = risiko gesetzt, queue = Modell hat nicht geantwortet, wartet auf POST risiko_nachholen.';
comment on column public.geruechte.risiko_berechnet_am is 'Zeitpunkt, zu dem das Risiko gesetzt wurde.';
comment on column public.geruechte.risiko_modell is 'Welches Modell den Wert geliefert hat, z. B. gbert-large-v2.';

-- Bestand: bereits klassifizierte Geruechte haben noch kein Risiko und warten auf das Nachholen
update public.geruechte set risiko_status = 'queue' where kategorie_id is not null;

create index geruechte_risiko_queue on public.geruechte (geruecht_id) where risiko_status = 'queue';

-- Uebersicht: Risiko neben der Kategorie. Postgres kann Spalten nicht einfuegen, deshalb
-- die View neu anlegen (nichts haengt von ihr ab).
drop view public.geruechte_uebersicht;

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
  g.risiko,
  g.risiko_status,
  g.risiko_berechnet_am,
  g.risiko_modell,
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
  'Geruechte zum Anschauen: Kategorie, Zweitkategorie und Risiko mit Status nebeneinander, Anzahl Meldungen live gezaehlt, neueste zuerst.';
