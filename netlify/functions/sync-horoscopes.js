const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

exports.handler = async function (event, context) {
  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.' })
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const userTimeZone = event.queryStringParameters?.timeZone || 'America/Los_Angeles';

  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: userTimeZone }).format(now);

  // NEW CODE
  try {
    // Check cache first
    const { data: existing, error: fetchErr } = await supabase
      .from('daily_horoscopes')
      .select('sign')
      .eq('date', today);

    if (fetchErr) throw fetchErr;

    // If all 12 signs exist for today, exit early
    if (existing && existing.length === SIGNS.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: `Horoscopes for ${today} are already cached. No API calls made.` })
      };
    }

    // Only fetch signs that are missing from today's cache
    const existingSigns = new Set(existing ? existing.map(item => item.sign) : []);
    const missingSigns = SIGNS.filter(sign => !existingSigns.has(sign));

    const promises = missingSigns.map(async (sign) => {
      const response = await fetch(`https://api.astrojson.com/v1/horoscopes?sign=${sign}&lang=en&date=${today}&period=daily`, {
        headers: { 'X-API-KEY': process.env.ASTRO_JSON_API_KEY || '' }
      });
      
      if (!response.ok) {
        throw new Error(`AstroJSON API error for ${sign}: ${response.statusText}`);
      }

      const json = await response.json();
      return {
        sign: sign,
        date: today,
        raw_data: json
      };
    });

    const horoscopes = await Promise.all(promises);

    const { error: dbError } = await supabase
      .from('daily_horoscopes')
      .upsert(horoscopes, { onConflict: 'sign,date' });

    if (dbError) throw dbError;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Successfully synced all horoscopes for ${today}` })
    };
  } catch (err) {
    console.error('Sync Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};