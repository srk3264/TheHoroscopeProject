const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const locationCache = new Map();
const LOCATION_CACHE_TTL = 15 * 60 * 1000;
const LOCATION_REQUEST_TIMEOUT = 3500;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCATION_REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getNearbyPlaces(city, postalCode) {
  const cacheKey = `${city}|${postalCode}`.toLowerCase().trim();
  const cached = locationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.places;

  try {
    const geocodeParams = new URLSearchParams({
      city,
      postalcode: postalCode,
      format: 'jsonv2',
      limit: '1'
    });
    const geocodeResponse = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?${geocodeParams}`,
      { headers: { 'User-Agent': 'TheHoroscopeProject/1.0 contact@thehoroscopeproject.com' } }
    );
    if (!geocodeResponse.ok) return [];

    const [location] = await geocodeResponse.json();
    if (!location?.lat || !location?.lon) return [];

    const overpassQuery = `
[out:json][timeout:3];
(
  nwr(around:5000,${location.lat},${location.lon})[leisure=park];
  nwr(around:5000,${location.lat},${location.lon})[amenity=cafe];
  nwr(around:5000,${location.lat},${location.lon})[amenity=restaurant];
  nwr(around:5000,${location.lat},${location.lon})[amenity=cinema];
  nwr(around:5000,${location.lat},${location.lon})[tourism=museum];
);
out center tags 20;
`;
    const overpassResponse = await fetchWithTimeout(
      'https://overpass-api.de/api/interpreter',
      { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: overpassQuery }
    );
    if (!overpassResponse.ok) return [];

    const overpassData = await overpassResponse.json();
    const places = (overpassData.elements || [])
      .map(({ tags = {} }) => ({
        name: tags.name,
        type: tags.amenity || tags.leisure || tags.tourism,
        cuisine: tags.cuisine,
        openingHours: tags.opening_hours
      }))
      .filter(place => place.name)
      .slice(0, 12);

    locationCache.set(cacheKey, { places, expiresAt: Date.now() + LOCATION_CACHE_TTL });
    console.log('[temporary location cache]', { cacheKey, placeCount: places.length });
    return places;
  } catch (error) {
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const authorization = event.headers.authorization || event.headers.Authorization || '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!accessToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required.' }) };
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid authenticated user.' }) };
    }

    const { actionTitle, actionReason, pairKey, date, actionIndex } = JSON.parse(event.body || '{}');
    if (!actionTitle || !actionReason || !pairKey || !date || !Number.isInteger(actionIndex)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'An action is required.' }) };
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();

    if (subscriptionError) throw subscriptionError;

    const subscriptionIsActive = subscription &&
      ['active', 'trialing'].includes(subscription.status) &&
      (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date());

    if (!subscriptionIsActive) {
      return { statusCode: 402, body: JSON.stringify({ error: 'An active subscription is required.' }) };
    }

    const { data: existingRewrite, error: existingRewriteError } = await supabase
      .from('rewritten_actions')
      .select('rewritten_title, original_reason')
      .eq('user_id', user.id)
      .eq('date', date)
      .eq('pair_key', pairKey)
      .eq('action_index', actionIndex)
      .maybeSingle();

    if (existingRewriteError) throw existingRewriteError;
    if (existingRewrite) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: existingRewrite.rewritten_title, reason: existingRewrite.original_reason, alreadyRewritten: true })
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;

    const nearbyPlaces = await getNearbyPlaces(profile.city, profile.postal_code);

    const prompt = `
Original action: ${actionTitle}
Original reason: ${actionReason}



Couple context:
- Relationship: ${profile.relationship_type || 'unspecified'}
- Distance: ${profile.distance || 'unspecified'}
- Budget: ${profile.budget_preference || 'unspecified'}
- City: ${profile.city || 'unspecified'}
- Postal code: ${profile.postal_code || 'unspecified'}
- Verified nearby OpenStreetMap places: ${JSON.stringify(nearbyPlaces)}

Rewrite this couple action to be more specific. Tell only the user exactly what to do. Keep it realistic for their distance, budget, and city. Use a verified nearby place only when it genuinely fits the original action and never invent details about it. Avoid generic advice. Make it oddly specific: name a concrete place, object, time, route, menu item, tiny ritual, or playful constraint when possible. Never write vague advice such as "spend quality time" or "communicate more". Return valid JSON only with this shape:
{"title":"An oddly specific action, maximum 24 words"}`;

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You rewrite relationship actions as vivid, oddly specific, practical JSON. Return only the requested title.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!aiResponse.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Unable to rewrite the action right now.' }) };
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '{}';
    const rewritten = JSON.parse(content);

    if (!rewritten.title) {
      throw new Error('The AI returned an incomplete action.');
    }

    const { error: insertError } = await supabase
      .from('rewritten_actions')
      .insert({
        user_id: user.id,
        date,
        pair_key: pairKey,
        action_index: actionIndex,
        original_title: actionTitle,
        original_reason: actionReason,
        rewritten_title: rewritten.title
      });

    if (insertError) throw insertError;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: rewritten.title, reason: actionReason })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
