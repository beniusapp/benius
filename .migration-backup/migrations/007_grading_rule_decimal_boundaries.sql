ALTER TABLE grading_rules
  ALTER COLUMN min_percent TYPE NUMERIC(5,2)
  USING min_percent::NUMERIC(5,2),
  ALTER COLUMN max_percent TYPE NUMERIC(5,2)
  USING max_percent::NUMERIC(5,2);