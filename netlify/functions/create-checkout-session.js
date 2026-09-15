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

  const { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL } = process.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !APP_URL) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Payment configuration is incomplete.' }) };
  }

  try {
    const user = await getUser(event);
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required.' }) };
    }

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      'client_reference_id': user.id,
      'metadata[user_id]': user.id,
      'subscription_data[metadata][user_id]': user.id,
      'customer_email': user.email || '',
      'success_url': `${APP_URL}?checkout=success`,
      'cancel_url': `${APP_URL}?checkout=cancelled`,
      'allow_promotion_codes': 'true'
    });

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${STRIPE_SECRET_KEY}:`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      console.error('Stripe checkout error:', session);
      return { statusCode: 502, body: JSON.stringify({ error: 'Unable to start checkout.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (error) {
    console.error('create-checkout-session error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to start checkout.' }) };
  }
};
