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

// Wording for the paywall headline, keyed by the saved onboarding values
const PAYWALL_DISTANCE_PHRASES = {
  'same-home': 'staying in the same home',
  'nearby': 'living nearby',
  'long-distance': 'long-distance'
};

const PAYWALL_BUDGET_PHRASES = {
  'cheap': 'tight budget',
  'reasonable': 'reasonable spend',
  'expensive': 'generous budget',
  'discounts': 'deal-hunting budget'
};

function capitalizeSign(sign) {
  return sign ? sign.charAt(0).toUpperCase() + sign.slice(1) : '';
}

// Fills the paywall headline with the couple's saved choices
function renderPaywallHeadline() {
  const headline = document.getElementById('paywall-headline');
  if (!headline) return;

  const signs = [currentUserSign, currentPartnerSign].filter(Boolean).map(capitalizeSign);
  const distance = PAYWALL_DISTANCE_PHRASES[currentDistance] || '';
  const budget = PAYWALL_BUDGET_PHRASES[currentBudgetPreference] || '';
  const city = currentCity ? metroLabel(metroSlugFor(currentCity)) : '';

  let text = 'Horoscope based date ideas';
  if (signs.length === 2) text += ` for ${signs[0]} & ${signs[1]}`;
  if (distance) text += ` ${distance}`;
  if (budget) text += ` on a ${budget}`;
  if (city) text += ` in ${city}`;

  headline.textContent = text;
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

  renderPaywallHeadline();
  refreshRecheckButton();
  showView('view-paywall');
  return false;
}

// Stripe returns to ?checkout=success before the webhook saves the subscription, so offer a recheck only then
function refreshRecheckButton() {
  const button = document.getElementById('recheck-subscription');
  if (!button) return;
  const checkoutStatus = new URLSearchParams(window.location.search).get('checkout');
  button.hidden = checkoutStatus !== 'success';
}

async function recheckSubscription() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showView('view-login');
    return;
  }

  const response = await fetch('/.netlify/functions/check-subscription', {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const result = await response.json();

  if (!(response.ok && result.active)) {
    alert('No active subscription found yet. If you just paid, wait a moment and try again.');
    return;
  }

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code')
    .eq('id', session.user.id)
    .single();

  await routeAuthenticatedUser(profile);
}

async function openBillingPortal() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showView('view-login');
    return;
  }

  const response = await fetch('/.netlify/functions/create-portal-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const result = await response.json();

  if (!response.ok || !result.url) {
    alert(result.error || 'Unable to open subscription settings.');
    return;
  }

  window.location.href = result.url;
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
  // city is null only when the user has never answered; an empty string means they chose "Other"
  if (!profile?.user_sign || !profile?.partner_sign || profile?.city === null) {
    showView('view-onboarding');
    return;
  }

  currentUserSign = profile.user_sign || '';
  currentPartnerSign = profile.partner_sign || '';
  currentRelationshipType = profile.relationship_type || '';
  currentDistance = profile.distance || '';
  currentBudgetPreference = profile.budget_preference || '';
  currentCity = profile.city || '';
  currentPostalCode = profile.postal_code || '';

  if (await checkSubscription()) {
    loadDashboard(profile.user_sign, profile.partner_sign);
  }
}


// Supported FindLocal metros. Must match FINDLOCAL_SUPPORTED_METROS in netlify/functions/rewrite-action.js
const METRO_SLUGS = [
  'ann-arbor', 'atlanta', 'austin', 'baltimore', 'bangor', 'bloomington', 'boise', 'boston', 'brattleboro',
  'buffalo', 'burlington', 'cape-cod', 'charleston', 'charlotte', 'chicago', 'cincinnati', 'cleveland',
  'columbia-mo', 'columbus', 'dallas', 'denver', 'des-moines', 'detroit', 'duluth', 'fort-collins',
  'grand-rapids', 'green-bay', 'hanover', 'harrisburg', 'hartford', 'hilton-head', 'houston', 'hudson-valley',
  'indianapolis', 'iowa-city', 'jersey-shore', 'kansas-city', 'lansing', 'las-vegas', 'lincoln', 'london',
  'los-angeles', 'madison', 'manchester', 'miami', 'milwaukee', 'minneapolis', 'nashville', 'new-haven',
  'new-orleans', 'new-york', 'northampton', 'oklahoma-city', 'orlando', 'philadelphia', 'phoenix', 'pittsburgh',
  'pittsfield', 'portland', 'portland-me', 'portsmouth', 'providence', 'raleigh', 'rochester', 'rockland',
  'rutland', 'sacramento', 'salt-lake-city', 'san-antonio', 'san-diego', 'san-francisco', 'santa-barbara',
  'seattle', 'sonoma', 'spokane', 'st-louis', 'stamford', 'tampa', 'traverse-city', 'tucson', 'washington',
  'wenatchee', 'wilmington-nc', 'worcester'
];

