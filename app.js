// 1. Initialize Supabase Client
// Replace these placeholders with your credentials from Phase 1 (Project Settings -> API)
const SUPABASE_URL = 'https://omltsxprptctzmhvebla.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_raGNw8eXWxEANqBiwHjBXw_qG2DD8JT';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global state variables for settings
let currentUserSign = '';
let currentPartnerSign = '';
let currentRelationshipType = '';
let currentDistance = '';
let currentBudgetPreference = '';
let currentCity = '';
let currentPostalCode = '';
let currentActions = [];
let rewrittenActionIndexes = new Map();



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

async function checkSubscription() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showView('view-login');
    return false;
  }

  const response = await fetch('/.netlify/functions/check-subscription', {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const result = await response.json();

  if (response.ok && result.active) {
    return true;
  }

  showView('view-paywall');
  return false;
}

async function startCheckout() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showView('view-login');
    return;
  }

  const response = await fetch('/.netlify/functions/create-checkout-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const result = await response.json();

  if (!response.ok || !result.url) {
    alert(result.error || 'Unable to start checkout.');
    return;
  }

  window.location.href = result.url;
}

async function routeAuthenticatedUser(profile) {
  if (!profile?.user_sign || !profile?.partner_sign) {
    showView('view-onboarding');
    return;
  }

  currentRelationshipType = profile.relationship_type || '';
  currentDistance = profile.distance || '';
  currentBudgetPreference = profile.budget_preference || '';
  currentCity = profile.city || '';
  currentPostalCode = profile.postal_code || '';

  if (await checkSubscription()) {
    loadDashboard(profile.user_sign, profile.partner_sign);
  }
}

function getRandomCardGradient() {
  const mainColor = [
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256)
  ];
  const edgeColor = [
    mainColor[0],
    Math.min(255, mainColor[1] + 180),
    Math.min(255, mainColor[2] + 166)
  ];
  const toHex = (channel) => channel.toString(16).padStart(2, '0');
  const color = (channels) => `#${channels.map(toHex).join('')}`;
  const gradient = `linear-gradient(180deg, ${color(edgeColor)} 0%, ${color(mainColor)} 53%, ${color(edgeColor)} 99%)`;

  return `background: ${gradient};`;
}

// 4. Onboarding Handler
function getSelectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
}

function nextOnboardingStep(currentId, nextId, fieldName) {
  if (!getSelectedValue(fieldName)) {
    alert('Choose an option to continue.');
    return;
  }

  document.getElementById(currentId).classList.remove('active');
  document.getElementById(nextId).classList.add('active');
}

function setupLocationAutocomplete(cityInputId, postalCodeInputId, suggestionsId) {
  const cityInput = document.getElementById(cityInputId);
  const postalCodeInput = document.getElementById(postalCodeInputId);
  const suggestions = document.getElementById(suggestionsId);
  if (!cityInput || !postalCodeInput || !suggestions) return;

  let debounceTimer;
  cityInput.addEventListener('input', () => {
    postalCodeInput.value = '';
    clearTimeout(debounceTimer);
    const query = cityInput.value.trim();
    if (query.length < 2) {
      suggestions.innerHTML = '';
      suggestions.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`);
        if (!response.ok) return;
        const result = await response.json();
        const places = (result.features || []).filter(({ properties }) =>
          properties?.city || properties?.town || properties?.village || properties?.municipality
        );

        suggestions.innerHTML = places.map((place, index) => {
          const properties = place.properties;
          const name = properties.city || properties.town || properties.village || properties.municipality || properties.name;
          const region = [properties.state, properties.country].filter(Boolean).join(', ');
          return `<button type="button" class="location-suggestion" data-place-index="${index}">${name}${region ? `, ${region}` : ''}</button>`;
        }).join('');
        suggestions.style.display = places.length ? 'block' : 'none';

        suggestions.querySelectorAll('.location-suggestion').forEach((button) => {
          button.addEventListener('click', () => {
            const properties = places[Number(button.dataset.placeIndex)].properties;
            cityInput.value = properties.city || properties.town || properties.village || properties.municipality || properties.name || '';
            postalCodeInput.value = properties.postcode || '';
            suggestions.innerHTML = '';
            suggestions.style.display = 'none';
          });
        });
      } catch (error) {
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
      }
    }, 300);
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest(`#${cityInputId}`) && !event.target.closest(`#${suggestionsId}`)) {
      suggestions.style.display = 'none';
    }
  });
}

