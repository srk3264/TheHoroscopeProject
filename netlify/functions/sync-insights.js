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
  const [sign1, sign2] = pairKey.split('_');

  try {
    const { data: horoscopes, error: fetchErr } = await supabase
      .from('daily_horoscopes')
      .select('sign, raw_data')
      .eq('date', date)
      .in('sign', [sign1, sign2]);

    if (fetchErr) throw fetchErr;

    const sign1Data = horoscopes.find((h) => h.sign === sign1)?.raw_data || {};
    const sign2Data = horoscopes.find((h) => h.sign === sign2)?.raw_data || {};

    const prompt = `
You are an expert astrologer synthesizing daily couple insights for ${sign1} and ${sign2}.

CRITICAL CONSTRAINT: You must generate your entire response using ONLY the exact astrological details, themes, and traits provided in the horoscopes below. Do NOT use outside general knowledge or make up external astrological facts.

${sign1} Horoscope: ${JSON.stringify(sign1Data)}
${sign2} Horoscope: ${JSON.stringify(sign2Data)}

Generate daily pair insights strictly in this JSON format:
{
  "quick_insights": {
    "wear": {
      "title": "Short outfit advice (max 6 words)",
      "reason": "Reason based strictly on the provided horoscope data (max 10 words)"
    },
    "binge": {
      "title": "Movie/show title or genre (max 5 words)",
      "reason": "Reason based strictly on the provided horoscope data (max 10 words)"
    },
    "cook": {
      "title": "Meal or cuisine idea (max 5 words)",
      "reason": "Reason based strictly on the provided horoscope data (max 10 words)"
    },
    "vibe": {
      "title": "Relationship energy status (max 4 words)",
      "reason": "Reason based strictly on the provided horoscope data (max 10 words)"
    }
  },
  "actions": [
    {
      "title": "Clear action advice (max 12 words)",
      "reason": "Reason based strictly on the provided horoscope data (max 15 words)"
    }
  ]
}

Rules:
1. Provide EXACTLY 2 to 3 action items inside the "actions" array.
2. Do not repeat advice between quick_insights and actions.
3. Base all outputs exclusively on the provided horoscope JSON above.
4. Respond strictly with raw JSON.
`;

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
    
    // Strip code block backticks if present
    const cleanedJson = rawChoice.replace(/```json|```/g, '').trim();
    const insightsContent = JSON.parse(cleanedJson);

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