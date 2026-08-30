// 1. Initialize Supabase Client
// Replace these placeholders with your credentials from Phase 1 (Project Settings -> API)
const SUPABASE_URL = 'https://omltsxprptctzmhvebla.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_raGNw8eXWxEANqBiwHjBXw_qG2DD8JT';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global state variables for settings
let currentUserSign = '';
let currentPartnerSign = '';



// 2. State & View Navigation Helpers
function showView(viewId) {
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

// 3. Auth Handlers
async function handleLogin() {
  const email = document.getElementById('email-input').value;
  if (!email) return alert('Please enter your email address.');

  const { error } = await supabaseClient.auth.signInWithOtp({ email });
  if (error) {
    alert('Error sending magic link: ' + error.message);
  } else {
    alert('Magic link sent! Check your email inbox.');
  }
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  showView('view-login');
}

// 4. Onboarding Handler
async function savePreferences() {
  const userSign = document.getElementById('user-sign').value;
  const partnerSign = document.getElementById('partner-sign').value;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert('No active session found.');

  const { error } = await supabaseClient.from('profiles').update({
    user_sign: userSign,
    partner_sign: partnerSign
  }).eq('id', user.id);

  if (error) {
    alert('Error saving preferences: ' + error.message);
  } else {
    loadDashboard(userSign, partnerSign);
  }
}

// 5. Render Mock Insights to Figma Cards
function renderDashboard(userSign, partnerSign, data) {
  // Safely normalize sign keys and set emojis
  const uKey = userSign ? userSign.toLowerCase() : '';
  const pKey = partnerSign ? partnerSign.toLowerCase() : '';

  // NEW
const zodiacHeaderHTML = `
  <div class="zodiac-card-header" style="display: flex; justify-content: center; align-items: center; gap: 12px; margin-bottom: 24px;">
    <img src="assets/${uKey}.svg" alt="${uKey}" style="width: 48px; height: 48px; filter: brightness(0) invert(1);" />
    <img src="assets/${pKey}.svg" alt="${pKey}" style="width: 48px; height: 48px; filter: brightness(0) invert(1);" />
  </div>
`;
  
  const now = new Date();

// Updates top-left day (e.g., "Sat")
const currentDayEl = document.getElementById('current-day');
if (currentDayEl) {
  currentDayEl.innerText = now.toLocaleDateString('en-US', { weekday: 'short' });
}

// Updates top-left full date heading (e.g., "Saturday, Aug 8")
const currentDateEl = document.getElementById('current-date');
if (currentDateEl) {
  currentDateEl.innerText = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
}

// Render Quick Cards with embedded SVG Header
  const quickContainer = document.getElementById('quick-insights-container');
  quickContainer.innerHTML = data.quick.map(item => `
    <div class="card-item" style="height: 100vh; width: 100vw; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; background: transparent;">
      ${zodiacHeaderHTML}
      <div style="text-align: center; color: white; font-size: 40px; font-family: 'Averia Serif Libre', serif;">${item.title}</div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 16px;">
        <div style="font-size: 48px;">${item.emoji}</div>
        <div style="text-align: center; color: white; font-size: 16px; font-weight: 600;">${item.headline}</div>
        <div style="text-align: center; color: rgba(255, 255, 255, 0.60); font-size: 13px; font-style: italic;">${item.reason}</div>
      </div>
    </div>
  `).join('');

  // Render Action Cards with embedded SVG Header
  const actionContainer = document.getElementById('actions-container');
  actionContainer.innerHTML = data.actions.map((act, idx) => `
    <div class="action-card" style="height: 100vh; width: 100vw; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; background: transparent;">
      ${zodiacHeaderHTML}
      <div style="font-size: 28px; font-family: 'Averia Serif Libre', serif; color: white; margin-bottom: 12px;">#${idx + 1}/${data.actions.length}</div>
      <div style="display: flex; flex-direction: column; gap: 12px; text-align: center; color: white;">
        <div style="font-size: 22px; font-family: 'Averia Serif Libre', serif; font-weight: 300;">${act.title}</div>
        <div style="font-size: 15px; opacity: 0.9;">${act.subtitle}</div>
      </div>
    </div>
  `).join('');

  showView('view-dashboard');

  // Parse and render all Lucide icons on the active screen
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Helper to get local YYYY-MM-DD date string
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}




// Helper to fetch horoscope with on-demand fallback
async function getHoroscope(sign) {
  const today = getLocalDateString();

  // 1. Check Supabase cache using .maybeSingle() instead of .single()
  let { data } = await supabaseClient
    .from('daily_horoscopes')
    .select('raw_data')
    .eq('sign', sign.toLowerCase())
    .eq('date', today)
    .maybeSingle(); // Prevents 406 error on empty cache

  

  // 2. If missing, trigger Netlify function with client timezone
  if (!data) {
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch(`/.netlify/functions/sync-horoscopes?timeZone=${encodeURIComponent(userTimeZone)}`);
    
    if (!res.ok) {
      const errText = await res.text();
      console.error('Failed to trigger sync function:', errText);
      return null;
    }

    // 3. Re-query Supabase
    const { data: syncedData } = await supabaseClient
      .from('daily_horoscopes')
      .select('raw_data')
      .eq('sign', sign.toLowerCase())
      .eq('date', today)
      .maybeSingle();

    data = syncedData;
  }

  return data?.raw_data;
}

// Helper to fetch pair insights with Netlify/Supabase integration
let pairInsightPromise = null;

// Helper to fetch pair insights with Netlify/Supabase integration & in-flight request lock
async function getPairInsights(userSign, partnerSign) {
  const today = getLocalDateString();
 const pairKey = `${userSign.toLowerCase()}_${partnerSign.toLowerCase()}`;

  // 1. Check Supabase cache for today's generated insights
  const { data } = await supabaseClient
    .from('daily_pair_insights')
    .select('content')
    .eq('pair_key', pairKey)
    .eq('date', today)
    .maybeSingle();

  if (data && data.content) {
    return data.content;
  }

  // 2. Prevent concurrent execution from tab switches or rapid focus events
  if (pairInsightPromise) {
    return pairInsightPromise;
  }

  pairInsightPromise = (async () => {
    try {
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch('/.netlify/functions/sync-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairKey, date: today, timeZone: userTimeZone })
      });

      if (!res.ok) {
        console.error('Failed to trigger sync-insights:', await res.text());
        return null;
      }

      const result = await res.json();
      return result.data?.content || null;
    } finally {
      pairInsightPromise = null;
    }
  })();

  return pairInsightPromise;
}

