const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getUser(event) {
  const authorization = event.headers.authorization || event.headers.Authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) throw error;
  return user;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const user = await getUser(event);
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required.' }) };
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;

    const activeStatuses = new Set(['active', 'trialing']);
    const active = Boolean(
      subscription &&
      activeStatuses.has(subscription.status) &&
      (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date())
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    };
  } catch (error) {
    console.error('check-subscription error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to verify subscription.' }) };
  }
};
