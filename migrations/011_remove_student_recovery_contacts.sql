BEGIN;

-- Password-reset challenges are now authorized by the authoritative
-- students.email value rather than a separately verified contact.
ALTER TABLE student_password_reset_challenges
  DROP CONSTRAINT IF EXISTS student_password_reset_contact_tenant_fk;
ALTER TABLE student_password_reset_challenges
  DROP COLUMN IF EXISTS contact_id;

-- These tables only supported the retired separate Student recovery-contact
-- workflow. Drop the dependent verification challenges before their contacts.
DROP TABLE IF EXISTS student_recovery_contact_verification_challenges;
DROP TABLE IF EXISTS student_verified_recovery_contacts;

COMMIT;