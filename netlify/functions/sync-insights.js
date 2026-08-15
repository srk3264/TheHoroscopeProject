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

    const systemPrompt = "You are a JSON-only API. You output raw, valid JSON objects. Never output conversation, greetings, or explanations.";
    
    const userPrompt = `
Synthesize daily couple insights for ${sign1} and ${sign2}.

${sign1} Horoscope: ${JSON.stringify(sign1Data)}
${sign2} Horoscope: ${JSON.stringify(sign2Data)}

Generate daily pair insights strictly in this JSON format:
{
  "quick_insights": {
    "wear": { "title": "Short outfit advice (max 6 words)", "reason": "Reason (max 10 words)" },
    "binge": { "title": "Movie/show title or genre (max 5 words)", "reason": "Reason (max 10 words)" },
    "cook": { "title": "Meal idea (max 5 words)", "reason": "Reason (max 10 words)" },
    "vibe": { "title": "Status (max 4 words)", "reason": "Reason (max 10 words)" }
  },
  "actions": [
    { "title": "Clear action advice (max 12 words)", "reason": "Reason (max 15 words)" }
  ]
}

Rules:
1. Provide EXACTLY 2 to 3 action items in the "actions" array.
2. Output valid JSON only without markdown formatting.
`;

    let insightsContent = null;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts && !insightsContent) {
      attempts++;
      
      const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openrouterApiKey}`
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (!aiRes.ok) {
        const errorText = await aiRes.text();
        console.error(`Attempt ${attempts} failed HTTP: ${errorText}`);
        continue;
      }

      const aiJson = await aiRes.json();
      const rawChoice = aiJson.choices?.[0]?.message?.content || '';
      const jsonMatch = rawChoice.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          insightsContent = JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error(`Attempt ${attempts} JSON parse error:`, e.message);
        }
      }
    }

    if (!insightsContent) {
      throw new Error('Failed to obtain valid JSON from model after retries.');
    }

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