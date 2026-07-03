import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const token = Deno.env.get('MAPBOX_ACCESS_TOKEN')
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'MAPBOX_ACCESS_TOKEN not configured on server' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
      )
    }

    let address = ''
    let country = 'za'
    if (req.method === 'GET') {
      const url = new URL(req.url)
      address = url.searchParams.get('address') || ''
      country = url.searchParams.get('country') || country
    } else {
      const body = await req.json().catch(() => ({}))
      address = body.address || ''
      country = body.country || country
    }

    address = String(address).trim()
    if (!address || address.length < 3) {
      return new Response(
        JSON.stringify({ error: 'address is required (min 3 chars)' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      )
    }

    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json` +
      `?access_token=${token}&limit=1&country=${encodeURIComponent(country)}`

    const res = await fetch(url)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return new Response(
        JSON.stringify({ error: `Mapbox error ${res.status}`, detail: text.slice(0, 200) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 },
      )
    }
    const data = await res.json()
    const feat = data?.features?.[0]
    if (!feat) {
      return new Response(
        JSON.stringify({ found: false, error: 'No match for address' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }
    const [lng, lat] = feat.center as [number, number]
    return new Response(
      JSON.stringify({
        found: true,
        latitude: lat,
        longitude: lng,
        place_name: feat.place_name || address,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message || 'Unexpected error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    )
  }
})