async function savePreferences() {
  const userSign = getSelectedValue('user-sign');
  const partnerSign = getSelectedValue('partner-sign');
  const relationshipType = getSelectedValue('relationship-type');
  const distance = getSelectedValue('distance');
  const budgetPreference = getSelectedValue('budget-preference');
  const city = document.getElementById('onboarding-city')?.value.trim() || '';
  const postalCode = document.getElementById('onboarding-postal-code')?.value.trim() || '';

  if (!userSign || !partnerSign || !relationshipType || !distance || !budgetPreference || !city || !postalCode) {
    alert('Choose an option to continue.');
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert('No active session found.');

  const { data: savedProfile, error } = await supabaseClient.from('profiles').update({
    user_sign: userSign,
    partner_sign: partnerSign,
    relationship_type: relationshipType,
    distance,
    budget_preference: budgetPreference,
    city,
    postal_code: postalCode
  }).eq('id', user.id).select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code').maybeSingle();

  if (error || !savedProfile) {
    alert('Could not save preferences. Run supabase/profile-preferences.sql in Supabase first.' + (error ? `\n\n${error.message}` : ''));
  } else {
    currentUserSign = savedProfile.user_sign;
    currentPartnerSign = savedProfile.partner_sign;
    currentRelationshipType = savedProfile.relationship_type;
    currentDistance = savedProfile.distance;
    currentBudgetPreference = savedProfile.budget_preference;
    currentCity = savedProfile.city;
    currentPostalCode = savedProfile.postal_code;
    showView('view-paywall');
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
    <div class="card-item" style="height: 100vh; width: 100vw; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 16px; padding: 20px; box-sizing: border-box; ${getRandomCardGradient()} cursor: pointer;">
      ${zodiacHeaderHTML}
      <div style="text-align: center; color: white; font-size: 40px; font-family: 'Averia Serif Libre', serif;">${item.title}</div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; margin-top: 0;">
        <div style="text-align: center; color: white; font-size: 16px; font-weight: 600;">${item.headline}</div>
        <div style="text-align: center; color: rgba(255, 255, 255, 0.60); font-size: 13px; font-style: italic;">${item.reason}</div>
      </div>
    </div>
  `).join('');

  // Render Action Cards with embedded SVG Header
  const actionContainer = document.getElementById('actions-container');
  currentActions = data.actions;
  actionContainer.innerHTML = data.actions.map((act, idx) => {
    const savedRewrite = rewrittenActionIndexes.get(idx);
    const wasRewritten = Boolean(savedRewrite);
    const displayedTitle = savedRewrite?.title || act.title;
    return `
      <div class="action-card" style="height: 100vh; width: 100vw; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; ${getRandomCardGradient()} cursor: pointer;">
      ${zodiacHeaderHTML}
      <div style="font-size: 28px; font-family: 'Averia Serif Libre', serif; color: white; margin-bottom: 12px;">#${idx + 1}/${data.actions.length}</div>
      <div style="display: flex; flex-direction: column; gap: 12px; text-align: center; color: white;">
        <div class="action-title" style="font-size: 22px; font-family: 'Averia Serif Libre', serif; font-weight: 300;">${displayedTitle}</div>
        <div class="action-reason" style="font-size: 15px; opacity: 0.9;">${act.subtitle}</div>
      </div>
      <button type="button" class="action-rewrite-btn" onclick="rewriteAction(${idx}, this)"${wasRewritten ? ' disabled' : ''}>${wasRewritten ? 'Already rewritten' : 'Make it fit me'}</button>
    </div>
  `;
  }).join('');

  setupUnifiedTapCards(quickContainer, actionContainer);

  showView('view-dashboard');

  // Parse and render all Lucide icons on the active screen
  if (window.lucide) {
    lucide.createIcons();
  }
}

async function loadRewrittenActionIndexes() {
  rewrittenActionIndexes = new Map();
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user || !currentUserSign || !currentPartnerSign) return;

  const { data: rewrites } = await supabaseClient
    .from('rewritten_actions')
    .select('action_index, rewritten_title, original_reason')
    .eq('user_id', user.id)
    .eq('date', getLocalDateString())
    .eq('pair_key', `${currentUserSign.toLowerCase()}_${currentPartnerSign.toLowerCase()}`);

  (rewrites || []).forEach((rewrite) => rewrittenActionIndexes.set(rewrite.action_index, {
    title: rewrite.rewritten_title,
    reason: rewrite.original_reason
  }));
}

async function rewriteAction(actionIndex, button) {
  const action = currentActions[actionIndex];
  if (!action || !button) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showView('view-login');
    return;
  }

  button.disabled = true;
  button.textContent = 'Rewriting...';

  try {
    const response = await fetch('/.netlify/functions/rewrite-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        actionTitle: action.title,
        actionReason: action.subtitle,
        pairKey: `${currentUserSign.toLowerCase()}_${currentPartnerSign.toLowerCase()}`,
        date: getLocalDateString(),
        actionIndex
      })
    });
    const result = await response.json();

    if (!response.ok) {
      alert(result.error || 'Unable to rewrite this action.');
      return;
    }

    action.title = result.title;
    rewrittenActionIndexes.set(actionIndex, { title: result.title, reason: action.subtitle });
    const card = button.closest('.action-card');
    card.querySelector('.action-title').textContent = result.title;
    button.textContent = 'Already rewritten';
  } catch (error) {
    alert('Unable to rewrite this action right now.');
  }

  button.textContent = 'Already rewritten';
}

// Helper to get local YYYY-MM-DD date string
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getUtcBoundaryForLocalDate(localDate, timeZone) {
  const [year, month, day] = localDate.split('-').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',  
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(utcGuess))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value])
  );
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(utcGuess - (localAsUtc - utcGuess)).toISOString();
}

function getNextLocalDate(localDate) {
  const nextDate = new Date(`${localDate}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

function setupUnifiedTapCards(...containers) {
  const cards = containers.flatMap(container => Array.from(container.children));
  if (!cards.length) return;

  let activeIndex = 0;
  const showCard = (index) => {
    activeIndex = (index + cards.length) % cards.length;
    cards.forEach((card, cardIndex) => {
      card.style.display = 'flex';
      card.style.opacity = cardIndex === activeIndex ? '1' : '0';
      card.style.pointerEvents = cardIndex === activeIndex ? 'auto' : 'none';
      card.setAttribute('aria-hidden', cardIndex === activeIndex ? 'false' : 'true');
    });
  };

  showCard(activeIndex);
  const deck = containers[0].parentElement;

  deck.onpointerup = (event) => {
    if (event.target.closest('button, input, a')) return;
    event.preventDefault();
    const bounds = deck.getBoundingClientRect();
    const direction = event.clientX < bounds.left + bounds.width / 2 ? -1 : 1;
    showCard(activeIndex + direction);
  };

  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showCard(activeIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showCard(activeIndex + 1);
    }
  });
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

  await loadRewrittenActionIndexes();
  renderDashboard(userSign, partnerSign, dashboardData);
}

async function initApp() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    showView('view-login');
  } else {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code')
      .eq('id', session.user.id)
      .single();

    await routeAuthenticatedUser(profile);
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      return;
    }

    if (event === 'SIGNED_IN' && session) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code')
        .eq('id', session.user.id)
        .single();

      await routeAuthenticatedUser(profile);
    } else if (event === 'SIGNED_OUT') {
      showView('view-login');
    }
  });
}