const METRO_LABEL_OVERRIDES = {
  'st-louis': 'St. Louis',
  'columbia-mo': 'Columbia, MO',
  'portland': 'Portland, OR',
  'portland-me': 'Portland, ME',
  'wilmington-nc': 'Wilmington, NC'
};

// Same normalization as the server, so saved values like "Austin" or "austin" still match a metro
function metroSlugFor(city) {
  return (city || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function metroLabel(slug) {
  return METRO_LABEL_OVERRIDES[slug] ||
    slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Sentinel for a city outside the supported metros. It's saved as an empty city in profiles.
const OTHER_CITY = 'other';
const OTHER_LABEL = 'Other (not listed)';

function suggestionLabel(choice) {
  return choice === OTHER_CITY ? OTHER_LABEL : metroLabel(choice);
}

// The visible input filters the metro list; the hidden input (prefix) holds the metro slug, or OTHER_CITY
function setMetroValue(prefix, city) {
  const slug = METRO_SLUGS.includes(metroSlugFor(city)) ? metroSlugFor(city) : '';
  // An empty saved city means the user previously chose "Other"
  const choice = slug || (city === '' ? OTHER_CITY : '');
  document.getElementById(prefix).value = choice;
  document.getElementById(`${prefix}-search`).value = choice ? suggestionLabel(choice) : '';
}

function setupMetroAutosuggest(prefix) {
  const search = document.getElementById(`${prefix}-search`);
  const hidden = document.getElementById(prefix);
  const suggestions = document.getElementById(`${prefix}-suggestions`);
  if (!search || !hidden || !suggestions) return;

  const pick = (choice) => {
    hidden.value = choice;
    search.value = suggestionLabel(choice);
    suggestions.style.display = 'none';
  };

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    hidden.value = '';

    const exact = METRO_SLUGS.find((slug) => metroLabel(slug).toLowerCase() === query);
    if (exact) {
      pick(exact);
      return;
    }
    if (query && query === OTHER_LABEL.toLowerCase()) {
      pick(OTHER_CITY);
      return;
    }

    const matches = query
      ? METRO_SLUGS.filter((slug) => metroLabel(slug).toLowerCase().includes(query)).slice(0, 8)
      : [];
    // Always offer "Other" while typing, so cities outside the list can still be chosen
    if (query) matches.push(OTHER_CITY);

    suggestions.innerHTML = matches.map((choice) =>
      `<button type="button" class="metro-suggestion" data-slug="${choice}">${suggestionLabel(choice)}</button>`
    ).join('');
    suggestions.style.display = matches.length ? 'block' : 'none';

    suggestions.querySelectorAll('.metro-suggestion').forEach((button) => {
      // mousedown fires before blur, so the pick isn't lost when the input loses focus
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(button.dataset.slug);
      });
    });
  });

  search.addEventListener('blur', () => {
    suggestions.style.display = 'none';
  });
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


async function savePreferences() {
  const userSign = getSelectedValue('user-sign');
  const partnerSign = getSelectedValue('partner-sign');
  const relationshipType = getSelectedValue('relationship-type');
  const distance = getSelectedValue('distance');
  const budgetPreference = getSelectedValue('budget-preference');
  const cityChoice = document.getElementById('onboarding-city')?.value.trim() || '';
  const city = cityChoice === OTHER_CITY ? '' : cityChoice;
  const postalCode = document.getElementById('onboarding-postal-code')?.value.trim() || '';

  if (!userSign || !partnerSign || !relationshipType || !distance || !budgetPreference || !cityChoice || !postalCode) {
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
    renderPaywallHeadline();
    showView('view-paywall');
  }
}

// Action card themes: flower color is used for the headline, background for the card
const ACTION_THEMES = [
  { flower: '#F26522', background: '#FFD9A5', art: "url('assets/Flowers/Flower01.svg')" },
  { flower: '#1EACE8', background: '#DDDCC3', art: "url('assets/Flowers/Flower02.svg')" },
  { flower: '#405D11', background: '#D3C694', art: "url('assets/Flowers/Flower03.svg')" },
  { flower: '#FF83B4', background: '#FFD9B9', art: "url('assets/Flowers/Flower04.svg')" },
  { flower: '#F2994A', background: '#FFE0AC', art: "url('assets/Flowers/Flower05.svg')" },
  { flower: '#EDD051', background: '#FEE8AC', art: "url('assets/Flowers/Flower06.svg')" },
  { flower: '#7A3BFC', background: '#EFCEC6', art: "url('assets/Flowers/Flower07.svg')" },
  { flower: '#5573A8', background: '#DFCFB3', art: "url('assets/Flowers/Flower08.svg')" }
];

