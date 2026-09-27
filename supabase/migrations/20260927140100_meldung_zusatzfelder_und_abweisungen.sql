-- Zusatzangaben des Agenten fuer das Dashboard, alle optional. Thomas' Intake-Agent
-- erhebt sie schon (n8n/intake-agent.json), schrieb sie bisher aber nur in eine
-- n8n-Data-Table.
-- Feste Wertelisten per CHECK, damit das Dashboard zaehlen kann. Dieselben Listen stehen in
-- supabase/functions/_shared/logik.ts (EMOTIONEN, QUELLENKETTEN, ABWEISUNGSGRUENDE), ein
-- Unit-Test gleicht beide ab. Aendern nur ueber eine neue Migration plus logik.ts.
alter table public.meldungen
  add column standort text check (char_length(standort) between 1 and 100),
  add column emotion text check (emotion in ('neutral', 'besorgt', 'ängstlich', 'verärgert', 'hoffnungsvoll')),
  add column quellenkette text check (quellenkette in ('selbst erlebt', 'von Beteiligten gehört', 'weitererzählt', 'unbekannt')),
  add column geschwaerzte_namen smallint check (geschwaerzte_namen between 0 and 100);

-- Standort bewusst frei und grob: eine feste Standortliste gibt es noch nicht. Ein zu
-- feiner Standort (Team, Buero) kann die meldende Person verraten.
comment on column public.meldungen.standort is 'Betroffener Standort laut Agent, grob (Werk, Gebaeude). Leer = nicht genannt.';
comment on column public.meldungen.emotion is 'Grundstimmung der meldenden Person laut Agent. Leer = nicht erkennbar.';
comment on column public.meldungen.quellenkette is 'Woher die Person es hat, laut Agent. Leer = nicht erfragt.';
comment on column public.meldungen.geschwaerzte_namen is 'Anzahl der Personennamen, die der Agent durch Rollen ersetzt hat.';

-- Eingaben, die der Agent NICHT als Meldung speichert. Nur der Grund, nie der Text.
create table public.abweisungen (
  abweisung_id bigint generated always as identity primary key,
  zeitpunkt    timestamptz not null default now(),
  grund        text not null check (grund in ('prompt_injection', 'kein_geruecht', 'beleidigung', 'sonstiges'))
);

alter table public.abweisungen enable row level security;

create index abweisungen_zeitpunkt on public.abweisungen (zeitpunkt);

comment on table public.abweisungen is
  'Vom Agenten abgewiesene Eingaben, nur Zeitpunkt und Grund. Fuer die Statistik im Dashboard.';