// Updated loadDashboard with loading UI state
async function loadDashboard(userSign, partnerSign) {
  // Store signs in global variables so settings modal can read them
  currentUserSign = userSign || '';
  currentPartnerSign = partnerSign || '';

  showView('view-dashboard'); // Render active container immediately
  
  const quickContainer = document.getElementById('quick-insights-container');
  const actionContainer = document.getElementById('actions-container');
  
  // Show loading skeleton while waiting for API response
  if (quickContainer) quickContainer.innerHTML = '<div style="color: white; text-align: center; padding: 20px;">Generating daily insights...</div>';
  if (actionContainer) actionContainer.innerHTML = '';

  // Wait for both horoscopes to be completely fetched/synced first
  await Promise.all([
    getHoroscope(userSign),
    getHoroscope(partnerSign)
  ]);

  const aiContent = await getPairInsights(userSign, partnerSign);

  if (!aiContent) {
    alert('Unable to load daily insights. Please try refreshing.');
    return;
  }

  const dashboardData = {
    quick: [
      { title: 'Wear', emoji: '👕', headline: aiContent.quick_insights.wear.title, reason: aiContent.quick_insights.wear.reason },
      { title: 'Binge', emoji: '📺', headline: aiContent.quick_insights.binge.title, reason: aiContent.quick_insights.binge.reason },
      { title: 'Cook', emoji: '🍳', headline: aiContent.quick_insights.cook.title, reason: aiContent.quick_insights.cook.reason },
      { title: 'Vibe', emoji: '🎵', headline: aiContent.quick_insights.vibe.title, reason: aiContent.quick_insights.vibe.reason }
    ],
    actions: aiContent.actions.map(act => ({
      title: act.title,
      subtitle: act.reason
    }))
  };

  renderDashboard(userSign, partnerSign, dashboardData);
}

async function initApp() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    showView('view-login');
  } else {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('user_sign, partner_sign')
      .eq('id', session.user.id)
      .single();

    if (profile && profile.user_sign && profile.partner_sign) {
      loadDashboard(profile.user_sign, profile.partner_sign);
    } else {
      showView('view-onboarding');
    }
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      return;
    }

    if (event === 'SIGNED_IN' && session) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('user_sign, partner_sign')
        .eq('id', session.user.id)
        .single();

      if (profile && profile.user_sign && profile.partner_sign) {
        loadDashboard(profile.user_sign, profile.partner_sign);
      } else {
        showView('view-onboarding');
      }
    } else if (event === 'SIGNED_OUT') {
      showView('view-login');
    }
  });
}