// Boot application
setupLocationAutocomplete('onboarding-city', 'onboarding-postal-code', 'onboarding-city-suggestions');
setupLocationAutocomplete('settings-city', 'settings-postal-code', 'settings-city-suggestions');
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
          .select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code')
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

// Populates current sign values when opening settings screen
async function openSettingsView() {
  const userSelect = document.getElementById('settings-user-sign');
  const partnerSelect = document.getElementById('settings-partner-sign');

  if (userSelect && currentUserSign) {
    userSelect.value = currentUserSign.toLowerCase();
  }
  if (partnerSelect && currentPartnerSign) {
    partnerSelect.value = currentPartnerSign.toLowerCase();
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (user) {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('relationship_type, distance, budget_preference, city, postal_code')
      .eq('id', user.id)
      .maybeSingle();

    currentRelationshipType = profile?.relationship_type || currentRelationshipType;
    currentDistance = profile?.distance || currentDistance;
    currentBudgetPreference = profile?.budget_preference || currentBudgetPreference;
    currentCity = profile?.city || currentCity;
    currentPostalCode = profile?.postal_code || currentPostalCode;
  }

  const relationshipInput = document.querySelector(`input[name="settings-relationship-type"][value="${currentRelationshipType}"]`);
  const distanceInput = document.querySelector(`input[name="settings-distance"][value="${currentDistance}"]`);
  const budgetInput = document.querySelector(`input[name="settings-budget-preference"][value="${currentBudgetPreference}"]`);
  const cityInput = document.getElementById('settings-city');
  const postalCodeInput = document.getElementById('settings-postal-code');
  if (relationshipInput) relationshipInput.checked = true;
  if (distanceInput) distanceInput.checked = true;
  if (budgetInput) budgetInput.checked = true;
  if (cityInput) cityInput.value = currentCity;
  if (postalCodeInput) postalCodeInput.value = currentPostalCode;

  showView('view-settings');
}



// Updates signs in Supabase profiles table and refreshes state
async function handleUpdateSigns(event) {
  event.preventDefault();

  const newUserSign = document.getElementById('settings-user-sign').value;
  const newPartnerSign = document.getElementById('settings-partner-sign').value;
  const newRelationshipType = getSelectedValue('settings-relationship-type');
  const newDistance = getSelectedValue('settings-distance');
  const newBudgetPreference = getSelectedValue('settings-budget-preference');
  const newCity = document.getElementById('settings-city').value.trim();
  const newPostalCode = document.getElementById('settings-postal-code').value.trim();

  if (!newRelationshipType || !newDistance || !newBudgetPreference || !newCity || !newPostalCode) {
    alert('Complete all relationship, budget, city, and postal code fields to continue.');
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient
    .from('profiles')
    .update({
      user_sign: newUserSign,
      partner_sign: newPartnerSign,
      relationship_type: newRelationshipType,
      distance: newDistance,
      budget_preference: newBudgetPreference,
      city: newCity,
      postal_code: newPostalCode
    })
    .eq('id', user.id);

  if (error) {
    alert('Failed to update signs: ' + error.message);
    return;
  }

  currentUserSign = newUserSign;
  currentPartnerSign = newPartnerSign;
  currentRelationshipType = newRelationshipType;
  currentDistance = newDistance;
  currentBudgetPreference = newBudgetPreference;
  currentCity = newCity;
  currentPostalCode = newPostalCode;

  alert('Signs updated successfully!');
  loadDashboard(currentUserSign, currentPartnerSign);
}