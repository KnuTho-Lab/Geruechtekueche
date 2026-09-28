-- Top-2: neben der Hauptkategorie die zweitbeste Kategorie samt eigener Konfidenz.
-- Entwurf mit Knut am 2026-09-28: zwei Spalten statt Zwischentabelle, weil es fest zwei sind.
-- Die Konfidenzen sind unabhaengig (keine Summe 1): ein Geruecht kann zu zwei Themen
-- zugleich passen ("Werk B schliesst, 200 Stellen weg") oder zwischen zweien schwanken
-- (Kantinenpreise). Einzige Regel: die zweite ist nicht sicherer als die erste.
-- Gespeichert wird die Zweitkategorie immer, wenn der Klassifizierer sie schickt. Ob ein
-- Geruecht uneindeutig ist, entscheidet erst das Lesen (ZWEITKATEGORIE_AB in logik.ts),
-- damit die Schwelle spaeter ohne Datenverlust kalibriert werden kann.

alter table public.geruechte
  add column zweitkategorie_id bigint references public.kategorien (kategorie_id),
  add column zweitkategorie_konfidenz numeric check (zweitkategorie_konfidenz between 0 and 1);

alter table public.geruechte
  -- beides oder keines
  add constraint geruechte_zweitkategorie_vollstaendig
    check ((zweitkategorie_id is null) = (zweitkategorie_konfidenz is null)),
  -- eine Zweitkategorie gibt es nur neben einer Hauptkategorie mit Konfidenz, sonst
  -- laesst sich "nicht sicherer als die erste" nicht pruefen
  add constraint geruechte_zweitkategorie_braucht_haupt
    check (zweitkategorie_id is null or (kategorie_id is not null and kategorie_konfidenz is not null)),
  -- null, wenn eine Seite fehlt: dann greift nur die Regel darueber
  add constraint geruechte_zweitkategorie_nicht_haupt
    check (zweitkategorie_id <> kategorie_id),
  add constraint geruechte_zweitkonfidenz_hoechstens_haupt
    check (zweitkategorie_konfidenz <= kategorie_konfidenz);

comment on column public.geruechte.zweitkategorie_id is
  'Zweitbeste Kategorie des Klassifizierers (Top-2), null = keine geliefert.';
comment on column public.geruechte.zweitkategorie_konfidenz is
  'Konfidenz der Zweitkategorie, 0 bis 1, hoechstens kategorie_konfidenz.';
