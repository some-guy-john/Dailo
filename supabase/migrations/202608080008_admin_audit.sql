create table public.dailo_admin_audit (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_key text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index dailo_admin_audit_created_idx on public.dailo_admin_audit (created_at desc);
alter table public.dailo_admin_audit enable row level security;
revoke all on table public.dailo_admin_audit from anon, authenticated;
