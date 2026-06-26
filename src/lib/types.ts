export type CreditDebit = "credit" | "debit";
export type WholesaleRetail = "wholesale" | "retail";
export type Purchaser = "Jess" | "Molly";
export type PaymentType = "Cash" | "Check" | "CC" | "Other";

/** Columns sent to Supabase ledger table (matches your live database). */
export type LedgerInsert = {
  entry_date: string;
  cost: number;
  quantity: number;
  credit_debit: CreditDebit;
  description: string | null;
  wholesale_retail: WholesaleRetail;
  trade_partner_id: string | null;
  discount_amount: number;
  shipping_receiving_amount: number;
  tax_amount: number;
  client_id: string;
  po_number: string | null;
  purchaser: Purchaser;
  invoiced?: boolean;
  invoice_id?: string | null;
  paid?: boolean;
  date_paid?: string | null;
  paid_to?: Purchaser | null;
  payment_type?: PaymentType | null;
  payment_fee?: number | null;
  payment_amount?: number | null;
};

export interface LedgerDbRow extends Omit<
  LedgerInsert,
  | "quantity"
  | "invoiced"
  | "invoice_id"
  | "paid"
  | "date_paid"
  | "paid_to"
  | "payment_type"
  | "payment_fee"
  | "payment_amount"
> {
  id?: string;
  quantity?: number | null;
  invoiced?: boolean | null;
  invoice_id?: string | null;
  paid?: boolean | null;
  date_paid?: string | null;
  paid_to?: Purchaser | null;
  payment_type?: PaymentType | null;
  payment_fee?: number | null;
  payment_amount?: number | null;
  created_at?: string;
  updated_at?: string;
  clients?: { name: string } | null;
  trade_partners?: { company_name: string } | null;
}

export interface Client {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradePartner {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  discount_amount: number;
  minimum_purchase_amount: number;
  map_expiration: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  client_id: string;
  po_number: string;
  invoice_id?: string;
  invoice_sequence?: number;
  invoice_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, "name" | "address"> | null;
}

export interface LedgerEntry {
  id: string;
  entry_date: string;
  designer_cost: number;
  quantity: number;
  credit_debit: CreditDebit;
  description: string | null;
  wholesale_retail: WholesaleRetail;
  trade_partner_id: string | null;
  discount_percent: number;
  shipping_receiving_amount: number;
  tax_amount: number;
  customer_price?: number;
  invoiced: boolean;
  invoice_id: string | null;
  sales_and_use_tax_paid: boolean;
  client_id: string;
  po_number: string | null;
  purchaser: Purchaser;
  paid: boolean;
  date_paid: string | null;
  paid_to: Purchaser | null;
  payment_type: PaymentType | null;
  payment_fee: number;
  payment_amount: number;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, "name"> | null;
  trade_partners?: Pick<TradePartner, "company_name"> | null;
}

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: Client;
        Insert: Omit<Client, "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
        Relationships: [];
      };
      trade_partners: {
        Row: TradePartner;
        Insert: Omit<TradePartner, "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["trade_partners"]["Insert"]>;
        Relationships: [];
      };
      invoicing: {
        Row: Invoice;
        Insert: Omit<Invoice, "id" | "created_at" | "updated_at" | "clients"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["invoicing"]["Insert"]>;
        Relationships: [];
      };
      ledger: {
        Row: LedgerDbRow & { id: string; created_at: string; updated_at: string };
        Insert: LedgerInsert;
        Update: Partial<LedgerInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      credit_debit_type: CreditDebit;
      wholesale_retail_type: WholesaleRetail;
      purchaser_type: Purchaser;
    };
    CompositeTypes: Record<string, never>;
  };
}
