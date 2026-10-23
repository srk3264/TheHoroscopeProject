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

  
  let body;

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON request body.' })
    };
  }

  const { pairKey, date, timeZone } = body;

  const SIGNS = [
    'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
    'libra', 'scorpio', 'sagittarius', 'capricorn',
    'aquarius', 'pisces'
  ];

  if (
    typeof pairKey !== 'string' ||
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof timeZone !== 'string' ||
    timeZone.length > 100
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Valid pairKey, date, and timeZone are required.'
      })
    };
  }

  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid calendar date.' })
    };
  }

  const pairSigns = pairKey.split('_');

  if (
    pairSigns.length !== 2 ||
    pairSigns.some(sign => !SIGNS.includes(sign))
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid zodiac pairKey.' })
    };
  }

  let expectedDate;

  try {
    expectedDate = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    // Normalize the formatted date to YYYY-MM-DD.
    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    const dateValues = Object.fromEntries(
      dateParts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, part.value])
    );

    expectedDate =
      `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid timeZone.' })
    };
  }

  if (date !== expectedDate) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Date must match today in the supplied timeZone.',
        expectedDate
      })
    };
  }


    const supabase = createClient(supabaseUrl, supabaseKey);

  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    '';

  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);

  if (!tokenMatch) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Authentication required.' })
    };
  }

  try {
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser(tokenMatch[1]);

    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid or expired session.' })
      };
    }

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

    
    const [sign1, sign2] = pairSigns;


    
    // Horoscopes must already be synced by app.js.
    // This function only reads saved horoscope data.


    const { data: horoscopes, error: fetchErr } = await supabase
      .from('daily_horoscopes')
      .select('sign, raw_data')
      .eq('date', date)
      .in('sign', [sign1, sign2]);

    if (fetchErr) throw fetchErr;

        const sign1Data = horoscopes?.find((h) => h.sign === sign1)?.raw_data;
    const sign2Data = horoscopes?.find((h) => h.sign === sign2)?.raw_data;

    if (
      !sign1Data?.description ||
      !sign2Data?.description ||
      !Number.isFinite(sign1Data.score) ||
      !Number.isFinite(sign2Data.score)
    ) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: 'Both valid horoscope records must be synced before generating insights.'
        })
      };
    }

    const systemPrompt = "You are a JSON-only API. You output raw, valid JSON objects. Never output conversation, greetings, or explanations.";
    
    const userPrompt = `
    Refer to ${sign1} as 'You' & ${sign2} as 'Your Partner'

${sign1} Horoscope:
Description: ${sign1Data.description || 'Not available'}
Overall score: ${sign1Data.score ?? 'Not available'}

${sign2} Horoscope:
Description: ${sign2Data.description || 'Not available'}
Overall score: ${sign2Data.score ?? 'Not available'}

Compare the overall horoscope scores:
A = ${sign1}'s overall score.
B = ${sign2}'s overall score.
Δ = A - B.

Interpretation:
- Δ >= 1: ${sign1} has the higher overall score; use that energy
  constructively to support ${sign2}.
- Δ <= -1: ${sign2} has the higher overall score; use that energy
  constructively to support ${sign1}.
- Equal scores: look for shared opportunities or complementary
  themes in both horoscope descriptions.
- If both scores are low (3 or below), suggest gentle, low-pressure
  activities.



Generate daily pair insights strictly in this JSON format:
{
  "quick_insights": {
    "wear": { "title": "Short outfit advice (max 6 words)", "reason": "Reason (max 10 words)" },
    "binge": { "title": "Name Movie/show title (max 5 words)", "reason": "Reason (max 10 words)" },
    "cook": { "title": "Name a Meal (max 5 words)", "reason": "Reason (max 10 words)" },
    "vibe": { "title": "Name a song/artist (max 4 words)", "reason": "Reason (max 10 words)" }
  },
  "actions": [
    

{ "title": "Write freakishly relatable, screenshot-worthy date ideas for ${sign1} and ${sign2} today (max 24 words). Start with a painfully specific behavior, tiny conflict, or unspoken desire alternatively from ${sign1}'s & ${sign2}'s horoscope, then turn it into an oddly specific date that satisfies both signs. Make it sound like a friend who knows their relationship a little too well. Include one vivid, concrete detail or playful rule. Prioritize recognition, humor, and emotional accuracy over astrology clichés. No generic date ideas, therapy-speak, advice, or forced sentimentality. It should feel like a TikTok comment someone screenshots because it’s TOO accurate. Refer to ${sign1} as 'You' and ${sign2} as 'Your Partner'.", "reason": "Explain the connection to both horoscopes in max 15 words, citing the zodiac signs and exact phrases from each horoscope." }
  ]
}

Rules:
- Generate upto a maximum of 8 actions 
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
          model: 'openai/gpt-4o-mini',
          response_format: { 
              type: 'json_schema',
              json_schema: {
                name: 'daily_pair_insights',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    quick_insights: {
                      type: 'object',
                      properties: {
                        wear: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'], additionalProperties: false },
                        binge: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'], additionalProperties: false },
                        cook: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'], additionalProperties: false },
                        vibe: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'], additionalProperties: false }
                      },
                      required: ['wear', 'binge', 'cook', 'vibe'],
                      additionalProperties: false
                    },
                    actions: {
                      type: 'array',
                      maxItems: 8,
                      items: {
                        type: 'object',
                        properties: {
                          title: { type: 'string' },
                          reason: { type: 'string' }
                        },
                        required: ['title', 'reason'],
                        additionalProperties: false
                      }
                    }
                  },
                  required: ['quick_insights', 'actions'],
                  additionalProperties: false
                }
              }
          },
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