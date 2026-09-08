-- Why a ledger line was excluded from partner true-up (Exclude = Yes).

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS true_up_exclude_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE public.ledger
  DROP CONSTRAINT IF EXISTS ledger_true_up_exclude_reason_length;

ALTER TABLE public.ledger
  ADD CONSTRAINT ledger_true_up_exclude_reason_length
  CHECK (char_length(true_up_exclude_reason) <= 250);

NOTIFY pgrst, 'reload schema';
