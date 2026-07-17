-- Careflow hospital queue schema
create extension if not exists "pgcrypto";

create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  key text not null,
  name text not null,
  specialty text not null,
  serving_ticket_id uuid null,
  done_count integer not null default 0,
  consult_history integer[] not null default '{10,10,10,10,10}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, key)
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  name text not null,
  phone text not null default '—',
  status text not null default 'waiting'
    check (status in ('waiting','serving','done','cancelled','noshow')),
  source text not null default 'manual'
    check (source in ('manual','qr','self')),
  position_at_join integer not null default 0,
  called_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table doctors
  drop constraint if exists doctors_serving_ticket_id_fkey;

alter table doctors
  add constraint doctors_serving_ticket_id_fkey
  foreign key (serving_ticket_id) references tickets(id) on delete set null;

create index if not exists tickets_doctor_status_created_idx
  on tickets (doctor_id, status, created_at);

create table if not exists rbac_configs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  roles jsonb not null default '[]'::jsonb,
  pages jsonb not null default '[]'::jsonb,
  page_access jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table clinics enable row level security;
alter table doctors enable row level security;
alter table tickets enable row level security;
alter table rbac_configs enable row level security;

create policy "careflow clinics all" on clinics for all using (true) with check (true);
create policy "careflow doctors all" on doctors for all using (true) with check (true);
create policy "careflow tickets all" on tickets for all using (true) with check (true);
create policy "careflow rbac all" on rbac_configs for all using (true) with check (true);
