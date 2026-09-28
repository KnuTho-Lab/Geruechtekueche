-- Jede Kategorie bekommt eine Beschreibung: was sie umfasst und wogegen sie sich abgrenzt.
-- Der Klassifizierer liest sie ueber GET /kategorien mit in seinen Prompt. Anlass: vier
-- Geruechte mit Konfidenz 0,7 lagen in der Grauzone Personal/Verguetung/Standort, drei
-- davon Zusatzleistungen (Kantine, Parkplatz, Betriebsausflug).
-- Texte von Claude entworfen, von Knut am 2026-09-28 so freigegeben. Festgelegt damit:
-- Zusatzleistungen gehoeren zu Vergütung.

alter table public.kategorien add column beschreibung text;

update public.kategorien set beschreibung = case name
  when 'Standort' then
    'Schließung, Verlagerung, Eröffnung oder Ausbau von Werken, Büros und Niederlassungen. '
    'Es geht um das Wo, nicht um die betroffenen Menschen (→ Personal).'
  when 'Personal' then
    'Einstellungen, Entlassungen, Stellenabbau, Versetzungen und Wechsel von Führungskräften. '
    'Es geht um die Köpfe, nicht um Geld (→ Vergütung) oder Struktur (→ Organisation).'
  when 'Vergütung' then
    'Geld und geldwerte Leistungen: Gehalt, Bonus, Weihnachtsgeld, Zuschüsse sowie Zusatzleistungen '
    'wie Kantine, Parkplatz und Betriebsfeiern.'
  when 'Organisation' then
    'Umstrukturierung, Auslagerung, Eigentümerwechsel, Prozesse, IT-Systeme und Arbeitsregeln wie '
    'Homeoffice. Einzelne Personalien gehören zu Personal.'
  when 'Produkt' then
    'Was das Unternehmen herstellt oder verkauft: Produktstarts, Qualitätsprobleme, Rückrufe, '
    'Kunden und Aufträge.'
  when 'Sicherheit' then
    'Arbeits- und Brandschutz, Unfälle, Gesundheitsgefahren, IT-Sicherheits- und Datenschutzvorfälle.'
end;

-- Scheitert, falls eine Kategorie keinen Text bekommen hat (etwa eine neue, hier nicht
-- aufgefuehrte): dann bricht die ganze Migration ab statt eine leere Beschreibung zu hinterlassen
alter table public.kategorien alter column beschreibung set not null;
alter table public.kategorien
  add constraint kategorien_beschreibung_nicht_leer check (btrim(beschreibung) <> '');

comment on column public.kategorien.beschreibung is
  'Was die Kategorie umfasst und wogegen sie sich abgrenzt. Geht ueber GET /kategorien in den Prompt des Klassifizierers.';
