-- S&U tax is collected from the client and remitted to the state the following
-- month. Migration 061 gave each wholesale line a tax companion dated to the
-- purchase, which implied cash left the account on the purchase date and would
-- double-count against the actual remittance entered on Cashflow.
--
-- Cash basis: drop the tax companions. The monthly remittance is entered as a
-- single Cashflow row with CoA '214 Taxes and licenses'. Shipping and payment
-- fee companions stay -- those are real costs at purchase / payment time.

DELETE FROM ledger
WHERE companion_kind = 'tax';

NOTIFY pgrst, 'reload schema';
