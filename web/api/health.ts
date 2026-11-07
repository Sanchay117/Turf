// Liveness check for the functions runtime, with no dependencies.
export function GET(): Response {
  return new Response(JSON.stringify({ ok: true, node: process.version }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
