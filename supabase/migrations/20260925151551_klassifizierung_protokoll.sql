-- Protokoll des Klassifizierers: vorerst nur mitgeschrieben, noch von nichts ausgewertet.
-- Spaeter nuetzlich zum Kalibrieren (Konfidenz) und fuer den Mensch-im-Loop (manuell_pruefen).
alter table geruechte
  add column kategorie_konfidenz numeric check (kategorie_konfidenz between 0 and 1),
  add column kategorie_begruendung text,
  add column manuell_pruefen boolean not null default false;

comment on column geruechte.kategorie_konfidenz is 'Konfidenz des Klassifizierers, 0 bis 1.';
comment on column geruechte.kategorie_begruendung is 'Kurze Begruendung des Klassifizierers.';
comment on column geruechte.manuell_pruefen is 'Vom Klassifizierer zur manuellen Pruefung markiert.';
