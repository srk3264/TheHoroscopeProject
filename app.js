// 1. Initialize Supabase Client
// Replace these placeholders with your credentials from Phase 1 (Project Settings -> API)
const SUPABASE_URL = 'https://omltsxprptctzmhvebla.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_raGNw8eXWxEANqBiwHjBXw_qG2DD8JT';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sign Emoji Map (Updated to match animal/object representations)
const ZODIAC_EMOJIS = {
  aries: '🐏', taurus: '🐂', gemini: '♊', cancer: '🦀',
  leo: '🦁', virgo: '♍', libra: '⚖️', scorpio: '🦂',
  sagittarius: '🏹', capricorn: '🐐', aquarius: '🏺', pisces: '🐟'
};

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

  document.getElementById('user-emoji').innerText = ZODIAC_EMOJIS[uKey] || '⚖️';
  document.getElementById('partner-emoji').innerText = ZODIAC_EMOJIS[pKey] || '🦁';
  
  const today = new Date();
  document.getElementById('current-day').innerText = today.toLocaleDateString('en-US', { weekday: 'short' });

// Render Horizontal Cards (Wear, Binge, Cook, Vibe)
  const quickContainer = document.getElementById('quick-insights-container');
  quickContainer.innerHTML = data.quick.map(item => `
    <div class="card-item">
      <div style="text-align: center; color: white; font-size: 40px; font-family: 'Averia Serif Libre', serif; position: relative; z-index: 1;">${item.title}</div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: -16px; position: relative; z-index: 2;">
        <div style="font-size: 48px;">${item.emoji}</div>
        <div style="text-align: center; color: white; font-size: 16px; font-weight: 600;">${item.headline}</div>
        <div style="text-align: center; color: rgba(255, 255, 255, 0.60); font-size: 13px; font-style: italic;">${item.reason}</div>
      </div>
    </div>
  `).join('');

  // Render Action Cards (#1/2, #2/2)
  const actionContainer = document.getElementById('actions-container');
  actionContainer.innerHTML = data.actions.map((act, idx) => `
    <div class="action-card ${idx % 2 === 0 ? 'bg-blue' : 'bg-orange'}">
      <div style="font-size: 28px; font-family: 'Averia Serif Libre', serif;">#${idx + 1}/${data.actions.length}</div>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 22px; font-family: 'Averia Serif Libre', serif; font-weight: 300;">${act.title}</div>
        <div style="font-size: 15px; opacity: 0.9;">${act.subtitle}</div>
      </div>
      <div class="pill-btn">⏰ Remind me later</div>
    </div>
  `).join('');

  showView('view-dashboard');
}

// Mock Data Load (Phase 2 Test Harness)
function loadDashboard(userSign, partnerSign) {
  const mockInsight = {
    quick: [
      { title: 'Wear', emoji: '👕', headline: 'Sapphire blue + crisp white', reason: `Aligns ${partnerSign}'s and ${userSign}'s daily energies.` },
      { title: 'Binge', emoji: '📺', headline: 'The Secret Life of Walter Mitty', reason: 'Inspires creative drive while satisfying a reflective mood.' },
      { title: 'Cook', emoji: '🔪', headline: 'Lemon herb salmon with roasted veggies', reason: 'Creative, fresh, and perfectly balanced for both.' },
      { title: 'Vibe', emoji: '🎵', headline: 'Indie Folk / Ambient Acoustic', reason: 'Keeps high energy without disrupting calm, harmonious focus.' }
    ],
    actions: [
      { title: 'Invite into a workout, walk, or active plan instead of a passive date.', subtitle: `${userSign} energy: high movement + ${partnerSign} energy: release mental clutter.` },
      { title: 'Plan something around blue/sapphire tones or an elegant setting.', subtitle: 'Matches both your shared aesthetic profile for today.' }
    ]
  };

  renderDashboard(userSign, partnerSign, mockInsight);
}

// 6. Application Initializer & Session Listener
async function initApp() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    showView('view-login');
  } else {
    // Fetch user profile
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

  // Auth state change listener
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('user_sign, partner_sign')
        .eq('id', session.user.id)
        .single();

      if (profile && profile.user_sign && profile.partner_sign) {
        loadDashboard(profile.user_sign, profile.partner_sign);
      } else {
       showView('view-dashboard');
  
  // Render Lucide icons dynamically
  if (window.lucide) {
    lucide.createIcons();
  }
}
    } else if (event === 'SIGNED_OUT') {
      showView('view-login');
    }
  });
}

// Boot application
initApp();