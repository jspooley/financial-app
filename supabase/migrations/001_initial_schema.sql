-- Financial Management App Schema
-- Run this in the Supabase SQL Editor after creating your project.

-- Enums
CREATE TYPE credit_debit_type AS ENUM ('credit', 'debit');
CREATE TYPE wholesale_retail_type AS ENUM ('wholesale', 'retail');
CREATE TYPE purchaser_type AS ENUM ('Jess', 'Molly');

-- Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trade Partners
CREATE TABLE trade_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  minimum_purchase_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  map_expiration DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invoicing
CREATE TABLE invoicing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  po_number TEXT NOT NULL,
  invoice_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, po_number)
);

-- Ledger
CREATE TABLE ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cost NUMERIC(12, 2) NOT NULL,
  credit_debit credit_debit_type NOT NULL,
  description TEXT,
  wholesale_retail wholesale_retail_type NOT NULL DEFAULT 'retail',
  trade_partner_id UUID REFERENCES trade_partners(id) ON DELETE SET NULL,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  shipping_receiving_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  po_number TEXT,
  purchaser purchaser_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_invoicing_fk
    FOREIGN KEY (client_id, po_number)
    REFERENCES invoicing(client_id, po_number)
    DEFERRABLE INITIALLY DEFERRED
);

-- Indexes
CREATE INDEX idx_invoicing_client_id ON invoicing(client_id);
CREATE INDEX idx_ledger_client_id ON ledger(client_id);
CREATE INDEX idx_ledger_entry_date ON ledger(entry_date DESC);
CREATE INDEX idx_ledger_trade_partner_id ON ledger(trade_partner_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trade_partners_updated_at BEFORE UPDATE ON trade_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER invoicing_updated_at BEFORE UPDATE ON invoicing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER ledger_updated_at BEFORE UPDATE ON ledger
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoicing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write all business data (shared company data)
CREATE POLICY "Authenticated users can select clients"
  ON clients FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert clients"
  ON clients FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update clients"
  ON clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete clients"
  ON clients FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can select trade_partners"
  ON trade_partners FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert trade_partners"
  ON trade_partners FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update trade_partners"
  ON trade_partners FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete trade_partners"
  ON trade_partners FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can select invoicing"
  ON invoicing FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert invoicing"
  ON invoicing FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update invoicing"
  ON invoicing FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete invoicing"
  ON invoicing FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can select ledger"
  ON ledger FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert ledger"
  ON ledger FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update ledger"
  ON ledger FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete ledger"
  ON ledger FOR DELETE TO authenticated USING (true);
