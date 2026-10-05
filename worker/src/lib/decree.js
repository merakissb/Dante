// Decree IDs are "DP-<digits>" in any letter case. The canonical (stored and
// searched) form is lowercase, so DP-1234 and dp-1234 are the same decree.
const DECREE_ID_PATTERN = /^dp-\d{1,8}$/;

export function normalizeDecreeId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return DECREE_ID_PATTERN.test(id) ? id : null;
}
