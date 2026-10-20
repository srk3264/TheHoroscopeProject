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
  const userTimeZone =
  event.queryStringParameters?.timeZone || 'America/Los_Angeles';

const requestedDate = event.queryStringParameters?.date;
const now = new Date();

const today = requestedDate || new Intl.DateTimeFormat('en-CA', {
  timeZone: userTimeZone
}).format(now);

if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Invalid date. Expected YYYY-MM-DD.' })
  };
}

  // NEW CODE
  try {
    // Check cache first
    const { data: existing, error: fetchErr } = await supabase
      .from('daily_horoscopes')
      .select('sign')
      .eq('date', today);

    if (fetchErr) throw fetchErr;

    // If all 12 signs exist for today, exit early
    const existingSigns = new Set(existing ? existing.map(item => item.sign) : []);
    if (SIGNS.every(sign => existingSigns.has(sign))) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: `Horoscopes for ${today} are already cached. No API calls made.` })
      };
    }

    // Fetch Zodiac Timeline's RSS feed and select the requested date.
const response = await fetch('https://zodiactimeline.com/feed.xml');

if (!response.ok) {
  const errorBody = await response.text();
  throw new Error(
    `Zodiac Timeline feed error: ${response.status} ${errorBody}`
  );
}

const xml = await response.text();

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getXmlTag(item, tag) {
  const escapedTag = tag.replace(':', '\\:');
  const regex = new RegExp(
    `<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`
  );
  const match = item.match(regex);
  return match ? decodeXml(match[1].trim()) : '';
}

const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/g) || [];
const horoscopeMap = new Map();

for (const item of items) {
  const sign = getXmlTag(item, 'zt:sign').toLowerCase();
  const date = getXmlTag(item, 'zt:date');

  if (!SIGNS.includes(sign) || date !== today) continue;

  horoscopeMap.set(sign, {
    sign,
    date,
    title: getXmlTag(item, 'title'),
    description: getXmlTag(item, 'description'),
    score: Number(getXmlTag(item, 'zt:score')),
    link: getXmlTag(item, 'link')
  });
}

const missingSigns = SIGNS.filter(sign => !horoscopeMap.has(sign));

if (missingSigns.length > 0) {
  throw new Error(
    `Zodiac Timeline feed has no ${today} horoscope for: ${missingSigns.join(', ')}`
  );
}

const horoscopes = SIGNS.map(sign => ({
  sign,
  date: today,
  raw_data: horoscopeMap.get(sign)
}));

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