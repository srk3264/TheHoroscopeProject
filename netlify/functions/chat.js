const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, pairId, userLocalDate, prompt } = JSON.parse(event.body);

    if (!userId || !pairId || !prompt || !userLocalDate) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // 1. Fetch user & partner signs from profiles
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('user_sign, partner_sign')
      .eq('id', userId)
      .single();

    if (profileErr) throw profileErr;

   // 2. Fetch today's pair insight with auto-sync fallback
    let { data: insightData } = await supabase
      .from('daily_pair_insights')
      .select('content')
      .eq('pair_key', pairId)
      .eq('date', userLocalDate)
      .maybeSingle();

    if (!insightData?.content) {
      const origin = event.headers.origin || `https://${event.headers.host}`;
      const syncRes = await fetch(`${origin}/.netlify/functions/sync-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairKey: pairId, date: userLocalDate })
      });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        insightData = syncData.data;
      }
    }

    const todayInsight = insightData?.content 
      ? JSON.stringify(insightData.content) 
      : "No specific daily insight available today.";

    // 3. Rate-limiting check BEFORE fetching full chat history
    const localMidnightISO = new Date(`${userLocalDate}T00:00:00`).toISOString();
    const { data: userMsgs, error: limitErr } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('user_id', userId)
      .eq('sender', 'user')
      .gte('created_at', localMidnightISO)
      .order('created_at', { ascending: false });

    if (limitErr) throw limitErr;

    if (userMsgs && userMsgs.length > 0) {
      const lastMsgTime = new Date(userMsgs[0].created_at).getTime();
      
      if (Date.now() - lastMsgTime < 3000) {
        return {
          statusCode: 429,
          body: JSON.stringify({ error: 'Please wait a few seconds before sending another message.' })
        };
      }

      if (userMsgs.length >= 10) {
        return {
          statusCode: 429,
          body: JSON.stringify({ error: 'Daily message limit reached (10/10). Try again tomorrow!' })
        };
      }
    }

    // 4. Fetch chat history starting from local midnight (00:00:00)
    const { data: history, error: historyErr } = await supabase
      .from('chat_messages')
      .select('sender, message, created_at')
      .eq('pair_id', pairId)
      .gte('created_at', localMidnightISO)
      .order('created_at', { ascending: true });

    if (historyErr) throw historyErr;

    // 5. Save incoming user message
    await supabase.from('chat_messages').insert({
      user_id: userId,
      pair_id: pairId,
      sender: 'user',
      message: prompt
    });

    // 5. Build prompt context for Nemotron
    const systemMessage = {
      role: 'system',
      content: `You are an empathetic relationship & astrology AI assistant for a couple (${profile.user_sign} and ${profile.partner_sign}). \nToday's daily relationship insight context: ${todayInsight}. \nUse this context to answer ${profile.user_sign} query directly and supportively`
    };

    const formattedHistory = (history || []).map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.message
    }));

    // 6. Query NVIDIA Nemotron via OpenRouter
    const openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3.5-lightning:free",
        messages: [systemMessage, ...formattedHistory, { role: 'user', content: prompt }]
      })
    });

    const openrouterData = await openrouterRes.json();
    const assistantReply = openrouterData.choices?.[0]?.message?.content || "Sorry, I couldn't process that right now.";

    // 7. Save assistant reply
    await supabase.from('chat_messages').insert({
      user_id: userId,
      pair_id: pairId,
      sender: 'assistant',
      message: assistantReply
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: assistantReply })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};