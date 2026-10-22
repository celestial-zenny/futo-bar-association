-- Barrister profiles and logins, and two extra case fields.
alter table public.barristers
  add column user_id   uuid unique references auth.users (id) on delete set null,
  add column bio       text not null default '' check (length(bio) <= 1200),
  add column areas     text[] not null default '{}',
  add column photo_url text check (photo_url is null or photo_url ~ '^https://');
create index barristers_user_idx on public.barristers (user_id);
alter table public.cases
  add column judiciary_suit_number text check (judiciary_suit_number is null or length(judiciary_suit_number) <= 60),
  add column barrister_note text check (barrister_note is null or length(barrister_note) <= 2000);
