-- Apply in the existing Supabase PostgreSQL database before deploying the API.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz;
