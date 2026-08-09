const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

exports.handler = async function (event, context) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (const sign of SIGNS) {
    try {
      const response = await fetch(`https://api.astrojson.com/v1/horoscopes?sign=${sign}&lang=en&date=${today}&period=daily`, {
        headers: { 'X-API-KEY': process.env.ASTRO_JSON_API_KEY }
      });
      const json = await response.json();

      if (response.ok) {
        await supabase.from('daily_horoscopes').upsert({
          sign: sign,
          date: today,
          raw_data: json
        }, { onConflict: 'sign,date' });
      }
    } catch (err) {
      console.error(`Failed to sync ${sign}:`, err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ message: `Synced horoscopes for ${today}` }) };
};