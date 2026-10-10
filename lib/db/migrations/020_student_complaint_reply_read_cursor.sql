-- Additive schema preparation for reply-aware Student Complaint receipts.
-- Existing receipt rows and complaint records are intentionally not backfilled
-- or modified here. Reply-aware behavior must remain disabled until an approved
-- legacy receipt interpretation is chosen and the migration is verified.
ALTER TABLE student_complaint_read_receipts
  ADD COLUMN last_read_note_id INTEGER;

-- Supports latest qualifying Teacher/Admin note lookups per complaint.
CREATE INDEX complaint_notes_reply_cursor_idx
  ON complaint_notes (complaint_id, author_role, id);
