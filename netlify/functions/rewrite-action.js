const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);




const FINDLOCAL_SUPPORTED_METROS = new Set([
  'ann-arbor',
  'atlanta',
  'austin',
  'baltimore',
  'bangor',
  'bloomington',
  'boise',
  'boston',
  'brattleboro',
  'buffalo',
  'burlington',
  'cape-cod',
  'charleston',
  'charlotte',
  'chicago',
  'cincinnati',
  'cleveland',
  'columbia-mo',
  'columbus',
  'dallas',
  'denver',
  'des-moines',
  'detroit',
  'duluth',
  'fort-collins',
  'grand-rapids',
  'green-bay',
  'hanover',
  'harrisburg',
  'hartford',
  'hilton-head',
  'houston',
  'hudson-valley',
  'indianapolis',
  'iowa-city',
  'jersey-shore',
  'kansas-city',
  'lansing',
  'las-vegas',
  'lincoln',
  'london',
  'los-angeles',
  'madison',
  'manchester',
  'miami',
  'milwaukee',
  'minneapolis',
  'nashville',
  'new-haven',
  'new-orleans',
  'new-york',
  'northampton',
  'oklahoma-city',
  'orlando',
  'philadelphia',
  'phoenix',
  'pittsburgh',
  'pittsfield',
  'portland',
  'portland-me',
  'portsmouth',
  'providence',
  'raleigh',
  'rochester',
  'rockland',
  'rutland',
  'sacramento',
  'salt-lake-city',
  'san-antonio',
  'san-diego',
  'san-francisco',
  'santa-barbara',
  'seattle',
  'sonoma',
  'spokane',
  'st-louis',
  'stamford',
  'tampa',
  'traverse-city',
  'tucson',
  'washington',
  'wenatchee',
  'wilmington-nc',
  'worcester'
]);

const FINDLOCAL_REQUEST_TIMEOUT = 5000;

async function getNearbyEvents(city) {
  const apiKey = process.env.FINDLOCAL_API_KEY?.trim();

const citySlug = (city || '')
  .split(',')[0]
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

if (!apiKey || !FINDLOCAL_SUPPORTED_METROS.has(citySlug)) {
  return {
    events: [],
    status: 'unavailable',
    eventCount: 0,
    eventNames: []
  };
}

const cacheKey = citySlug;

const { data: cached, error: cacheError } = await supabase
  .from('findlocal_event_cache')
  .select('events')
  .eq('cache_key', cacheKey)
  .maybeSingle();

if (cacheError) throw cacheError;

if (cached) {
  const events = cached.events || [];
  return {
    events,
    status: 'cache',
    eventCount: events.length,
    eventNames: events.map(event => event.name)
  };
}

  if (cached && cached.expiresAt > Date.now()) {
    return {
      events: cached.events,
      status: 'cache',
      eventCount: cached.events.length,
      eventNames: cached.events.map(event => event.name)
    };
  }

  const params = new URLSearchParams({
  city: citySlug,
  when: 'today',
  limit: '10',
  sort: 'date'
});

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    FINDLOCAL_REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(
      `https://findlocal.community/api/events?${params}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json'
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();

      console.error('FindLocal API error:', {
        status: response.status,
        body: errorBody,
        city: citySlug
      });

      return {
        events: [],
        status: `http_${response.status}`,
        eventCount: 0,
        eventNames: []
      };
    }

    const result = await response.json();

    // TEMP: Inspect raw FindLocal response metadata
console.log('[FindLocal] API response:', {
  city: citySlug,
  totalElements: result.meta?.total,
  returnedEvents: result.data?.length ?? 0,
  events: result.data
});

    const events = (result.data || []).map(event => ({
      name: event.title,
      date: event.event_date,
      time: event.start_time || undefined,
      venue: event.venue_name || undefined,
      city: event.city || city,
      url: event.detail_page_url ||
        `https://findlocal.community/event/${event.id}`,
      priceRange: event.price || undefined,
      priceAmount: event.price_amount ?? undefined,
      category: event.category || undefined,
      description: event.description || undefined
    }));

    console.log('FindLocal diagnostic:', {
      city: citySlug,
      totalElements: result.meta?.total,
      eventCount: events.length
    });

    const { error: cacheWriteError } = await supabase
  .from('findlocal_event_cache')
  .upsert({
    cache_key: cacheKey,
    events,
    fetched_at: new Date().toISOString()
  }, { onConflict: 'cache_key' });

if (cacheWriteError) {
  console.error('FindLocal cache write failed:', cacheWriteError);
}

    return {
      events,
      status: 'fetched',
      eventCount: events.length,
      eventNames: events.map(event => event.name)
    };
  } catch (error) {
    console.error('FindLocal request failed:', error.message);

    return {
      events: [],
      status: 'unavailable',
      eventCount: 0,
      eventNames: []
    };
  } finally {
    clearTimeout(timeout);
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
        body: JSON.stringify({
          title: existingRewrite.rewritten_title,
          reason: existingRewrite.original_reason,
          alreadyRewritten: true,
        })
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;

    const findLocalLookup = await getNearbyEvents(profile.city);
const nearbyEvents = findLocalLookup.events;

// TEMP: FindLocal event diagnostics
console.log('[FindLocal] Lookup summary:', {
  city: profile.city,
  postalCode: profile.postal_code,
  status: findLocalLookup.status,
  eventCount: findLocalLookup.eventCount,
  eventNames: findLocalLookup.eventNames
});

console.log('[FindLocal] Events passed to AI:', nearbyEvents);

    const prompt = `
Original action: ${actionTitle}
Original reason: ${actionReason}



Couple context:
- Relationship: ${profile.relationship_type || 'unspecified'}
- Distance: ${profile.distance || 'unspecified'}
- Budget: ${profile.budget_preference || 'unspecified'}
- City/metro: ${profile.city || 'unspecified'}
- ZIP/postal code: ${profile.postal_code || 'unspecified'}
- FindLocal events happening today: ${JSON.stringify(nearbyEvents)}

Rewrite this couple action to be more specific. Tell only the user exactly what to do. Keep it realistic for their distance, budget, and city. Use a FindLocal event only if it genuinely fits the budget and relationship context; do not invent event details, availability, or prices, and do not imply attendance is possible unless the event data supports it. Avoid generic advice. Make it oddly specific using a concrete object, time, route, menu item, tiny ritual, or playful constraint when possible. Never write vague advice such as "spend quality time" or "communicate more". Return valid JSON only with this shape:
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
      body: JSON.stringify({
  title: rewritten.title,
  reason: actionReason,
  findLocalLookup
})
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
