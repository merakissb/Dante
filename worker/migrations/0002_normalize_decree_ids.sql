-- Decree ids are now canonical lowercase "dp-<digits>" (DP-1234 and dp-1234 are
-- the same decree). Existing ids are lowercased.
PRAGMA defer_foreign_keys = ON;

-- Test data typed without the "DP-" prefix, removed on request.
DELETE FROM signatures WHERE decree_id = '1234';

UPDATE signatures SET decree_id = lower(decree_id);

-- Rebuild decrees from the history: the holder is whoever received it last.
-- (Also merges two decrees that only differed by case, if there were any.)
DELETE FROM decrees;
INSERT INTO decrees (id, current_holder)
SELECT s.decree_id, s.signer_rut
FROM signatures s
WHERE s.id = (SELECT MAX(id) FROM signatures WHERE decree_id = s.decree_id);