// Quick insight themes, keyed by the card title. Icons are SVG files in assets/quick-insights/.
// flower = the color inside each SVG file. background = the table's background for that same color.
const QUICK_THEMES = {
  Wear: { flower: '#C522F2', background: '#F5D3FF', art: "url('assets/quick-insights/Wear.svg')" },
  Binge: { flower: '#00539B', background: '#B1DAFE', art: "url('assets/quick-insights/Binge.svg')" },
  Cook: { flower: '#AE4300', background: '#FFD4B8', art: "url('assets/quick-insights/Cook.svg')" },
  Vibe: { flower: '#FF2234', background: '#F2CFD2', art: "url('assets/quick-insights/Vibe.svg')" }
};

// Hashes a string to a 32-bit seed so the same seed always gives the same shuffle
function hashString(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Picks a non-repeating theme per action (cycles if there are more actions than themes).
// The same seed always returns the same themes, so an action keeps its flower on refresh.
function pickActionThemes(count, seed) {
  let state = hashString(seed);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const shuffled = [...ACTION_THEMES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Array.from({ length: count }, (_, index) => shuffled[index % shuffled.length]);
}

// 5. Render Mock Insights to Figma Cards
function renderDashboard(userSign, partnerSign, data) {
  
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

// Render Quick Cards
  const quickContainer = document.getElementById('quick-insights-container');
  const quickThemes = data.quick.map(item => QUICK_THEMES[item.title]);
  quickContainer.innerHTML = data.quick.map((item, idx) => {
    const theme = quickThemes[idx];
    return `
    <div class="card-item" style="background-color: ${theme.background};">
      <div class="quick-title" style="color: ${theme.flower};">${item.title}</div>
      <div class="quick-headline" style="color: ${theme.flower};">${item.headline}</div>
      <div class="quick-reason">${item.reason}</div>
      <div class="quick-icon" style="background-color: ${theme.flower}; --quick-art: ${theme.art};"></div>
    </div>
  `;
  }).join('');

  // Render Action Cards with embedded SVG Header
  const actionContainer = document.getElementById('actions-container');
  currentActions = data.actions;
  const actionThemes = pickActionThemes(data.actions.length, `${getLocalDateString()}|${userSign}|${partnerSign}`);
  actionContainer.innerHTML = data.actions.map((act, idx) => {
    const savedRewrite = rewrittenActionIndexes.get(idx);
    const wasRewritten = Boolean(savedRewrite);
    const displayedTitle = savedRewrite?.title || act.title;
    const theme = actionThemes[idx];
    return `
      <div class="action-card" style="background-color: ${theme.background};">
      <div class="action-title" style="color: ${theme.flower};">${displayedTitle}</div>
      <div class="action-reason">${act.subtitle}</div>
      <button type="button" class="action-rewrite-btn" style="background-color: ${theme.flower}; border-color: ${theme.flower}; color: ${theme.background};" onclick="rewriteAction(${idx}, this)"${wasRewritten ? ' disabled' : ''}>${wasRewritten ? 'Already rewritten' : 'Make it fit me'}</button>
      <div class="action-flower" style="background-color: ${theme.flower}; --flower-art: ${theme.art};"></div>
    </div>
  `;
  }).join('');

  const flowerNav = document.getElementById('flower-nav');
  flowerNav.innerHTML = [...quickThemes, ...actionThemes].map((theme, idx) => `
    <button type="button" class="flower-nav-item" style="background-color: ${theme.background}; --flower-ring: ${theme.flower}61;" aria-label="Card ${idx + 1}">
      <span class="flower-nav-icon" style="background-color: ${theme.flower}; --flower-art: ${theme.art};"></span>
    </button>
  `).join('');

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
    .eq('pair_key', `${currentUserSign.toLowerCase()}_${currentPartnerSign.toLowerCase()}`)
    .neq('rewritten_title', '');

  (rewrites || []).forEach((rewrite) => rewrittenActionIndexes.set(rewrite.action_index, {
    title: rewrite.rewritten_title,
    reason: rewrite.original_reason
  }));
}

async function rewriteAction(actionIndex, button) {
  const action = currentActions[actionIndex];
  if (!action || !button || button.disabled) return;

  // Disable before any await so a quick second tap is ignored
  button.disabled = true;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    button.disabled = false;
    showView('view-login');
    return;
  }

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
      button.disabled = false;
      button.textContent = 'Make it fit me';
      return;
    }

    action.title = result.title;
    rewrittenActionIndexes.set(actionIndex, { title: result.title, reason: action.subtitle });
    const card = button.closest('.action-card');
    card.querySelector('.action-title').textContent = result.title;
    button.textContent = 'Already rewritten';
  } catch (error) {
    alert('Unable to rewrite this action right now.');
    button.disabled = false;
    button.textContent = 'Make it fit me';
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

  // Flower circles map to the last container's cards (the actions)
  const navButtons = Array.from(document.querySelectorAll('#flower-nav .flower-nav-item'));
  const navOffset = cards.length - navButtons.length;

  let activeIndex = 0;
  const showCard = (index) => {
    activeIndex = (index + cards.length) % cards.length;
    cards.forEach((card, cardIndex) => {
      const isHidden = cardIndex !== activeIndex;
      if (isHidden && card.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      card.style.display = 'flex';
      card.style.opacity = isHidden ? '0' : '1';
      card.style.pointerEvents = isHidden ? 'none' : 'auto';
      card.inert = isHidden;
      card.setAttribute('aria-hidden', isHidden ? 'true' : 'false');
      card.classList.toggle('is-active', !isHidden);
    });
    navButtons.forEach((button, navIndex) => {
      button.classList.toggle('active', navOffset + navIndex === activeIndex);
    });

    // Keep the selected flower circle centered in the nav row
    const activeNav = navButtons[activeIndex - navOffset];
    if (activeNav) {
      const nav = activeNav.parentElement;
      nav.scrollTo({ left: activeNav.offsetLeft - (nav.clientWidth - activeNav.offsetWidth) / 2, behavior: 'smooth' });
    }
  };

  navButtons.forEach((button, navIndex) => {
    button.addEventListener('click', () => showCard(navOffset + navIndex));
  });
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





async function getHoroscope(sign) {
  const today = getLocalDateString();
  const normalizedSign = sign.toLowerCase();

  const { data, error } = await supabaseClient
    .from('daily_horoscopes')
    .select('raw_data')
    .eq('sign', normalizedSign)
    .eq('date', today)
    .maybeSingle();

  if (error) {
    console.error('Horoscope lookup failed:', error);
    return null;
  }

  if (!data?.raw_data) {
    console.error(
      `No horoscope found in Supabase for ${normalizedSign} on ${today}.`
    );
    return null;
  }

  return data.raw_data;
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
      
      const { data: { session } } = await supabaseClient.auth.getSession();

      if (!session) {
        throw new Error('You must be signed in to load daily insights.');
      }

      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch('/.netlify/functions/sync-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ pairKey, date: today, timeZone: userTimeZone })
      });


     
      const result = await res.json();

      if (!res.ok) {
        console.error(
          'Failed to trigger sync-insights:',
          result.error || result
        );
        return null;
      }

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
  if (quickContainer) quickContainer.innerHTML = `
    <div class="loading-state">
      <div class="loading-flower"></div>
      <div class="loading-title">Reading the stars</div>
      <div>Generating today's insights for you both</div>
    </div>
  `;
  if (actionContainer) actionContainer.innerHTML = '';

  const [userHoroscope, partnerHoroscope] = await Promise.all([
  getHoroscope(userSign),
  getHoroscope(partnerSign)
]);

if (!userHoroscope || !partnerHoroscope) {
  alert('Unable to load both horoscopes for today. Please try again.');
  return;
}

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

// Only route once a profile has actually loaded, so a failed query can't fall through to onboarding
const PROFILE_FIELDS = 'user_sign, partner_sign, relationship_type, distance, budget_preference, city, postal_code';
let routingRun = 0;

async function loadProfile(userId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('id', userId)
      .single();
    if (!error && data) return data;
  }
  return null;
}

async function routeSignedInUser(userId) {
  // A newer routing call (e.g. from the sign-in event) supersedes this one
  const run = ++routingRun;
  const profile = await loadProfile(userId);
  if (run !== routingRun) return;

  if (!profile) {
    alert('Could not load your profile. Please refresh and try again.');
    return;
  }

  await routeAuthenticatedUser(profile);
}

async function initApp() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    showView('view-login');
  } else {
    await routeSignedInUser(session.user.id);
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      return;
    }

    if (event === 'SIGNED_IN' && session) {
      await routeSignedInUser(session.user.id);
    } else if (event === 'SIGNED_OUT') {
      showView('view-login');
    }
  });
}

// Going back from Stripe's portal can restore an old page state (such as Settings) from the browser cache,
// so reload to re-run routing instead
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

// Boot application
setupMetroAutosuggest('onboarding-city');
setupMetroAutosuggest('settings-city');
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
  const postalCodeInput = document.getElementById('settings-postal-code');
  if (relationshipInput) relationshipInput.checked = true;
  if (distanceInput) distanceInput.checked = true;
  if (budgetInput) budgetInput.checked = true;
  setMetroValue('settings-city', currentCity);
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
  const newCityChoice = document.getElementById('settings-city').value.trim();
  const newCity = newCityChoice === OTHER_CITY ? '' : newCityChoice;
  const newPostalCode = document.getElementById('settings-postal-code').value.trim();

  if (!newRelationshipType || !newDistance || !newBudgetPreference || !newCityChoice || !newPostalCode) {
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
