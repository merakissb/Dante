export const MAX_FAILED_PER_IP = 30;
export const THROTTLE_WINDOW_MINUTES = 15;

// Results that count against an IP. Successful logins do not, and throttled
// attempts are not recorded at all, so a throttled IP recovers once its window passes.
const FAILURE_RESULTS = ['wrong_pin', 'unknown_rut', 'inactive_account', 'locked'];

// Slows down distributed guessing and RUT enumeration from one address using
// the audit log itself. The limit is generous on purpose: an office can share
// a single public IP. Unknown IPs are never throttled.
export async function isIpThrottled(env, ip) {
  if (!ip) return false;
  const since = new Date(Date.now() - THROTTLE_WINDOW_MINUTES * 60000).toISOString();
  const placeholders = FAILURE_RESULTS.map(() => '?').join(', ');
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS failures FROM access_log
     WHERE ip = ? AND created_at > ? AND result IN (${placeholders})`
  ).bind(ip, since, ...FAILURE_RESULTS).first();
  return row.failures >= MAX_FAILED_PER_IP;
}
