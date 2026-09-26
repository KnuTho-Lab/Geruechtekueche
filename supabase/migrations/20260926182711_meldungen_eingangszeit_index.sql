-- Index auf die Eingangszeit der Meldungen. Zwei Nutzer:
--   1. das Rate-Limit in POST /meldung zaehlt bei jedem Aufruf die Meldungen der letzten
--      Minute und der letzten 24 Stunden,
--   2. GET /geruechte holt je Geruecht die frueheste Meldung.
-- Ohne Index liest jede Zaehlung die ganze Tabelle, das wird mit jeder Meldung teurer.
-- Zusammengesetzt (geruecht_id, eingegangen_am), damit er auch fuer "frueheste Meldung
-- je Geruecht" passt; fuer die Zaehlung ueber alle Geruechte der zweite, einfache Index.
create index meldungen_eingegangen_am on public.meldungen (eingegangen_am);
create index meldungen_geruecht_eingegangen_am on public.meldungen (geruecht_id, eingegangen_am);
