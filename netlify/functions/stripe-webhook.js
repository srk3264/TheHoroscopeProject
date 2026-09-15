const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getRawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
}

function isValidSignature(payload, signatureHeader, secret) {
  const values = Object.fromEntries(
    signatureHeader.split(',').map((part) => part.split('='))
  );
  const timestamp = values.t;
  const signature = values.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}

async function saveSubscription(subscription, userId) {
  if (!userId) throw new Error('Stripe event did not include a Supabase user ID.');

  const { error } = await supabase.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });

  if (error) throw error;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!secret || !signature) {
    return { statusCode: 400, body: 'Missing webhook configuration.' };
  }

  const payload = getRawBody(event);
  if (!isValidSignature(payload, signature, secret)) {
    return { statusCode: 400, body: 'Invalid webhook signature.' };
  }

  try {
    const stripeEvent = JSON.parse(payload);
    const object = stripeEvent.data?.object;

    if (stripeEvent.type === 'checkout.session.completed') {
      const subscriptionId = object.subscription;
      const userId = object.metadata?.user_id || object.client_reference_id;
      if (subscriptionId) {
        const response = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
          headers: { Authorization: `Basic ${Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString('base64')}` }
        });
        const subscription = await response.json();
        if (!response.ok) throw new Error('Unable to retrieve Stripe subscription.');
        await saveSubscription(subscription, userId);
      }
    }

    if (stripeEvent.type === 'customer.subscription.created' || stripeEvent.type === 'customer.subscription.updated') {
      const userId = object.metadata?.user_id;
      await saveSubscription(object, userId);
    }

    if (stripeEvent.type === 'customer.subscription.deleted') {
      const { error } = await supabase
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', object.id);
      if (error) throw error;
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error('stripe-webhook error:', error);
    return { statusCode: 500, body: 'Webhook processing failed.' };
  }
};
