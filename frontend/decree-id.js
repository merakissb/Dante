'use strict';

// Same rule as the Worker's lib/decree.js: "DP-<digits>" in any letter case.
// Returns the canonical lowercase id ("dp-1234"), or null when it is not valid.
function normalizeDecreeId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return /^dp-\d{1,8}$/.test(id) ? id : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeDecreeId };
}
