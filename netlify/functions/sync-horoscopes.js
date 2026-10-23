
const { createClient } = require('@supabase/supabase-js');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FEED_URL = 'https://zodiactimeline.com/feed.xml';

const SIGNS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn',
  'aquarius', 'pisces'
];

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: true,
  trimValues: true
});

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function isValidDate(date) {
  if (typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
}

function getLocalDate(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeItems(items) {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed. Use POST.' });
  }

  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse(500, {
      error: 'Missing Supabase server environment variables.'
    });
  }

  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    '';

  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);

  if (!tokenMatch) {
    return jsonResponse(401, { error: 'Authentication required.' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser(tokenMatch[1]);

    if (authError || !user) {
      return jsonResponse(401, {
        error: 'Invalid or expired session.'
      });
    }

    let body;

    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, {
        error: 'Invalid JSON request body.'
      });
    }

    const { date, timeZone } = body;

    if (
      !isValidDate(date) ||
      typeof timeZone !== 'string' ||
      !timeZone.trim() ||
      timeZone.length > 100
    ) {
      return jsonResponse(400, {
        error: 'A valid date and timeZone are required.'
      });
    }

    let expectedDate;

    try {
      expectedDate = getLocalDate(timeZone);
    } catch {
      return jsonResponse(400, { error: 'Invalid timeZone.' });
    }

    if (date !== expectedDate) {
      return jsonResponse(400, {
        error: 'Date must match today in the supplied timeZone.',
        expectedDate
      });
    }

    // Fetch the publisher's feed directly. Never trust horoscope
    // content submitted by the browser.
    const feedResponse = await fetch(FEED_URL, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!feedResponse.ok) {
  console.error('Horoscope feed diagnostic:', {
    status: feedResponse.status,
    statusText: feedResponse.statusText,
    url: FEED_URL,
    headers: Object.fromEntries(feedResponse.headers.entries()),
    body: (await feedResponse.text()).slice(0, 1000)
  });

  return jsonResponse(502, {
    error: 'The horoscope publisher could not be reached.'
  });
}

    const contentType = feedResponse.headers.get('content-type') || '';

    if (!/xml/i.test(contentType)) {
      return jsonResponse(502, {
        error: 'The horoscope publisher did not return XML.'
      });
    }

    const xmlText = await feedResponse.text();

    if (XMLValidator.validate(xmlText) !== true) {
      return jsonResponse(502, {
        error: 'The horoscope publisher returned invalid XML.'
      });
    }

    const feed = parser.parse(xmlText);
    const items = normalizeItems(feed?.rss?.channel?.item);

    if (!items.length) {
      return jsonResponse(502, {
        error: 'No horoscope records were found in the RSS feed.'
      });
    }

    // Select only records for the requested local date.
    const dailyItems = items.filter(item =>
      String(item.date || '') === date
    );

    if (dailyItems.length !== 12) {
      console.error('Unexpected daily horoscope count:', {
        date,
        count: dailyItems.length,
        totalFeedItems: items.length
      });

      return jsonResponse(502, {
        error: 'The feed did not contain exactly 12 records for the requested date.'
      });
    }

    const receivedSigns = new Set();
    const rows = [];

    for (const item of dailyItems) {
      const sign = String(item.sign || '').trim().toLowerCase();
      const title = String(item.title || '').trim();
      const description = String(item.description || '').trim();
      const score = Number(item.score);
      const linkText = String(item.link || '').trim();
      const guid = String(item.guid || '').trim();

      if (
        !SIGNS.includes(sign) ||
        receivedSigns.has(sign) ||
        !title ||
        !description ||
        description.length > 10000 ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 10 ||
        guid !== `${sign}-${date}`
      ) {
        return jsonResponse(502, {
          error: `Invalid or duplicate publisher record for ${sign || 'unknown sign'}.`
        });
      }

      let link;

      try {
        link = new URL(linkText);
      } catch {
        return jsonResponse(502, {
          error: `Invalid publisher link for ${sign}.`
        });
      }

      // The publisher uses relative day labels in its URLs.
      // Verify the trusted domain and the matching zodiac sign,
      // rather than assuming the date appears in the URL.
      if (
        link.protocol !== 'https:' ||
        link.hostname !== 'zodiactimeline.com' ||
        link.pathname.split('/')[1] !== sign ||
        link.pathname.split('/').filter(Boolean).length !== 2 ||
        ![
          'today',
          'tomorrow',
          'day-after-tomorrow',
          'yesterday',
          'day-before-yesterday'
        ].includes(link.pathname.split('/')[2])
      ) {
        return jsonResponse(502, {
          error: `Unexpected publisher link for ${sign}.`
        });
      }

      receivedSigns.add(sign);

      rows.push({
        date,
        sign,
        raw_data: {
          sign,
          date,
          title,
          description,
          score,
          link: link.href
        }
      });
    }

    if (receivedSigns.size !== 12 ||
        !SIGNS.every(sign => receivedSigns.has(sign))) {
      return jsonResponse(502, {
        error: 'The feed is missing one or more zodiac signs.'
      });
    }

    const { error: dbError } = await supabase
      .from('daily_horoscopes')
      .upsert(rows, { onConflict: 'sign,date' });

    if (dbError) {
      console.error('Supabase horoscope upsert error:', dbError);

      return jsonResponse(500, {
        error: 'Unable to save horoscopes.'
      });
    }

    return jsonResponse(200, {
      success: true,
      message: `Successfully synced all 12 horoscopes for ${date}.`,
      date,
      count: rows.length
    });
  } catch (error) {
    console.error('Horoscope sync error:', error);

    return jsonResponse(500, {
      error: 'Unexpected server error.'
    });
  }
};
