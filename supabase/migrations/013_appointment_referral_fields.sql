ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS referred_by TEXT;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS referral_source TEXT
  CHECK (
    referral_source IS NULL
    OR referral_source IN (
      'Instagram',
      'Facebook',
      'Word of Mouth',
      'Web Search',
      'Other'
    )
  );

NOTIFY pgrst, 'reload schema';
