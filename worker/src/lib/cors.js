// Only these origins may call the API from a browser.
// The localhost ones are for the Docker development setup.
export const ALLOWED_ORIGINS = [
  'https://dante-frontend-ashen.vercel.app',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

export function withCors(response, request) {
  const origin = request.headers.get('Origin');
  if (ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}
