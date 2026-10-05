export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Always resolves to a plain object, so handlers can read fields without
// crashing on `null`, arrays, numbers or invalid JSON.
export async function readJson(request) {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}
