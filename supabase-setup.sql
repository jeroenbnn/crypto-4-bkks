-- Run this SQL in your Supabase SQL Editor to set up the table
-- Go to: https://supabase.com/dashboard → your project → SQL Editor

-- ============================================================
-- CLEANUP: verwijder alle adressen behalve het hoofdadres
-- ============================================================
DELETE FROM btc_addresses
WHERE address <> '1JcjfwBdHgA1bqQtFfCuhf7PfbbDS1Wqoy';

-- Zorg dat het hoofdadres de juiste main_address heeft
UPDATE btc_addresses
SET main_address = '1JcjfwBdHgA1bqQtFfCuhf7PfbbDS1Wqoy'
WHERE address = '1JcjfwBdHgA1bqQtFfCuhf7PfbbDS1Wqoy';

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS btc_addresses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  address_index INTEGER NOT NULL,
  path TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alias TEXT,
  balance_satoshi BIGINT DEFAULT 0,
  is_used BOOLEAN DEFAULT FALSE,
  balance_updated_at TIMESTAMPTZ,
  main_address TEXT NOT NULL DEFAULT '1JcjfwBdHgA1bqQtFfCuhf7PfbbDS1Wqoy',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns if the table already exists (safe to run multiple times)
ALTER TABLE btc_addresses ADD COLUMN IF NOT EXISTS balance_satoshi BIGINT DEFAULT 0;
ALTER TABLE btc_addresses ADD COLUMN IF NOT EXISTS is_used BOOLEAN DEFAULT FALSE;
ALTER TABLE btc_addresses ADD COLUMN IF NOT EXISTS balance_updated_at TIMESTAMPTZ;
ALTER TABLE btc_addresses ADD COLUMN IF NOT EXISTS main_address TEXT NOT NULL DEFAULT '1JcjfwBdHgA1bqQtFfCuhf7PfbbDS1Wqoy';
ALTER TABLE btc_addresses ADD COLUMN IF NOT EXISTS alias TEXT;

-- Ensure unique address_index per wallet
ALTER TABLE btc_addresses DROP CONSTRAINT IF EXISTS btc_addresses_wallet_id_address_index_key;
ALTER TABLE btc_addresses ADD CONSTRAINT btc_addresses_wallet_id_address_index_key UNIQUE (wallet_id, address_index);

-- Enable RLS
ALTER TABLE btc_addresses ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow anon select" ON btc_addresses;
DROP POLICY IF EXISTS "Allow anon insert" ON btc_addresses;
DROP POLICY IF EXISTS "Allow anon update" ON btc_addresses;

-- Allow anon role to read all rows
CREATE POLICY "Allow anon select"
  ON btc_addresses
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon role to insert rows
CREATE POLICY "Allow anon insert"
  ON btc_addresses
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anon role to update rows
CREATE POLICY "Allow anon update"
  ON btc_addresses
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anon role to delete rows
DROP POLICY IF EXISTS "Allow anon delete" ON btc_addresses;
CREATE POLICY "Allow anon delete"
  ON btc_addresses
  FOR DELETE
  TO anon
  USING (true);
