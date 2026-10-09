const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      .select('rewritten_title, rewritten_reason')
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
        body: JSON.stringify({ title: existingRewrite.rewritten_title, reason: existingRewrite.rewritten_reason, alreadyRewritten: true })
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;

    const prompt = `
Rewrite this couple action to be more specific and useful for today.

Original action: ${actionTitle}
Original reason: ${actionReason}

Couple context:
- Relationship: ${profile.relationship_type || 'unspecified'}
- Distance: ${profile.distance || 'unspecified'}
- Budget: ${profile.budget_preference || 'unspecified'}
- City: ${profile.city || 'unspecified'}
- Postal code: ${profile.postal_code || 'unspecified'}

Tell only the user exactly what to do. Keep it realistic for their distance, budget, and city. Avoid generic advice. Return valid JSON only with this shape:
{"title":"A concise action, maximum 24 words","reason":"Why it fits, maximum 15 words"}`;

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
          { role: 'system', content: 'You rewrite relationship actions as concise, practical JSON.' },
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

    if (!rewritten.title || !rewritten.reason) {
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
        rewritten_title: rewritten.title,
        rewritten_reason: rewritten.reason
      });

    if (insertError) throw insertError;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: rewritten.title, reason: rewritten.reason })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
