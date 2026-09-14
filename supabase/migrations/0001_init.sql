-- Stick It Out schema (steps 1–3 ship the funnel; later UI still needs these tables)
-- Apply in Supabase SQL editor or via `supabase db push`.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text generated always as (lower(email)) stored,
  name text,
  source text not null default 'free-lesson',
  confirm_token text unique,
  confirm_expires_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_normalized)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id text not null check (plan_id in ('monthly', 'biannual', 'annual')),
  status text not null default 'incomplete'
    check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'waitlist')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  week_number integer,
  is_free boolean not null default false,
  published boolean not null default false,
  video_url text,
  description text,
  cover_image text,
  created_at timestamptz not null default now()
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  cover_image text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.track_lessons (
  track_id uuid not null references public.tracks (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  position integer not null default 0,
  primary key (track_id, lesson_id)
);

create table if not exists public.lesson_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  status text not null default 'started' check (status in ('started', 'completed')),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists public.bpm_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete set null,
  bpm integer not null check (bpm between 30 and 400),
  logged_at timestamptz not null default now()
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  url text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid references public.subscribers (id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscribers_confirm_token_idx on public.subscribers (confirm_token);
create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists bpm_logs_user_id_idx on public.bpm_logs (user_id);
create index if not exists submissions_challenge_id_idx on public.submissions (challenge_id);
create index if not exists email_events_subscriber_id_idx on public.email_events (subscriber_id);

-- ---------------------------------------------------------------------------
-- Profile bootstrap from auth.users
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- Service role (API / webhooks) bypasses RLS. Anon and authenticated are locked down.
-- ---------------------------------------------------------------------------

alter table public.subscribers enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.lessons enable row level security;
alter table public.tracks enable row level security;
alter table public.track_lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.bpm_logs enable row level security;
alter table public.challenges enable row level security;
alter table public.submissions enable row level security;
alter table public.email_events enable row level security;

-- subscribers: no client access (insert/confirm via service role in /api/subscribe + /api/confirm)
revoke all on public.subscribers from anon, authenticated;

-- email_events: service role only
revoke all on public.email_events from anon, authenticated;

-- profiles: own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- memberships: read own; writes via service role (Stripe webhook later)
drop policy if exists "memberships_select_own" on public.memberships;
create policy "memberships_select_own"
  on public.memberships for select
  to authenticated
  using (auth.uid() = user_id);

-- catalog: published rows readable by anyone
drop policy if exists "lessons_select_published" on public.lessons;
create policy "lessons_select_published"
  on public.lessons for select
  to anon, authenticated
  using (published = true);

drop policy if exists "tracks_select_published" on public.tracks;
create policy "tracks_select_published"
  on public.tracks for select
  to anon, authenticated
  using (published = true);

drop policy if exists "track_lessons_select_published" on public.track_lessons;
create policy "track_lessons_select_published"
  on public.track_lessons for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.tracks t
      where t.id = track_id and t.published = true
    )
  );

drop policy if exists "challenges_select_published" on public.challenges;
create policy "challenges_select_published"
  on public.challenges for select
  to anon, authenticated
  using (published = true);

-- progress + BPM: own rows only
drop policy if exists "lesson_progress_own" on public.lesson_progress;
create policy "lesson_progress_own"
  on public.lesson_progress for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bpm_logs_own" on public.bpm_logs;
create policy "bpm_logs_own"
  on public.bpm_logs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- submissions: insert/select own; no public browse until moderation UI
drop policy if exists "submissions_select_own" on public.submissions;
create policy "submissions_select_own"
  on public.submissions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "submissions_insert_own" on public.submissions;
create policy "submissions_insert_own"
  on public.submissions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "submissions_update_own_pending" on public.submissions;
create policy "submissions_update_own_pending"
  on public.submissions for update
  to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'pending');