async function handleSendMessage(inputId = null) {
  const input = (inputId && document.getElementById(inputId)) || document.getElementById('chat-input') || document.getElementById('chat-prompt');
  const sendBtn = document.getElementById('chat-send-btn') || document.getElementById('send-btn');
  const messagesContainer = document.getElementById('chat-messages');

  if (!input) return;
  const prompt = input.value.trim();
  if (!prompt) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return alert('Please sign in to chat.');

  const userId = session.user.id;
  const pairId = `${currentUserSign.toLowerCase()}_${currentPartnerSign.toLowerCase()}`;
  const userLocalDate = getLocalDateString();

  // Switch to dedicated chat view
  showView('view-chat');

  // Lock UI to prevent spam
  input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  // Append user message immediately to chat UI
  if (messagesContainer) {
    messagesContainer.innerHTML += `<div class="chat-msg user-msg"><strong>You:</strong> ${prompt}</div>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  input.value = '';

  try {
    const res = await fetch('/.netlify/functions/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pairId, userLocalDate, prompt })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Failed to send message.');
    } else if (messagesContainer) {
      messagesContainer.innerHTML += `<div class="chat-msg assistant-msg"><strong>AI:</strong> ${data.reply}</div>`;
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  } catch (err) {
    alert('Network error. Please try again.');
  } finally {
    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

// Boot application
initApp();

// Tracks the last date the dashboard was updated
let lastFetchedDate = getLocalDateString();

// Automatically refresh dashboard when returning to the tab on a new day
document.addEventListener('visibilitychange', async () => {
  // 1. Only run when the user brings the tab back into focus
  if (document.visibilityState === 'visible') {
    const currentDate = getLocalDateString();

    // 2. Check if a new day has started since the last fetch
    if (currentDate !== lastFetchedDate) {
      const { data: { session } } = await supabaseClient.auth.getSession();

      if (session) {
        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('user_sign, partner_sign')
          .eq('id', session.user.id)
          .single();

        if (profile?.user_sign && profile?.partner_sign) {
          // 3. Update cached date and load new day's horoscopes
          lastFetchedDate = currentDate;
          loadDashboard(profile.user_sign, profile.partner_sign);
        }
      }
    }
  }
});

async function loadChatHistory() {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const pairId = `${currentUserSign.toLowerCase()}_${currentPartnerSign.toLowerCase()}`;

  const { data: messages, error } = await supabaseClient
    .from('chat_messages')
    .select('sender, message')
    .eq('user_id', session.user.id)
    .eq('pair_id', pairId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching chat history:', error);
    return;
  }

  // Render fetched history using exact column names: sender & message
  messagesContainer.innerHTML = (messages || []).map(msg => {
    const isUser = msg.sender === 'user';
    return `<div class="chat-msg ${isUser ? 'user-msg' : 'assistant-msg'}">
      <strong>${isUser ? 'You' : 'AI'}:</strong> ${msg.message}
    </div>`;
  }).join('');

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function openChatView() {
  showView('view-chat');
  loadChatHistory();
}

// Populates current sign values when opening settings screen
function openSettingsView() {
  const userSelect = document.getElementById('settings-user-sign');
  const partnerSelect = document.getElementById('settings-partner-sign');

  if (userSelect && currentUserSign) {
    userSelect.value = currentUserSign.toLowerCase();
  }
  if (partnerSelect && currentPartnerSign) {
    partnerSelect.value = currentPartnerSign.toLowerCase();
  }

  showView('view-settings');
}



// Updates signs in Supabase profiles table and refreshes state
async function handleUpdateSigns(event) {
  event.preventDefault();

  const newUserSign = document.getElementById('settings-user-sign').value;
  const newPartnerSign = document.getElementById('settings-partner-sign').value;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient
    .from('profiles')
    .update({
      user_sign: newUserSign,
      partner_sign: newPartnerSign
    })
    .eq('id', user.id);

  if (error) {
    alert('Failed to update signs: ' + error.message);
    return;
  }

  currentUserSign = newUserSign;
  currentPartnerSign = newPartnerSign;

  alert('Signs updated successfully!');
  loadDashboard(currentUserSign, currentPartnerSign);
}