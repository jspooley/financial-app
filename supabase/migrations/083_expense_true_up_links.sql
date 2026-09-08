-- Line-item Expense True Up: opt an operating expense into the 50/50 split
-- and optionally link it to a Jess↔Molly transfer on Cashflow.

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS true_up_eligible BOOLEAN;

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS true_up_payment_id UUID REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_true_up_payment_id
  ON public.ledger (true_up_payment_id)
  WHERE true_up_payment_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
