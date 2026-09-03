-- Card charges stay on the card. Paid vs unpaid is reimbursed_by_ledger_id
-- pointing at the checking 308. Do not keep a ghost credit on the card.

DELETE FROM public.ledger
WHERE companion_kind = 'card_reimburse';

NOTIFY pgrst, 'reload schema';
