-- Optional manual migration for the dedicated Turso feedback database.
-- The Hono adapter also runs these idempotent statements on first use.

create table if not exists feedback (
  id integer primary key autoincrement,
  invoice_id integer,
  invoice_no text not null,
  client_name text,
  rating integer not null check (rating between 1 and 5),
  tags text not null default '[]',
  message text not null,
  photo_data blob,
  photo_mime text,
  photo_size integer,
  status text not null default 'new' check (status in ('new', 'reviewed')),
  reviewed_by integer,
  reviewed_at text,
  created_at text not null default current_timestamp
);

create index if not exists idx_feedback_status_created_at
  on feedback(status, created_at desc);

create index if not exists idx_feedback_invoice_no
  on feedback(invoice_no);
