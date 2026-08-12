const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!supabaseUrl || !supabaseKey || !openrouterApiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing required environment variables.' })
    };
  }

  const { pairKey, date } = JSON.parse(event.body || '{}');

  if (!pairKey || !date) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing pairKey or date parameter.' })
    };
  }

 const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Inline cache verification before hitting OpenRouter
    const { data: existing } = await supabase
      .from('daily_pair_insights')
      .select('content')
      .eq('pair_key', pairKey)
      .eq('date', date)
      .maybeSingle();

    if (existing && existing.content) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, data: existing })
      };
    }

    const [sign1, sign2] = pairKey.split('_');
    const { data: horoscopes, error: fetchErr } = await supabase
      .from('daily_horoscopes')
      .select('sign, raw_data')
      .eq('date', date)
      .in('sign', [sign1, sign2]);

    if (fetchErr) throw fetchErr;

    const sign1Data = horoscopes?.find((h) => h.sign === sign1)?.raw_data || {};
    const sign2Data = horoscopes?.find((h) => h.sign === sign2)?.raw_data || {};

    const prompt = `...`;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openrouterApiKey}`
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!aiRes.ok) {
      const errorText = await aiRes.text();
      throw new Error(`OpenRouter API error (${aiRes.status}): ${errorText}`);
    }

    const aiJson = await aiRes.json();
    const rawChoice = aiJson.choices?.[0]?.message?.content || '';
    
    // Extract valid JSON string starting from '{' to '}'
    const jsonMatch = rawChoice.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Model output did not contain valid JSON: ${rawChoice}`);
    }

    const insightsContent = JSON.parse(jsonMatch[0]);

    const { data, error: dbErr } = await supabase
      .from('daily_pair_insights')
      .upsert(
        {
          date: date,
          pair_key: pairKey,
          content: insightsContent
        },
        { onConflict: 'date,pair_key' }
      )
      .select()
      .single();

    if (dbErr) throw dbErr;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, data })
    };
  } catch (err) {
    console.error('sync-insights error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};