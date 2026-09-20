-- Non-cash true-up offset on an invoice: settle remaining discrepancy without
-- posting a checking 303/304. Used when a partner nets unrelated expenses
-- instead of sending the full required transfer.

ALTER TABLE public.invoicing
  ADD COLUMN IF NOT EXISTS true_up_offset_accepted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.invoicing
  ADD COLUMN IF NOT EXISTS true_up_offset_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE public.invoicing
  DROP CONSTRAINT IF EXISTS invoicing_true_up_offset_reason_length;

ALTER TABLE public.invoicing
  ADD CONSTRAINT invoicing_true_up_offset_reason_length
  CHECK (char_length(true_up_offset_reason) <= 250);

NOTIFY pgrst, 'reload schema';
