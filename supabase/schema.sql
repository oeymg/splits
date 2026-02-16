-- Supabase schema scaffold for Splits MVP

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  phone text,
  email text,
  created_at timestamptz default now()
);

create table if not exists payment_prefs (
  user_id uuid primary key references auth.users on delete cascade,
  method text not null default 'PAYID',
  payid_value text,
  bsb text,
  account text,
  note text,
  updated_at timestamptz default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz default now()
);

create table if not exists group_members (
  group_id uuid not null references groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member',
  created_at timestamptz default now(),
  primary key (group_id, user_id)
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  image_url text,
  merchant text,
  receipt_date date,
  subtotal numeric(10, 2),
  tax numeric(10, 2),
  total numeric(10, 2),
  raw_ocr_text text,
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz default now()
);

create table if not exists line_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts on delete cascade,
  name text not null,
  price numeric(10, 2) not null default 0
);

create table if not exists allocations (
  id uuid primary key default gen_random_uuid(),
  line_item_id uuid not null references line_items on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  split_type text not null default 'single',
  weight numeric(6, 4) default 1
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts on delete cascade,
  payer_user_id uuid not null references auth.users on delete cascade,
  payee_user_id uuid not null references auth.users on delete cascade,
  amount numeric(10, 2) not null,
  status text not null default 'pending',
  created_at timestamptz default now()
);

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text,
  expo_push_token text not null unique,
  platform text,
  updated_at timestamptz default now()
);

create index if not exists device_tokens_phone_idx on device_tokens (phone);

alter table profiles enable row level security;
alter table payment_prefs enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table receipts enable row level security;
alter table line_items enable row level security;
alter table allocations enable row level security;
alter table settlements enable row level security;
alter table device_tokens enable row level security;

-- Profiles: only owner
create policy if not exists "profiles_owner_select" on profiles
  for select using (auth.uid() = id);
create policy if not exists "profiles_owner_upsert" on profiles
  for insert with check (auth.uid() = id);
create policy if not exists "profiles_owner_update" on profiles
  for update using (auth.uid() = id);

-- Payment prefs: only owner
create policy if not exists "payment_prefs_owner_select" on payment_prefs
  for select using (auth.uid() = user_id);
create policy if not exists "payment_prefs_owner_upsert" on payment_prefs
  for insert with check (auth.uid() = user_id);
create policy if not exists "payment_prefs_owner_update" on payment_prefs
  for update using (auth.uid() = user_id);

-- Groups: members can read
create policy if not exists "groups_member_select" on groups
  for select using (
    exists (select 1 from group_members gm where gm.group_id = id and gm.user_id = auth.uid())
  );
create policy if not exists "groups_creator_insert" on groups
  for insert with check (auth.uid() = created_by);

-- Group members: members can read, creators can add
create policy if not exists "group_members_select" on group_members
  for select using (
    exists (select 1 from group_members gm where gm.group_id = group_id and gm.user_id = auth.uid())
  );
create policy if not exists "group_members_insert" on group_members
  for insert with check (
    exists (select 1 from groups g where g.id = group_id and g.created_by = auth.uid())
  );

-- Receipts: group members can read
create policy if not exists "receipts_select" on receipts
  for select using (
    exists (select 1 from group_members gm where gm.group_id = group_id and gm.user_id = auth.uid())
  );
create policy if not exists "receipts_insert" on receipts
  for insert with check (
    exists (select 1 from group_members gm where gm.group_id = group_id and gm.user_id = auth.uid())
  );

-- Line items + allocations: inherit receipt access
create policy if not exists "line_items_select" on line_items
  for select using (
    exists (
      select 1
      from receipts r
      join group_members gm on gm.group_id = r.group_id
      where r.id = receipt_id and gm.user_id = auth.uid()
    )
  );
create policy if not exists "line_items_insert" on line_items
  for insert with check (
    exists (
      select 1
      from receipts r
      join group_members gm on gm.group_id = r.group_id
      where r.id = receipt_id and gm.user_id = auth.uid()
    )
  );

create policy if not exists "allocations_select" on allocations
  for select using (
    exists (
      select 1
      from line_items li
      join receipts r on r.id = li.receipt_id
      join group_members gm on gm.group_id = r.group_id
      where li.id = line_item_id and gm.user_id = auth.uid()
    )
  );
create policy if not exists "allocations_insert" on allocations
  for insert with check (
    exists (
      select 1
      from line_items li
      join receipts r on r.id = li.receipt_id
      join group_members gm on gm.group_id = r.group_id
      where li.id = line_item_id and gm.user_id = auth.uid()
    )
  );

-- Settlements: group members can read, payer can insert
create policy if not exists "settlements_select" on settlements
  for select using (
    exists (
      select 1
      from receipts r
      join group_members gm on gm.group_id = r.group_id
      where r.id = receipt_id and gm.user_id = auth.uid()
    )
  );
create policy if not exists "settlements_insert" on settlements
  for insert with check (auth.uid() = payer_user_id);
