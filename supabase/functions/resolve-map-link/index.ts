// Resolve a Google Maps share link (maps.app.goo.gl / goo.gl/maps) to its full URL.
// Browsers cannot follow these redirects (CORS), so we do it here.
// Strict allowlist: only Google Maps hosts are ever fetched, every redirect hop is
// re-checked, nothing else is proxied, and only the final URL is returned (no body).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GOOGLE_HOST = /^(www\.|maps\.)?google\.(com|co\.za|[a-z]{2,3}|com?\.[a-z]{2})$/

export function allowed(u: URL): boolean {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return false
  const h = u.hostname.toLowerCase()
  if (h === 'maps.app.goo.gl') return true
  if (h === 'goo.gl') return u.pathname.startsWith('/maps')
  if (h === 'consent.google.com') return true
  if (GOOGLE_HOST.test(h)) return h.startsWith('maps.') || u.pathname.startsWith('/maps') || u.pathname === '/url' || u.pathname === '/search'
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    let cur: URL
    try { cur = new URL(String(body.url || '').trim()) } catch { return json({ error: 'invalid url' }, 400) }
    if (!allowed(cur)) return json({ error: 'only Google Maps links are allowed' }, 400)
    for (let hop = 0; hop < 6; hop++) {
      // consent.google.com wraps the real target in ?continue=
      if (cur.hostname === 'consent.google.com') {
        const c = cur.searchParams.get('continue')
        if (!c) break
        const next = new URL(c)
        if (!allowed(next)) return json({ error: 'redirect left Google Maps' }, 400)
        cur = next
        continue
      }
      const short = cur.hostname === 'maps.app.goo.gl' || cur.hostname === 'goo.gl'
      if (!short) break
      const res = await fetch(cur.toString(), {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (FieldLynk map link resolver)' },
        signal: AbortSignal.timeout(6000),
      })
      await res.body?.cancel()
      const loc = res.headers.get('location')
      if (!loc || res.status < 300 || res.status >= 400) return json({ error: `no redirect (${res.status})` }, 404)
      const next = new URL(loc, cur)
      if (!allowed(next)) return json({ error: 'redirect left Google Maps' }, 400)
      cur = next
    }
    return json({ url: cur.toString() })
  } catch (e) {
    return json({ error: (e as Error).message || 'Unexpected error' }, 500)
  }
})
