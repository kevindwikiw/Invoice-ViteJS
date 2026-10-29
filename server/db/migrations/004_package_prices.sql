-- Apply to the existing Supabase Postgres database before deploying the package API.
-- Existing packages.price values remain unchanged as historical references.
create table if not exists package_prices (
  package_id integer not null references packages(id) on delete cascade,
  city text not null,
  year integer not null check (year between 2000 and 2100),
  price bigint not null check (price >= 0),
  primary key (package_id, city, year)
);
