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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { STRIPE_SECRET_KEY, APP_URL } = process.env;
  if (!STRIPE_SECRET_KEY || !APP_URL) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Payment configuration is incomplete.' }) };
  }

  try {
    const user = await getUser(event);
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required.' }) };
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (subscriptionError) throw subscriptionError;
    if (!subscription?.stripe_customer_id) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No subscription found.' }) };
    }

    const params = new URLSearchParams({
      customer: subscription.stripe_customer_id,
      return_url: APP_URL
    });

    const stripeResponse = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${STRIPE_SECRET_KEY}:`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      console.error('Stripe portal error:', session);
      return { statusCode: 502, body: JSON.stringify({ error: 'Unable to open subscription settings.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (error) {
    console.error('create-portal-session error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to open subscription settings.' }) };
  }
};
