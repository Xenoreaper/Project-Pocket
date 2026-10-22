const API = '/api';
let currentEditId = null;
let authToken = localStorage.getItem('authToken') || '';
let authUsername = localStorage.getItem('authUsername') || '';
let isCurrentUserAdmin = localStorage.getItem('authIsAdmin') === 'true' || false;
let isSharingEnabled = localStorage.getItem('authSharingEnabled') !== 'false';
let activeProfile = normalizeProfile(localStorage.getItem('activeProfile') || localStorage.getItem('pocketUser'));
let availableProfiles = [];
let appDataLoaded = false;
let themeMode = localStorage.getItem('themeMode') || 'dark';
let isListMode = localStorage.getItem('viewMode') === 'list';
const DEFAULT_DATE_FORMAT_PATTERN = 'YYYY-MM-DD HH:mm:ss';
const DATE_FORMAT_PRESETS = {
  iso: DEFAULT_DATE_FORMAT_PATTERN,
  'eu-24h': 'DD.MM.YYYY HH:mm',
  'us-12h': 'MM/DD/YYYY hh:mm A',
};
const LEGACY_DATE_FORMAT_PATTERNS = {
  'eu-24h': 'DD.MM.YYYY HH:mm',
  'us-12h': 'MM/DD/YYYY hh:mm A',
};
let dateFormatPattern = normalizeDateFormatPattern(
  localStorage.getItem('dateFormatPattern')
  || LEGACY_DATE_FORMAT_PATTERNS[localStorage.getItem('dateFormatMode') || '']
  || DEFAULT_DATE_FORMAT_PATTERN
);

if (!['dark', 'light', 'oled'].includes(themeMode)) {
  themeMode = 'dark';
}

localStorage.setItem('activeProfile', activeProfile);

// ── Utilities ────────────────────────────────────────────────────────────────

function normalizeUsername(rawValue) {
  const input = String(rawValue || '').trim().toLowerCase();
  const safe = input.replace(/[^a-zA-Z0-9._-]/g, '');
  return safe.slice(0, 64);
}

function normalizeProfile(rawValue) {
  const input = String(rawValue || '').trim();
  if (!input) return 'default';
  const safe = input.replace(/[^a-zA-Z0-9._-]/g, '');
  return safe.slice(0, 64) || 'default';
}

function withAuthHeaders(headers, profileOverride = '') {
  const merged = new Headers(headers || {});
  if (authToken) {
    merged.set('Authorization', `Bearer ${authToken}`);
  }
  const requestedProfile = profileOverride || merged.get('X-Pocket-Profile') || activeProfile;
  merged.set('X-Pocket-Profile', normalizeProfile(requestedProfile));
  return merged;
}

function setActiveProfile(rawValue) {
  activeProfile = normalizeProfile(rawValue);
  localStorage.setItem('activeProfile', activeProfile);
  return activeProfile;
}

function setAuthSession(token, username, isAdmin = false, sharingEnabled = true) {
  authToken = String(token || '').trim();
  authUsername = normalizeUsername(username);
  isCurrentUserAdmin = !!isAdmin;
  isSharingEnabled = !!sharingEnabled;
  localStorage.setItem('authToken', authToken);
  localStorage.setItem('authUsername', authUsername);
  localStorage.setItem('authIsAdmin', isAdmin ? 'true' : 'false');
  localStorage.setItem('authSharingEnabled', isSharingEnabled ? 'true' : 'false');
}

function clearAuthSession() {
  authToken = '';
  authUsername = '';
  isCurrentUserAdmin = false;
  isSharingEnabled = true;
  window.ProjectPocketAdmin?.teardown?.();
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUsername');
  localStorage.removeItem('authIsAdmin');
  localStorage.removeItem('authSharingEnabled');
}

async function publicApiFetch(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (!(opts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(API + path, {
    ...opts,
    headers,
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed (${res.status})`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function apiFetch(path, opts = {}) {
  const { profile, ...requestOpts } = opts;
  const headers = withAuthHeaders(requestOpts.headers, profile);
  if (!(requestOpts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(API + path, {
    ...requestOpts,
    headers,
  });

  if (res.status === 401) {
    clearAuthSession();
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
    throw new Error('Unauthorized');
  }

  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) throw new Error('Nothing to copy');

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  // Fallback for environments where navigator.clipboard is unavailable.
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('Copy failed');
}

function normalizeDateFormatPattern(rawValue) {
  const value = String(rawValue || '').trim();
  return (value || DEFAULT_DATE_FORMAT_PATTERN).slice(0, 64);
}

function getDateFormatPresetId(pattern) {
  const normalizedPattern = normalizeDateFormatPattern(pattern);
  return Object.entries(DATE_FORMAT_PRESETS)
    .find(([, presetPattern]) => presetPattern === normalizedPattern)?.[0] || 'custom';
}

function formatDateWithPattern(date, pattern) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  const values = {
    YYYY: String(year).padStart(4, '0'),
    YY: String(year).slice(-2),
    MM: String(month).padStart(2, '0'),
    M: String(month),
    DD: String(day).padStart(2, '0'),
    D: String(day),
    HH: String(hours24).padStart(2, '0'),
    H: String(hours24),
    hh: String(hours12).padStart(2, '0'),
    h: String(hours12),
    mm: String(minutes).padStart(2, '0'),
    m: String(minutes),
    ss: String(seconds).padStart(2, '0'),
    s: String(seconds),
    A: hours24 >= 12 ? 'PM' : 'AM',
    a: hours24 >= 12 ? 'pm' : 'am',
  };

  const tokens = ['YYYY', 'YY', 'HH', 'hh', 'MM', 'DD', 'mm', 'ss', 'A', 'a', 'H', 'h', 'M', 'D', 'm', 's'];
  const source = String(pattern || DEFAULT_DATE_FORMAT_PATTERN);
  let result = '';

  for (let index = 0; index < source.length;) {
    let matchedToken = '';
    for (const token of tokens) {
      if (!source.startsWith(token, index)) continue;
      matchedToken = token;
      break;
    }

    if (!matchedToken) {
      result += source[index];
      index += 1;
      continue;
    }

    if (matchedToken.length === 1) {
      const prevChar = source[index - 1] || '';
      const nextChar = source[index + 1] || '';
      const touchesWord = /[A-Za-z]/.test(prevChar) || /[A-Za-z]/.test(nextChar);
      if (touchesWord) {
        result += source[index];
        index += 1;
        continue;
      }
    }

    result += values[matchedToken];
    index += matchedToken.length;
  }

  return result;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateWithPattern(date, dateFormatPattern);
}

function parseTimestampToSeconds(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return null;

  if (/^\d+$/.test(input)) return Number(input);

  if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(input)) {
    const parts = input.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  const hms = input.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const h = Number(hms[1] || 0);
    const m = Number(hms[2] || 0);
    const s = Number(hms[3] || 0);
    return h * 3600 + m * 60 + s;
  }

  return Number.NaN;
}

function isYouTubeUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('youtube.com');
  } catch {
    return false;
  }
}

function withYouTubeTimestamp(rawUrl, timestampInput) {
  const seconds = parseTimestampToSeconds(timestampInput);
  if (seconds === null || !isYouTubeUrl(rawUrl)) return rawUrl;
  if (!Number.isFinite(seconds)) throw new Error('Invalid YouTube timestamp format');

  const u = new URL(rawUrl);
  u.searchParams.set('t', `${Math.max(0, Math.floor(seconds))}s`);
  u.searchParams.delete('start');
  return u.toString();
}

function getPlatformName() {
  const uaData = navigator.userAgentData;
  if (uaData?.platform) return uaData.platform;

  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown OS';
}

async function getBrowserName() {
  if (navigator.brave?.isBrave) {
    try {
      if (await navigator.brave.isBrave()) return 'Brave';
    } catch {
      // Ignore and continue with other detection strategies.
    }
  }

  const brands = navigator.userAgentData?.brands?.map(brand => brand.brand).join(' ') || '';
  const ua = navigator.userAgent;

  if (/Microsoft Edge/i.test(brands) || /Edg\//.test(ua)) return 'Edge';
  if (/Opera/i.test(brands) || /OPR\//.test(ua)) return 'Opera';
  if (/Firefox/i.test(brands) || /Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome/i.test(brands) || /Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'Safari';
  return 'Browser';
}

async function getDeviceLabel(via) {
  const browser = await getBrowserName();
  const platform = getPlatformName();
  return `${browser} ${via} on ${platform}`;
}

function recipeLines(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function buildRecipeDetails(page) {
  const ingredients = recipeLines(page.recipe_ingredients);
  const instructions = recipeLines(page.recipe_instructions);

  if (!ingredients.length && !instructions.length) {
    return '<div class="recipe-preview-empty">No recipe ingredients or instructions found on this page.</div>';
  }

  const ingredientsHtml = ingredients.length
    ? `
      <div class="recipe-section">
        <div class="recipe-section-title">Ingredients</div>
        <ul class="recipe-list">
          ${ingredients.map(item => `<li>${escHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const instructionsHtml = instructions.length
    ? `
      <div class="recipe-section">
        <div class="recipe-section-title">Instructions</div>
        <ol class="recipe-list recipe-steps">
          ${instructions.slice(0, 6).map(item => `<li>${escHtml(item)}</li>`).join('')}
        </ol>
        ${instructions.length > 6 ? `<div class="recipe-more">+${instructions.length - 6} more steps</div>` : ''}
      </div>
    `
    : '';

  return `<div class="recipe-preview">${ingredientsHtml}${instructionsHtml}</div>`;
}

function getMusicLookupQuery(page) {
  const rawTitle = String(page.title || '').trim();
  if (!rawTitle) return '';

  return rawTitle
    .replace(/\s+-\s+song and lyrics by\s+/i, ' ')
    .replace(/\s*[\[(](official video|official audio|lyrics?)[\])]/gi, '')
    .replace(/\s+(?:no\.?|#)\s*\d+\b/gi, '')
    .replace(/\s+[|\-]\s+(youtube music|youtube|spotify|apple music|soundcloud|bandcamp|deezer|tidal)$/i, '')
    .replace(/\s+[-|:]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGeniusSearchUrl(page) {
  const query = getMusicLookupQuery(page);
  if (!query) return null;
  return `https://genius.com/search?q=${encodeURIComponent(query)}`;
}

const geniusSearchCache = new Map();

async function resolveGeniusSearchUrl(page) {
  const cacheKey = `${page.url}::${page.title || ''}`;
  if (geniusSearchCache.has(cacheKey)) return geniusSearchCache.get(cacheKey);

  const fallbackUrl = getGeniusSearchUrl(page);
  const params = new URLSearchParams({ url: page.url, title: page.title || '' });

  try {
    const result = await apiFetch(`/music/genius-search?${params.toString()}`);
    const resolvedUrl = String(result?.url || '').trim() || fallbackUrl;
    if (!resolvedUrl) throw new Error('No Genius search URL available');
    geniusSearchCache.set(cacheKey, resolvedUrl);
    return resolvedUrl;
  } catch {
    if (!fallbackUrl) throw new Error('No Genius search URL available');
    geniusSearchCache.set(cacheKey, fallbackUrl);
    return fallbackUrl;
  }
}

function buildCard(page, options = {}) {
  const showRecipeDetails = options.showRecipeDetails === true;
  const geniusQuery = page.is_music ? getMusicLookupQuery(page) : '';
  const hasNotes = Boolean(String(page.notes || '').trim());
  const isSharedReceived = Boolean(page.is_shared_received);
  const isSharedSent = Boolean(page.is_shared_sent);
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.id = page.id;

  const tags = page.tags ? page.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const resaveCount = Number.isFinite(Number(page.resave_count)) ? Math.max(0, Number(page.resave_count)) : 0;
  const resaveBadge = resaveCount > 0 ? `<span class="tag resave-badge">🔁 Resaved ${resaveCount}x</span>` : '';
  const tagHtml = [
    page.is_recipe ? '<span class="tag recipe-badge">🍳 Recipe</span>' : '',
    page.is_music ? '<span class="tag music-badge">🎵 Music</span>' : '',
    isSharedReceived ? '<span class="tag share-received-badge">📥 Received Share</span>' : '',
    isSharedSent ? '<span class="tag share-sent-badge">📤 Sent Share</span>' : '',
    hasNotes ? '<span class="tag note-badge" title="This save contains notes">📝 Notes</span>' : '',
    resaveBadge,
    ...tags.map(t => `<span class="tag">${escHtml(t)}</span>`),
  ].join('');

  const metaTagHtml = tagHtml ? `<span class="card-meta-tags">${tagHtml}</span>` : '';

  card.innerHTML = `
    <div class="card-top">
      <img class="card-favicon" src="${escHtml(page.favicon)}" alt=""
           onerror="this.style.display='none'" />
      <span class="card-domain">${escHtml(page.domain)}</span>
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(page.title || page.url)}</div>
      ${page.description ? `<div class="card-desc">${escHtml(page.description)}</div>` : ''}
      ${tagHtml ? `<div class="card-tags">${tagHtml}</div>` : ''}
      ${showRecipeDetails ? buildRecipeDetails(page) : ''}
      <div class="card-meta">
        <span class="card-date" data-iso="${escHtml(page.created_at)}">🕒 ${formatDate(page.created_at)}</span>
        ${page.device ? `<span class="card-device">📱 ${escHtml(page.device)}</span>` : ''}
        ${metaTagHtml}
      </div>
      <div class="card-actions">
        <a class="card-open" href="${escHtml(page.url)}" target="_blank" rel="noopener noreferrer">Open Link</a>
        <button type="button" class="card-copy" data-url="${escHtml(page.url)}">Copy Link</button>
        ${geniusQuery ? '<button type="button" class="card-genius">Lookup on Genius</button>' : ''}
      </div>
    </div>
  `;

  card.querySelectorAll('.card-open').forEach(link => {
    link.addEventListener('click', e => e.stopPropagation());
  });

  const copyBtn = card.querySelector('.card-copy');
  copyBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      await copyTextToClipboard(page.url);
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    } catch {
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Failed';
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    }
  });

  const geniusBtn = card.querySelector('.card-genius');
  geniusBtn?.addEventListener('click', async e => {
    e.stopPropagation();
    const prev = geniusBtn.textContent;
    geniusBtn.textContent = 'Looking up...';
    geniusBtn.disabled = true;
    try {
      const geniusUrl = await resolveGeniusSearchUrl(page);
      window.open(geniusUrl, '_blank', 'noopener,noreferrer');
      geniusBtn.textContent = prev;
    } catch {
      geniusBtn.textContent = 'Failed';
      setTimeout(() => { geniusBtn.textContent = prev; }, 1200);
    } finally {
      geniusBtn.disabled = false;
    }
  });

  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    openSaveContextMenu(page, e.clientX, e.clientY);
  });

  card.addEventListener('click', () => {
    hideSaveContextMenu();
    openEditModal(page);
  });
  return card;
}

let saveContextMenu = null;
let saveContextMenuProfileMenu = null;
let saveContextMenuTarget = null;
let saveContextMenuProfileAction = '';

function buildSaveContextMenuItem(action, label, options = {}) {
  const { danger = false, withArrow = false } = options;
  const classes = ['save-context-menu-item'];
  if (danger) classes.push('danger');
  if (withArrow) classes.push('with-arrow');

  return `<button type="button" class="${classes.join(' ')}" data-action="${action}" role="menuitem"${withArrow ? ' aria-haspopup="menu"' : ''}>${label}</button>`;
}

function renderSaveContextMenuItems() {
  if (!saveContextMenu || !saveContextMenuTarget) return;

  const sections = [
    [
      buildSaveContextMenuItem('open', 'Open Link'),
      buildSaveContextMenuItem('copy', 'Copy Link'),
    ],
  ];

  const findActions = [];
  if (saveContextMenuTarget.isRecipe) {
    findActions.push(buildSaveContextMenuItem('find-recipes', 'Find in Recipes'));
  }
  if (saveContextMenuTarget.isMusic) {
    findActions.push(buildSaveContextMenuItem('find-music', 'Find in Music'));
    findActions.push(buildSaveContextMenuItem('lookup-genius', 'Lookup on Genius'));
  }
  if (findActions.length) {
    sections.push(findActions);
  }

  if (isSharingEnabled) {
    sections.push([
      buildSaveContextMenuItem('share', 'Share'),
    ]);
  }

  sections.push([
    buildSaveContextMenuItem('move-profile', 'Move to Profile', { withArrow: true }),
    buildSaveContextMenuItem('copy-profile', 'Copy to Profile', { withArrow: true }),
  ]);

  sections.push([
    buildSaveContextMenuItem('delete', 'Delete', { danger: true }),
  ]);

  saveContextMenu.innerHTML = sections
    .map(section => section.join(''))
    .join('<div class="save-context-menu-separator" role="separator"></div>');
}

function ensureSaveContextMenu() {
  if (saveContextMenu) return saveContextMenu;

  const menu = document.createElement('div');
  menu.id = 'save-context-menu';
  menu.className = 'save-context-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Save actions');
  menu.innerHTML = '';

  const profileMenu = document.createElement('div');
  profileMenu.id = 'save-context-profile-menu';
  profileMenu.className = 'save-context-menu save-context-menu--submenu';
  profileMenu.hidden = true;
  profileMenu.setAttribute('role', 'menu');
  profileMenu.setAttribute('aria-label', 'Select profile');
  document.body.appendChild(profileMenu);
  saveContextMenuProfileMenu = profileMenu;

  menu.addEventListener('click', async e => {
    const item = e.target.closest('.save-context-menu-item');
    if (!(item instanceof HTMLButtonElement) || !saveContextMenuTarget) return;

    const action = item.dataset.action;
    const target = saveContextMenuTarget;

    if (action === 'move-profile' || action === 'copy-profile') {
      await showSaveContextProfileMenu(action, item);
      return;
    }

    hideSaveContextMenu();

    if (action === 'open') {
      window.open(target.url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (action === 'copy') {
      try {
        await copyTextToClipboard(target.url);
      } catch {
        // Keep failure silent here to avoid disruptive UI from a context action.
      }
      return;
    }

    if (action === 'find-recipes') {
      await findSaveInView('recipes', target);
      return;
    }

    if (action === 'find-music') {
      await findSaveInView('music', target);
      return;
    }

    if (action === 'lookup-genius') {
      try {
        const geniusUrl = await resolveGeniusSearchUrl({
          url: target.url,
          title: target.title,
          is_music: true,
        });
        window.open(geniusUrl, '_blank', 'noopener,noreferrer');
      } catch {
        // Ignore failure for context action; card button shows richer transient state.
      }
      return;
    }

    if (action === 'share') {
      showShareModal(target.id, target.title);
      return;
    }

    if (action === 'delete') {
      await deletePageById(target.id);
    }
  });

  profileMenu.addEventListener('click', async e => {
    const item = e.target.closest('.save-context-menu-item');
    if (!(item instanceof HTMLButtonElement) || !saveContextMenuTarget) return;
    if (item.disabled) return;

    const targetProfile = normalizeProfile(item.dataset.profile || '');
    if (!targetProfile) return;

    const target = saveContextMenuTarget;
    const isMoveAction = saveContextMenuProfileAction === 'move-profile';
    hideSaveContextMenu();

    try {
      await transferPageToProfile(target.id, targetProfile, { move: isMoveAction });
      setProfileStatus(`${isMoveAction ? 'Moved' : 'Copied'} save to profile: ${targetProfile}`);
    } catch (err) {
      setProfileStatus(`✗ ${err.message}`);
    }
  });

  document.body.appendChild(menu);
  saveContextMenu = menu;

  document.addEventListener('click', e => {
    if (!saveContextMenu || saveContextMenu.hidden) return;
    if (saveContextMenu.contains(e.target)) return;
    if (saveContextMenuProfileMenu && !saveContextMenuProfileMenu.hidden && saveContextMenuProfileMenu.contains(e.target)) return;
    hideSaveContextMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    hideSaveContextMenu();
  });

  window.addEventListener('resize', hideSaveContextMenu);
  document.addEventListener('scroll', hideSaveContextMenu, true);

  return saveContextMenu;
}

function getTransferTargetProfiles() {
  return Array.from(new Set([
    ...availableProfiles,
    activeProfile,
  ].map(normalizeProfile).filter(Boolean)))
    .filter(profile => profile !== activeProfile)
    .sort((a, b) => a.localeCompare(b));
}

async function showSaveContextProfileMenu(action, anchorButton) {
  if (!saveContextMenuProfileMenu || !saveContextMenuTarget) return;
  saveContextMenuProfileAction = action;

  try {
    await loadAvailableProfiles();
  } catch {
    // Keep existing profile list if loading fails.
  }

  const profiles = getTransferTargetProfiles();
  if (!profiles.length) {
    saveContextMenuProfileMenu.innerHTML = '<button type="button" class="save-context-menu-item" disabled>No other profiles</button>';
  } else {
    saveContextMenuProfileMenu.innerHTML = profiles
      .map(profile => `<button type="button" class="save-context-menu-item" data-profile="${escHtml(profile)}" role="menuitem">${escHtml(profile)}</button>`)
      .join('');
  }

  saveContextMenuProfileMenu.hidden = false;
  saveContextMenuProfileMenu.style.left = '0px';
  saveContextMenuProfileMenu.style.top = '0px';

  const anchorRect = anchorButton.getBoundingClientRect();
  const rootRect = saveContextMenu.getBoundingClientRect();
  const subRect = saveContextMenuProfileMenu.getBoundingClientRect();
  const pad = 8;
  const gap = 4;

  const rightCandidate = rootRect.right + gap;
  const leftCandidate = rootRect.left - subRect.width - gap;
  const canUseRight = rightCandidate + subRect.width + pad <= window.innerWidth;
  const preferredLeft = canUseRight ? rightCandidate : leftCandidate;
  const left = Math.min(
    Math.max(pad, preferredLeft),
    Math.max(pad, window.innerWidth - subRect.width - pad)
  );

  const top = Math.min(
    Math.max(pad, anchorRect.top),
    Math.max(pad, window.innerHeight - subRect.height - pad)
  );

  saveContextMenuProfileMenu.style.left = `${left}px`;
  saveContextMenuProfileMenu.style.top = `${top}px`;
}

function openSaveContextMenu(page, clientX, clientY) {
  const menu = ensureSaveContextMenu();
  saveContextMenuTarget = {
    id: page.id,
    url: String(page.url || ''),
    title: String(page.title || ''),
    isRecipe: Boolean(page.is_recipe),
    isMusic: Boolean(page.is_music),
  };
  saveContextMenuProfileAction = '';
  if (saveContextMenuProfileMenu) {
    saveContextMenuProfileMenu.hidden = true;
  }

  renderSaveContextMenuItems();

  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';

  const rect = menu.getBoundingClientRect();
  const pad = 8;
  const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
  const maxTop = Math.max(pad, window.innerHeight - rect.height - pad);
  const left = Math.min(Math.max(pad, clientX), maxLeft);
  const top = Math.min(Math.max(pad, clientY), maxTop);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideSaveContextMenu() {
  if (!saveContextMenu) return;
  saveContextMenu.hidden = true;
  if (saveContextMenuProfileMenu) saveContextMenuProfileMenu.hidden = true;
  saveContextMenuTarget = null;
  saveContextMenuProfileAction = '';
}

function showShareModal(pageId, pageTitle) {
  if (!isSharingEnabled) {
    setSharingStatus('Sharing is disabled in your privacy settings.');
    return;
  }

  const shareOverlay = document.getElementById('share-overlay');
  const shareForm = document.getElementById('share-form');
  const shareUsername = document.getElementById('share-username');
  const shareStatus = document.getElementById('share-status');
  const shareClose = document.getElementById('share-close');
  const shareCancel = document.getElementById('share-cancel');

  if (!shareOverlay || !shareForm) return;

  shareStatus.textContent = '';
  shareUsername.value = '';
  shareOverlay.classList.remove('hidden');
  shareUsername.focus();
  // Make input required by default; load contacts will relax this if any are selected
  if (shareUsername) shareUsername.required = true;
  // Load contacts asynchronously to help picking a recipient quickly
  loadShareContacts();

  function closeShareModal() {
    shareOverlay.classList.add('hidden');
    shareForm.removeEventListener('submit', onSubmit);
    shareClose.removeEventListener('click', closeShareModal);
    shareCancel.removeEventListener('click', closeShareModal);
    shareOverlay.removeEventListener('click', onBgClick);
    // remove any input handler added by loadShareContacts
    if (shareUsername && shareUsername._shareInputHandler) {
      try { shareUsername.removeEventListener('input', shareUsername._shareInputHandler); } catch (e) {}
      delete shareUsername._shareInputHandler;
    }
    // clear contacts list to free listeners
    const wrapClear = document.getElementById('share-contacts-list');
    if (wrapClear) wrapClear.innerHTML = '';
  }

  function onBgClick(e) {
    if (e.target === shareOverlay) closeShareModal();
  }

  async function onSubmit(e) {
    e.preventDefault();

      // If user selected contacts, gather them; otherwise use the free-text input.
      const wrap = document.getElementById('share-contacts-list');
      const selectedBtns = wrap ? wrap.querySelectorAll('.share-contact-btn.selected') : null;
      let recipients = [];
      if (selectedBtns && selectedBtns.length > 0) {
        recipients = Array.from(selectedBtns).map(b => b.dataset.username).filter(Boolean);
      } else {
        const targetUsername = shareUsername.value.trim();
        if (!targetUsername || targetUsername.length < 3) {
          shareStatus.innerHTML = '<span class="error">x Username must be at least 3 characters</span>';
          return;
        }
        recipients = [targetUsername];
      }

      const submitBtn = shareForm.querySelector('button[type="submit"]');
      const previousText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sharing...';
      shareStatus.innerHTML = '<span class="loading">Sharing save...</span>';

      try {
        let deliveredCount = 0;
        let skipped = 0;
        const errors = [];
        for (const r of recipients) {
          try {
            const result = await apiFetch(`/pages/${pageId}/share`, {
              method: 'POST',
              body: JSON.stringify({ recipient_username: r }),
            });
            if (result?.created_recipient_page) deliveredCount += 1;
            else skipped += 1;
          } catch (err) {
            errors.push({ recipient: r, message: err.message || String(err) });
          }
        }

        let msg = '';
        if (deliveredCount > 0) {
          msg = `<span class="success">✓ Shared with ${deliveredCount} recipient${deliveredCount>1?'s':''}</span>`;
        } else if (skipped > 0) {
          msg = '<span class="success">✓ Recipient already has this save, so it was skipped</span>';
        } else {
          msg = '<span class="error">x No recipients were shared to</span>';
        }
        if (errors.length > 0) {
          msg += `<div style="margin-top:.45rem"><span class="error">x ${errors.length} error(s)</span></div>`;
        }
        shareStatus.innerHTML = msg;
        submitBtn.disabled = false;
        submitBtn.textContent = previousText;
        setTimeout(closeShareModal, 1500);
        if (deliveredCount > 0) {
          setProfileStatus(`Shared \"${pageTitle}\" with ${deliveredCount} recipient${deliveredCount>1?'s':''}`);
        } else if (skipped > 0) {
          setProfileStatus(`${recipients.join(', ')} already have \"${pageTitle}\"; re-share skipped`);
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = previousText;
        shareStatus.innerHTML = `<span class="error">x ${err.message}</span>`;
      }
  }

  shareForm.addEventListener('submit', onSubmit);
  shareClose.addEventListener('click', closeShareModal);
  shareCancel.addEventListener('click', closeShareModal);
  shareOverlay.addEventListener('click', onBgClick);
}

function highlightFoundSaveCard(card) {
  if (!(card instanceof HTMLElement)) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  card.classList.add('context-jump-target');
  card.setAttribute('tabindex', '-1');
  card.focus({ preventScroll: true });

  window.setTimeout(() => {
    card.classList.remove('context-jump-target');
    if (card.getAttribute('tabindex') === '-1') card.removeAttribute('tabindex');
  }, 1400);
}

async function findSaveInView(viewName, target) {
  const state = pagedViewStates[viewName];
  if (!state) return false;

  const query = String(target?.url || target?.title || '').trim();
  if (searchInput) {
    searchInput.value = query;
  }

  activateView(viewName);
  await reloadActiveListView();

  const card = state.container?.querySelector(`.page-card[data-id="${target?.id}"]`);
  if (card instanceof HTMLElement) {
    highlightFoundSaveCard(card);
    return true;
  }
  return false;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


async function loadShareContacts() {
  const wrap = document.getElementById('share-contacts-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  try {
    const contacts = await apiFetch('/contacts');
    const input = document.getElementById('share-username');
    if (!Array.isArray(contacts) || contacts.length === 0) {
      // no contacts available -> input must remain required
      if (input) input.required = true;
      return;
    }
    const html = contacts.map(c => {
      const label = (c.alias && c.alias.trim()) ? escHtml(c.alias) : escHtml(c.contact_username);
      return `<button type="button" class="btn share-contact-btn" data-username="${escHtml(c.contact_username)}">${label}</button>`;
    }).join('');
    wrap.innerHTML = `<div class="share-contacts-title" style="margin-bottom:6px;font-size:0.9rem;color:#666">Contacts</div>${html}`;
    const btns = wrap.querySelectorAll('.share-contact-btn');
    btns.forEach(btn => {
      const onBtnClick = () => {
        // Toggle selection for multi-recipient sharing (like Instagram)
        const isSelected = btn.classList.toggle('selected');
        btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        // If user selects a contact, clear free-text input to avoid accidental double-target
        if (input && isSelected) input.value = '';
        // update required: input required only when no contact selected
        const anySelected = wrap.querySelectorAll('.share-contact-btn.selected').length > 0;
        if (input) input.required = !anySelected;
      };
      btn.addEventListener('click', onBtnClick);
      // store handler in case we need to remove (not strictly necessary since innerHTML is replaced on close)
      btn._shareClickHandler = onBtnClick;
    });

    // input handler: when user types, clear selected contacts and relax required if there's content
    if (input) {
      const onInput = () => {
        const val = String(input.value || '').trim();
        if (val.length > 0) {
          wrap.querySelectorAll('.share-contact-btn.selected').forEach(b => {
            b.classList.remove('selected');
            b.setAttribute('aria-pressed', 'false');
          });
          input.required = false;
        } else {
          const anySelected = wrap.querySelectorAll('.share-contact-btn.selected').length > 0;
          input.required = !anySelected;
        }
      };
      // remove previous if any
      if (input._shareInputHandler) input.removeEventListener('input', input._shareInputHandler);
      input.addEventListener('input', onInput);
      input._shareInputHandler = onInput;
      // ensure input required by default until the user selects or types
      input.required = true;
    }
  } catch (err) {
    // ignore errors silently; ensure input remains required
    const input = document.getElementById('share-username');
    if (input) input.required = true;
  }
}

function renderCards(container, pages, options = {}) {
  const { append = false, ...cardOptions } = options;
  if (!append) {
    container.innerHTML = '';
  } else {
    container.querySelector('.empty-state')?.remove();
  }

  if (!pages.length && !append) {
    container.innerHTML = '<p class="empty-state">No pages saved yet.</p>';
    return;
  }
  pages.forEach(p => container.appendChild(buildCard(p, cardOptions)));
  applyViewMode();
  refreshVisibleDates();
  // Masonry only needed in grid mode, and never on fixed-grid containers
  if (!isListMode && !container.classList.contains('fixed-grid')) {
    requestAnimationFrame(() => fitMasonryCards(container));
  }
}

function refreshVisibleDates() {
  document.querySelectorAll('.card-date[data-iso]').forEach(node => {
    const iso = node.dataset.iso;
    node.textContent = `🕒 ${formatDate(iso)}`;
  });
}

function applyThemeMode() {
  document.body.classList.toggle('light-mode', themeMode === 'light');
  document.body.classList.toggle('oled-mode', themeMode === 'oled');

  document.querySelectorAll('.theme-slider').forEach(control => {
    if (!(control instanceof HTMLElement)) return;

    const index = themeMode === 'light' ? 0 : themeMode === 'dark' ? 1 : 2;
    control.style.setProperty('--theme-slider-index', String(index));

    control.querySelectorAll('.theme-slider-option').forEach(option => {
      if (!(option instanceof HTMLButtonElement)) return;
      const isActive = option.dataset.themeValue === themeMode;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-selected', isActive ? 'true' : 'false');
      option.tabIndex = isActive ? 0 : -1;
    });
  });

  refreshVisibleDates();
}

function setThemeMode(nextMode) {
  if (!['dark', 'light', 'oled'].includes(nextMode)) return;
  themeMode = nextMode;
  localStorage.setItem('themeMode', themeMode);
  applyThemeMode();
}

document.querySelectorAll('.theme-slider').forEach(control => {
  control.addEventListener('click', e => {
    const button = e.target.closest('.theme-slider-option');
    if (!(button instanceof HTMLButtonElement)) return;
    setThemeMode(button.dataset.themeValue || 'dark');
  });

  control.addEventListener('keydown', e => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('theme-slider-option')) return;

    const values = ['light', 'dark', 'oled'];
    const currentIndex = values.indexOf(themeMode);
    if (currentIndex < 0) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextMode = values[Math.min(values.length - 1, currentIndex + 1)];
      setThemeMode(nextMode);
      control.querySelector(`[data-theme-value="${nextMode}"]`)?.focus();
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextMode = values[Math.max(0, currentIndex - 1)];
      setThemeMode(nextMode);
      control.querySelector(`[data-theme-value="${nextMode}"]`)?.focus();
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      setThemeMode(values[0]);
      control.querySelector('[data-theme-value="light"]')?.focus();
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      setThemeMode(values[values.length - 1]);
      control.querySelector('[data-theme-value="oled"]')?.focus();
    }
  });
});

function applyViewMode() {
  document.querySelectorAll('.pages-grid:not(.fixed-grid)').forEach(g => {
    g.classList.toggle('list-mode', isListMode);
  });
  const btn = document.getElementById('view-mode-btn');
  btn.textContent = isListMode ? '🗃️ List' : '⊶ Grid';
  if (!isListMode) fitAllGrids();
}

document.getElementById('view-mode-btn').addEventListener('click', () => {
  isListMode = !isListMode;
  localStorage.setItem('viewMode', isListMode ? 'list' : 'grid');
  applyViewMode();
});

function applyDateFormatMode() {
  const input = document.getElementById('date-format-input');
  const preset = document.getElementById('date-format-preset');
  if (input) input.value = dateFormatPattern;
  if (preset) preset.value = getDateFormatPresetId(dateFormatPattern);
  refreshVisibleDates();
}

function setDateFormatPattern(nextPattern) {
  dateFormatPattern = normalizeDateFormatPattern(nextPattern);
  localStorage.setItem('dateFormatPattern', dateFormatPattern);
  localStorage.removeItem('dateFormatMode');
  applyDateFormatMode();
}

document.getElementById('date-format-input')?.addEventListener('change', e => {
  setDateFormatPattern(e.target?.value || '');
});

document.getElementById('date-format-input')?.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  setDateFormatPattern(e.currentTarget?.value || '');
  e.currentTarget.blur();
});

document.getElementById('date-format-reset-btn')?.addEventListener('click', () => {
  setDateFormatPattern(DEFAULT_DATE_FORMAT_PATTERN);
});

document.getElementById('date-format-preset')?.addEventListener('change', e => {
  const presetId = String(e.target?.value || '').trim();
  if (presetId === 'custom') {
    document.getElementById('date-format-input')?.focus();
    return;
  }

  const presetPattern = DATE_FORMAT_PRESETS[presetId];
  if (presetPattern) setDateFormatPattern(presetPattern);
});

// ── Masonry layout ───────────────────────────────────────────────────────────

function fitMasonryCards(grid) {
  const rowHeight = 8; // must match grid-auto-rows in CSS
  const gap = 16;      // 1rem margin-bottom on each card
  // 1. Give every card a huge span so the grid doesn't constrain its height
  grid.querySelectorAll('.page-card').forEach(card => {
    card.style.gridRowEnd = 'span 999';
  });
  // 2. Force reflow — now getBoundingClientRect reflects natural content height
  void grid.offsetHeight;
  // 3. Set the correct span based on actual rendered height
  grid.querySelectorAll('.page-card').forEach(card => {
    const h = card.getBoundingClientRect().height;
    card.style.gridRowEnd = `span ${Math.ceil((h + gap) / rowHeight)}`;
  });
}

function fitAllGrids() {
  document.querySelectorAll('.pages-grid:not(.fixed-grid)').forEach(fitMasonryCards);
}

window.addEventListener('resize', fitAllGrids);

// ── Navigation ───────────────────────────────────────────────────────────────

const views = {
  all: document.getElementById('view-all'),
  recipes: document.getElementById('view-recipes'),
  music: document.getElementById('view-music'),
  shared: document.getElementById('view-shared'),
  domains: document.getElementById('view-domains'),
};

const sharedTabsController = window.ProjectPocketTabs.createSharedTabsController({
  loadSent: loadSentShares,
  loadReceived: loadReceivedShares,
  loadRequests: loadPendingRequests,
  storageKey: 'projectPocket.sharedTab',
  defaultTab: 'received',
});

const mainViewController = window.ProjectPocketTabs.createMainViewController({
  views,
  storageKey: 'projectPocket.mainView',
  defaultView: 'all',
  getViewButtons: () => document.querySelectorAll('.nav-btn[data-view]'),
  isAuthenticated: () => Boolean(authToken),
  onUnauthorized: () => {
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
  },
  onViewActivated: (viewName) => {
    updateFilterBarState(viewName);

    if (viewName === 'all') loadAll();
    if (viewName === 'recipes') loadRecipes();
    if (viewName === 'music') loadMusic();
    if (viewName === 'shared') loadShared();
    if (viewName === 'domains') loadDomains();
  },
});

function activateView(viewName, sourceBtn = null) {
  mainViewController.activateView(viewName, sourceBtn);
}

async function loadShared() {
  await sharedTabsController.loadShared();
}

mainViewController.bindNavigation();
mainViewController.hydrateFromStorage();

const filterBar = document.getElementById('filter-bar');
const tagSort = document.getElementById('tag-sort');
const filterTagWrap = document.getElementById('filter-tag-wrap');
const recipesTopFilterWrap = document.getElementById('recipes-top-filter-wrap');
const recipesExtraControls = document.getElementById('recipes-extra-controls');
const customSelectControllers = new Map();

function closeAllCustomSelects(exceptId = '') {
  customSelectControllers.forEach((controller, id) => {
    if (exceptId && id === exceptId) return;
    controller.close();
  });
}

function enhanceSelect(selectEl) {
  if (!selectEl || customSelectControllers.has(selectEl.id)) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  wrapper.dataset.selectId = selectEl.id || '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'custom-select-label';

  const arrow = document.createElement('span');
  arrow.className = 'custom-select-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '▾';

  trigger.append(label, arrow);

  const menu = document.createElement('div');
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');

  wrapper.append(trigger, menu);
  selectEl.classList.add('select-native-hidden');
  selectEl.after(wrapper);

  let options = [];
  let activeIndex = -1;

  const syncLabel = () => {
    const selected = selectEl.selectedOptions?.[0] || selectEl.options[selectEl.selectedIndex];
    label.textContent = selected?.textContent || '';
  };

  const getOptions = () => Array.from(selectEl.options || []);

  const syncWidthToLongestOption = () => {
    if (selectEl.id !== 'tag-sort') return;

    const optionsList = getOptions();
    if (!optionsList.length) return;

    const probe = document.createElement('span');
    probe.className = 'custom-select-trigger';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.whiteSpace = 'nowrap';
    probe.style.width = 'auto';

    const probeLabel = document.createElement('span');
    probeLabel.className = 'custom-select-label';
    probeLabel.style.overflow = 'visible';
    probeLabel.style.textOverflow = 'clip';

    const probeArrow = document.createElement('span');
    probeArrow.className = 'custom-select-arrow';
    probeArrow.setAttribute('aria-hidden', 'true');
    probeArrow.textContent = '▾';

    probe.append(probeLabel, probeArrow);
    document.body.appendChild(probe);

    let widest = 0;
    optionsList.forEach(opt => {
      probeLabel.textContent = opt.textContent || '';
      const width = probe.getBoundingClientRect().width;
      if (width > widest) widest = width;
    });

    document.body.removeChild(probe);
    wrapper.style.minWidth = `${Math.ceil(widest)}px`;
  };

  const renderMenu = () => {
    options = getOptions();
    if (activeIndex >= options.length) activeIndex = options.length - 1;

    menu.innerHTML = '';
    options.forEach((opt, idx) => {
      const optionBtn = document.createElement('button');
      optionBtn.type = 'button';
      optionBtn.className = 'custom-select-option';
      optionBtn.textContent = opt.textContent || '';
      optionBtn.dataset.value = opt.value;
      optionBtn.setAttribute('role', 'option');

      const isSelected = selectEl.value === opt.value;
      if (isSelected) {
        optionBtn.classList.add('selected');
        optionBtn.setAttribute('aria-selected', 'true');
      } else {
        optionBtn.setAttribute('aria-selected', 'false');
      }

      if (idx === activeIndex) {
        optionBtn.classList.add('active');
      }

      menu.appendChild(optionBtn);
    });
  };

  const close = () => {
    wrapper.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  };

  const open = () => {
    closeAllCustomSelects(selectEl.id);
    renderMenu();
    wrapper.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  };

  const syncVisibility = () => {
    const hidden = selectEl.style.display === 'none';
    wrapper.style.display = hidden ? 'none' : '';
    if (hidden) close();
  };

  const syncFromNative = () => {
    syncLabel();
    syncVisibility();
    syncWidthToLongestOption();
    if (wrapper.classList.contains('open')) renderMenu();
  };

  const commitValue = (value) => {
    if (selectEl.value === value) {
      close();
      return;
    }

    selectEl.value = value;
    syncFromNative();
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };

  trigger.addEventListener('click', () => {
    if (wrapper.classList.contains('open')) {
      close();
      return;
    }
    open();
  });

  trigger.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      close();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!wrapper.classList.contains('open')) {
        open();
      }
      if (!options.length) return;

      const delta = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + options.length) % options.length;
      renderMenu();
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!wrapper.classList.contains('open')) {
        open();
        return;
      }

      if (activeIndex >= 0 && options[activeIndex]) {
        commitValue(options[activeIndex].value);
      }
    }
  });

  menu.addEventListener('mousedown', e => {
    e.preventDefault();
  });

  menu.addEventListener('click', e => {
    const optionBtn = e.target.closest('.custom-select-option');
    if (!optionBtn) return;
    commitValue(optionBtn.dataset.value || '');
  });

  selectEl.addEventListener('change', syncFromNative);
  customSelectControllers.set(selectEl.id, {
    close,
    open,
    syncFromNative,
  });

  syncFromNative();
}

function syncCustomSelect(selectId) {
  customSelectControllers.get(selectId)?.syncFromNative();
}

function initCustomSelects() {
  ['tag-sort', 'recipes-match-mode', 'r-match-type'].forEach(id => {
    const selectEl = document.getElementById(id);
    if (selectEl) enhanceSelect(selectEl);
  });

  document.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof Element)) {
      closeAllCustomSelects();
      return;
    }
    const insideCustomSelect = target.closest('.custom-select');
    if (!insideCustomSelect) {
      closeAllCustomSelects();
    }
  });
}

function updateFilterBarState(viewName) {
  const showFilter = viewName === 'all' || viewName === 'recipes' || viewName === 'music' || viewName === 'shared';
  filterBar.style.display = showFilter ? 'flex' : 'none';
  filterBar.classList.toggle('recipes-layout', viewName === 'recipes');

  // Recipes uses its own combined ingredient/tag filters in the pantry panel.
  const showGlobalTagControls = viewName !== 'recipes';
  const showRecipesTopControls = viewName === 'recipes';
  if (filterTagWrap) filterTagWrap.style.display = showGlobalTagControls ? '' : 'none';
  if (filterBarChips) filterBarChips.style.display = showGlobalTagControls ? '' : 'none';
  if (recipesTopFilterWrap) recipesTopFilterWrap.style.display = showRecipesTopControls ? 'flex' : 'none';
  if (recipesExtraControls) recipesExtraControls.style.display = showRecipesTopControls ? 'flex' : 'none';
  if (!showRecipesTopControls) closeRecipesTagDropdown();

  const showTagSort = viewName === 'all' || viewName === 'recipes' || viewName === 'music' || viewName === 'shared';
  tagSort.style.display = showTagSort ? '' : 'none';
  if (!showTagSort) tagSort.value = 'newest';
  syncCustomSelect('tag-sort');

  renderFilterChips(viewName);

  if (viewName === 'recipes') searchInput.placeholder = 'Search recipes…';
  else if (viewName === 'music') searchInput.placeholder = 'Search music…';
  else if (viewName === 'shared') searchInput.placeholder = 'Search shared saves…';
  else searchInput.placeholder = 'Search pages…';
}

function getActiveViewName() {
  return mainViewController.getActiveViewName();
}

async function reloadActiveListView() {
  if (!authToken) return;
  const viewName = getActiveViewName();
  if (viewName === 'all') return loadAll();
  if (viewName === 'recipes') return loadRecipes();
  if (viewName === 'music') return loadMusic();
  if (viewName === 'shared') return loadShared();
}

// ── Settings overlay ─────────────────────────────────────────────────────────────

const settingsOverlay = document.getElementById('settings-overlay');
const accountNameLabel = document.getElementById('account-name-label');
const logoutBtn = document.getElementById('logout-btn');
const togglePasswordFormBtn = document.getElementById('toggle-password-form-btn');
const profileInput = document.getElementById('profile-input');
const profileApplyBtn = document.getElementById('profile-apply-btn');
const profileDropdownToggle = document.getElementById('profile-dropdown-toggle');
const profileDropdown = document.getElementById('profile-dropdown');
const profileStatus = document.getElementById('profile-status');
const changePasswordForm = document.getElementById('change-password-form');
const changePasswordBtn = document.getElementById('change-password-btn');
const currentPasswordInput = document.getElementById('current-password-input');
const newPasswordInput = document.getElementById('new-password-input');
const confirmNewPasswordInput = document.getElementById('confirm-new-password-input');
const passwordChangeStatus = document.getElementById('password-change-status');
const sharingToggleBtn = document.getElementById('sharing-toggle-btn');
const sharingStatus = document.getElementById('sharing-status');
const shareBlockForm = document.getElementById('share-block-form');
const shareBlockUsernameInput = document.getElementById('share-block-username');
const shareBlockAddBtn = document.getElementById('share-block-add-btn');
const shareBlockStatus = document.getElementById('share-block-status');
const shareBlockList = document.getElementById('share-block-list');
const contactForm = document.getElementById('contact-form');
const contactUsernameInput = document.getElementById('contact-username');
const contactAliasInput = document.getElementById('contact-alias');
const contactAddBtn = document.getElementById('contact-add-btn');
const contactStatus = document.getElementById('contact-status');
const contactList = document.getElementById('contact-list');
const contactRequestsList = document.getElementById('contact-requests-list');
const contactRequestsStatus = document.getElementById('contact-requests-status');
const dateFormatHelpBtn = document.getElementById('date-format-help-btn');
const dateFormatHelpOverlay = document.getElementById('date-format-help-overlay');
const dateFormatHelpCloseBtn = document.getElementById('date-format-help-close');
let profileDropdownOptions = [];
let profileDropdownActiveIndex = -1;

function closeDateFormatHelpOverlay({ restoreFocus = false } = {}) {
  if (!dateFormatHelpOverlay) return;
  if (dateFormatHelpOverlay.classList.contains('hidden')) return;

  dateFormatHelpOverlay.classList.add('hidden');
  dateFormatHelpBtn?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) dateFormatHelpBtn?.focus();
}

function openDateFormatHelpOverlay() {
  if (!dateFormatHelpOverlay) return;
  dateFormatHelpOverlay.classList.remove('hidden');
  dateFormatHelpBtn?.setAttribute('aria-expanded', 'true');
  dateFormatHelpCloseBtn?.focus();
}

function updateAccountNameLabel() {
  accountNameLabel.textContent = authUsername
    ? `Signed in as: ${authUsername}${isCurrentUserAdmin ? ' (Admin)' : ''}`
    : 'Signed in as: -';
}

async function logoutCurrentUser() {
  const tokenAtStart = authToken;
  if (!tokenAtStart) {
    settingsOverlay.classList.add('hidden');
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
    return;
  }

  const prevLabel = logoutBtn?.textContent || 'Logout';
  if (logoutBtn) {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Logging out...';
  }

  try {
    const response = await fetch(`${API}/auth/logout`, {
      method: 'POST',
      headers: withAuthHeaders(),
    });
    if (!response.ok && response.status !== 401) {
      throw new Error(await response.text());
    }
  } catch (err) {
    console.warn('Logout request failed, clearing local session anyway:', err);
  } finally {
    clearAuthSession();
    appDataLoaded = false;
    clearRenderedData();
    updateAccountNameLabel();
    settingsOverlay.classList.add('hidden');

    // Redirect to login page
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
  }
}

logoutBtn?.addEventListener('click', () => {
  logoutCurrentUser();
});

function setProfileStatus(message) {
  if (profileStatus) profileStatus.textContent = message || '';
}

function setPasswordChangeStatus(message) {
  if (passwordChangeStatus) passwordChangeStatus.textContent = message || '';
}

function setSharingStatus(message) {
  if (sharingStatus) sharingStatus.textContent = message || '';
}

function setShareBlockStatus(message) {
  if (shareBlockStatus) shareBlockStatus.textContent = message || '';
}

function renderShareBlockList(blocks) {
  if (!shareBlockList) return;

  if (!Array.isArray(blocks) || !blocks.length) {
    shareBlockList.innerHTML = '<p class="settings-hint">No blocked users.</p>';
    return;
  }

  shareBlockList.innerHTML = blocks.map(entry => {
    const username = normalizeUsername(entry?.username || '');
    if (!username) return '';

    return [
      `<div class="share-block-item" data-username="${escHtml(username)}">`,
      `  <span class="share-block-name">${escHtml(username)}</span>`,
      `  <button type="button" class="share-block-remove btn" data-username="${escHtml(username)}">Unblock</button>`,
      '</div>',
    ].join('');
  }).join('');

  shareBlockList.querySelectorAll('.share-block-remove').forEach(button => {
    button.addEventListener('click', async () => {
      const username = normalizeUsername(button.dataset.username || '');
      if (!username) return;

      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = '...';
      setShareBlockStatus('Updating block list...');

      try {
        await apiFetch(`/auth/share-blocks/${encodeURIComponent(username)}`, {
          method: 'DELETE',
        });
        await loadShareBlockList();
        setShareBlockStatus(`Unblocked ${username}.`);
      } catch (err) {
        button.disabled = false;
        button.textContent = previousText;
        setShareBlockStatus(`✗ ${err.message}`);
      }
    });
  });
}

async function loadShareBlockList() {
  if (!shareBlockList) return;

  const blocks = await apiFetch('/auth/share-blocks');
  renderShareBlockList(Array.isArray(blocks) ? blocks : []);
}


function setContactStatus(message) {
  if (contactStatus) contactStatus.textContent = message || '';
}

function renderContactList(entries) {
  if (!contactList) return;

  if (!Array.isArray(entries) || !entries.length) {
    contactList.innerHTML = '<p class="settings-hint">No contacts.</p>';
    return;
  }

  contactList.innerHTML = entries.map(c => {
    const username = normalizeUsername(c?.contact_username || '');
    if (!username) return '';
    const alias = String(c?.alias || '').trim();
    const label = alias ? `${escHtml(alias)} <span class="share-block-name">(${escHtml(username)})</span>` : escHtml(username);
    return [
      `<div class="share-block-item" data-username="${escHtml(username)}">`,
      `  <span class="share-block-name">${label}</span>`,
      `  <button type="button" class="btn contact-remove" data-username="${escHtml(username)}">Remove</button>`,
      '</div>',
    ].join('');
  }).join('');

  contactList.querySelectorAll('.contact-remove').forEach(button => {
    button.addEventListener('click', async () => {
      const username = normalizeUsername(button.dataset.username || '');
      if (!username) return;

      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = '...';
      setContactStatus('Updating contacts...');

      try {
        await apiFetch(`/contacts/${encodeURIComponent(username)}`, { method: 'DELETE' });
        await loadContactsList();
        setContactStatus(`Removed ${username}.`);
      } catch (err) {
        button.disabled = false;
        button.textContent = previousText;
        setContactStatus(`✗ ${err.message}`);
      }
    });
  });
}

async function loadContactsList() {
  if (!contactList) return;
  try {
    const rows = await apiFetch('/contacts');
    renderContactList(Array.isArray(rows) ? rows : []);
  } catch (err) {
    setContactStatus(`✗ ${err.message}`);
  }
}

async function loadContactRequests() {
  if (!contactRequestsList) return;
  try {
    const rows = await apiFetch('/contact-requests');
    renderContactRequests(Array.isArray(rows) ? rows : []);
  } catch (err) {
    if (contactRequestsStatus) contactRequestsStatus.textContent = `✗ ${err.message}`;
  }
}

function renderContactRequests(rows) {
  if (!contactRequestsList) return;
  if (!rows.length) {
    contactRequestsList.innerHTML = '<div class="empty-state">No incoming requests.</div>';
    return;
  }
  contactRequestsList.innerHTML = rows.map(r => {
    const msg = r.message ? ` <span class="share-block-name">(${escHtml(r.message)})</span>` : '';
    return [
      `<div class="share-block-item" data-id="${escHtml(String(r.id))}">`,
      `  <span class="share-block-name">${escHtml(r.requester_username)}${msg}</span>`,
      `  <div style="display:flex;gap:.5rem">`,
      `    <button type="button" class="btn contact-request-accept" data-id="${escHtml(String(r.id))}">Accept</button>`,
      `    <button type="button" class="btn btn-danger contact-request-decline" data-id="${escHtml(String(r.id))}">Decline</button>`,
      `  </div>`,
      `</div>`,
    ].join('');
  }).join('');

  contactRequestsList.querySelectorAll('.contact-request-accept').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      const prev = btn.textContent;
      try {
        btn.disabled = true;
        btn.textContent = '...';
        await apiFetch(`/contact-requests/${encodeURIComponent(id)}/accept`, { method: 'POST' });
        // reload both lists
        await Promise.all([loadContactRequests(), loadContactsList()]);
        setContactStatus('Contact request accepted.');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = prev;
        setContactStatus(`✗ ${err.message}`);
      }
    });
  });

  contactRequestsList.querySelectorAll('.contact-request-decline').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      const prev = btn.textContent;
      try {
        btn.disabled = true;
        btn.textContent = '...';
        await apiFetch(`/contact-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadContactRequests();
        setContactStatus('Contact request declined.');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = prev;
        setContactStatus(`✗ ${err.message}`);
      }
    });
  });
}

function setSharingToggleLabel(label) {
  if (!sharingToggleBtn) return;
  const labelNode = sharingToggleBtn.querySelector('.toggle-switch-label');
  if (labelNode) labelNode.textContent = String(label || '');
}

function syncSharingControls() {
  if (!sharingToggleBtn) return;
  sharingToggleBtn.classList.toggle('is-on', isSharingEnabled);
  setSharingToggleLabel(isSharingEnabled ? 'On' : 'Off');
  sharingToggleBtn.setAttribute('aria-checked', isSharingEnabled ? 'true' : 'false');
  sharingToggleBtn.setAttribute('aria-pressed', isSharingEnabled ? 'true' : 'false');
}

async function updateSharingPreference(nextEnabled) {
  const desired = Boolean(nextEnabled);
  const previousLabel = isSharingEnabled ? 'On' : 'Off';

  if (sharingToggleBtn) {
    sharingToggleBtn.disabled = true;
    setSharingToggleLabel('...');
  }
  setSharingStatus('Saving sharing preference...');

  try {
    const me = await apiFetch('/auth/sharing', {
      method: 'PATCH',
      body: JSON.stringify({ sharing_enabled: desired }),
    });

    isSharingEnabled = Boolean(me?.sharing_enabled);
    localStorage.setItem('authSharingEnabled', isSharingEnabled ? 'true' : 'false');
    syncSharingControls();
    setSharingStatus(isSharingEnabled ? 'Sharing is enabled.' : 'Sharing is disabled.');
  } catch (err) {
    setSharingToggleLabel(previousLabel);
    setSharingStatus(`✗ ${err.message}`);
    syncSharingControls();
  } finally {
    if (sharingToggleBtn) sharingToggleBtn.disabled = false;
  }
}

function setPasswordFormVisible(isVisible) {
  const visible = Boolean(isVisible);
  changePasswordForm?.classList.toggle('is-hidden', !visible);
  changePasswordBtn?.classList.toggle('is-hidden', !visible);
  passwordChangeStatus?.classList.toggle('is-hidden', !visible);
  if (togglePasswordFormBtn) {
    togglePasswordFormBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    togglePasswordFormBtn.textContent = visible ? 'Cancel' : 'Change Password';
  }
  if (!visible) {
    setPasswordChangeStatus('');
    if (currentPasswordInput) currentPasswordInput.value = '';
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmNewPasswordInput) confirmNewPasswordInput.value = '';
  }
}

function getProfileOptionList(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const profiles = Array.from(new Set([
    ...availableProfiles,
    activeProfile,
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b));

  if (!q) return profiles;
  return profiles.filter(profile => profile.toLowerCase().includes(q));
}

function renderProfileDropdown(query = '') {
  if (!profileDropdown) return;

  profileDropdownOptions = getProfileOptionList(query);
  if (profileDropdownActiveIndex >= profileDropdownOptions.length) {
    profileDropdownActiveIndex = profileDropdownOptions.length - 1;
  }

  if (!profileDropdownOptions.length) {
    profileDropdown.innerHTML = '<div class="profile-dropdown-empty">No profiles found</div>';
    return;
  }

  profileDropdown.innerHTML = profileDropdownOptions
    .map((profile, index) => `
      <button
        type="button"
        class="profile-option${index === profileDropdownActiveIndex ? ' active' : ''}"
        data-profile="${escHtml(profile)}"
      >${escHtml(profile)}</button>
    `)
    .join('');
}

function openProfileDropdown() {
  if (!profileDropdown || !profileInput) return;

  renderProfileDropdown(profileInput.value);
  profileDropdown.classList.add('open');
  profileInput.setAttribute('aria-expanded', 'true');
  profileDropdownToggle?.setAttribute('aria-expanded', 'true');
  profileDropdownToggle?.classList.add('open');
}

function closeProfileDropdown() {
  if (!profileDropdown || !profileInput) return;

  profileDropdown.classList.remove('open');
  profileInput.setAttribute('aria-expanded', 'false');
  profileDropdownToggle?.setAttribute('aria-expanded', 'false');
  profileDropdownToggle?.classList.remove('open');
  profileDropdownActiveIndex = -1;
}

function renderProfileControls() {
  if (profileInput) {
    profileInput.placeholder = activeProfile || 'default';
  }

  if (profileDropdown?.classList.contains('open')) {
    renderProfileDropdown(profileInput?.value || '');
  }
}

async function loadAvailableProfiles() {
  if (!authToken) {
    availableProfiles = [];
    renderProfileControls();
    return;
  }

  const list = await apiFetch('/profiles');
  availableProfiles = Array.from(new Set(
    (Array.isArray(list) ? list : [])
      .map(normalizeProfile)
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
  renderProfileControls();
}

async function switchProfile(nextProfile, successMessage = true) {
  const normalized = setActiveProfile(nextProfile);
  renderProfileControls();
  if (successMessage) setProfileStatus(`Active profile: ${normalized}`);

  await refreshAppDataForCurrentUser();
  await loadRules();
}

document.getElementById('settings-btn').addEventListener('click', () => {
  closeDateFormatHelpOverlay();
  settingsOverlay.classList.remove('hidden');
  updateAccountNameLabel();
  setProfileStatus(`Active profile: ${activeProfile}`);
  setSharingStatus('');
  setShareBlockStatus('');
  syncSharingControls();
  setPasswordFormVisible(false);
  if (shareBlockUsernameInput) shareBlockUsernameInput.value = '';
  if (profileInput) profileInput.value = '';
  closeProfileDropdown();
  renderProfileControls();
  loadAvailableProfiles().catch(err => setProfileStatus(`✗ ${err.message}`));
  loadShareBlockList().catch(err => setShareBlockStatus(`✗ ${err.message}`));
  loadContactsList().catch(err => setContactStatus(`✗ ${err.message}`));
  loadContactRequests().catch(err => {
    if (contactRequestsStatus) contactRequestsStatus.textContent = `✗ ${err.message}`;
  });
  loadRules();
});
document.getElementById('settings-close').addEventListener('click', () => {
  closeDateFormatHelpOverlay();
  closeProfileDropdown();
  setPasswordFormVisible(false);
  settingsOverlay.classList.add('hidden');
});
settingsOverlay.addEventListener('click', e => {
  if (e.target === settingsOverlay) {
    closeDateFormatHelpOverlay();
    closeProfileDropdown();
    setPasswordFormVisible(false);
    settingsOverlay.classList.add('hidden');
  }
});

sharingToggleBtn?.addEventListener('click', () => {
  void updateSharingPreference(!isSharingEnabled);
});

shareBlockForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const username = normalizeUsername(shareBlockUsernameInput?.value || '');
  if (!username || username.length < 3) {
    setShareBlockStatus('✗ Enter a valid username');
    return;
  }

  if (shareBlockAddBtn) {
    shareBlockAddBtn.disabled = true;
    shareBlockAddBtn.textContent = '...';
  }
  setShareBlockStatus('Updating block list...');

  try {
    await apiFetch('/auth/share-blocks', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    if (shareBlockUsernameInput) shareBlockUsernameInput.value = '';
    await loadShareBlockList();
    setShareBlockStatus(`Blocked ${username}.`);
  } catch (err) {
    setShareBlockStatus(`✗ ${err.message}`);
  } finally {
    if (shareBlockAddBtn) {
      shareBlockAddBtn.disabled = false;
      shareBlockAddBtn.textContent = 'Block';
    }
  }
});

contactForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const username = normalizeUsername(contactUsernameInput?.value || '');
  const alias = String(contactAliasInput?.value || '').trim();
  if (!username || username.length < 3) {
    setContactStatus('✗ Enter a valid username');
    return;
  }

  if (contactAddBtn) {
    contactAddBtn.disabled = true;
    contactAddBtn.textContent = '...';
  }
  setContactStatus('Adding contact...');

  try {
    // send a contact request; alias is sent in the message field so it can be applied if/when accepted
    await apiFetch('/contact-requests', {
      method: 'POST',
      body: JSON.stringify({ recipient_username: username, message: alias }),
    });
    if (contactUsernameInput) contactUsernameInput.value = '';
    if (contactAliasInput) contactAliasInput.value = '';
    // reload contacts (will include new mutual contacts if the recipient auto-accepted)
    await loadContactsList();
    setContactStatus(`Request sent to ${username}.`);
  } catch (err) {
    setContactStatus(`✗ ${err.message}`);
  } finally {
    if (contactAddBtn) {
      contactAddBtn.disabled = false;
      contactAddBtn.textContent = 'Add';
    }
  }
});

togglePasswordFormBtn?.addEventListener('click', () => {
  const isHidden = changePasswordForm?.classList.contains('is-hidden');
  setPasswordFormVisible(isHidden);
  if (isHidden) {
    currentPasswordInput?.focus();
  }
});

dateFormatHelpBtn?.addEventListener('click', () => {
  openDateFormatHelpOverlay();
});

dateFormatHelpCloseBtn?.addEventListener('click', () => {
  closeDateFormatHelpOverlay({ restoreFocus: true });
});

dateFormatHelpOverlay?.addEventListener('click', e => {
  if (e.target === dateFormatHelpOverlay) {
    closeDateFormatHelpOverlay({ restoreFocus: true });
  }
});

const exportCsvBtn = document.getElementById('export-csv-btn');
const importCsvBtn = document.getElementById('import-csv-btn');
const importSourceBtn = document.getElementById('import-source-btn');
const importSourceMenu = document.getElementById('import-source-menu');
const importSplit = document.getElementById('import-split');
const deleteAllBtn = document.getElementById('delete-all-btn');
const importCsvInput = document.getElementById('import-csv-input');
const csvStatus = document.getElementById('csv-status');
let pendingImportSource = 'native';

function setCsvStatus(message) {
  csvStatus.textContent = message;
}

function positionImportSourceMenu() {
  if (!importSourceMenu || !importSplit || importSourceMenu.hidden) return;

  const anchorRect = importSplit.getBoundingClientRect();
  const viewportPadding = 8;

  const menuWidth = Math.max(220, importSourceMenu.offsetWidth || 220);
  const menuHeight = Math.max(1, importSourceMenu.offsetHeight || 1);

  let left = anchorRect.right - menuWidth;
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding));

  let top = anchorRect.bottom + 6;
  if (top + menuHeight > window.innerHeight - viewportPadding) {
    top = anchorRect.top - menuHeight - 6;
  }
  top = Math.max(viewportPadding, top);

  importSourceMenu.style.left = `${Math.round(left)}px`;
  importSourceMenu.style.top = `${Math.round(top)}px`;
}

function closeImportSourceMenu() {
  if (!importSourceMenu || !importSourceBtn) return;
  importSourceMenu.hidden = true;
  importSourceBtn.setAttribute('aria-expanded', 'false');
  importSplit?.classList.remove('menu-open');
  importSourceMenu.style.left = '';
  importSourceMenu.style.top = '';
}

function openImportSourceMenu() {
  if (!importSourceMenu || !importSourceBtn) return;
  importSourceMenu.hidden = false;
  importSourceBtn.setAttribute('aria-expanded', 'true');
  importSplit?.classList.add('menu-open');
  positionImportSourceMenu();
  requestAnimationFrame(positionImportSourceMenu);
}

function triggerImportPicker(source) {
  pendingImportSource = source === 'pocket' ? 'pocket' : 'native';
  importCsvInput.click();
}

exportCsvBtn.addEventListener('click', async () => {
  setCsvStatus('Exporting CSV...');
  try {
    const response = await fetch(`${API}/pages/export.csv`, {
      method: 'GET',
      headers: withAuthHeaders(),
    });
    if (!response.ok) throw new Error(`Export failed (${response.status})`);

    const blob = await response.blob();
    const fallbackName = `project-pocket-saves-${new Date().toISOString().slice(0, 10)}.csv`;
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || fallbackName;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setCsvStatus('✓ Export complete');
  } catch (err) {
    setCsvStatus(`✗ ${err.message}`);
  }
});

profileApplyBtn?.addEventListener('click', async () => {
  const raw = String(profileInput?.value || '').trim();
  if (!raw) {
    setProfileStatus('✗ Enter a profile name');
    return;
  }

  try {
    await switchProfile(raw);
  } catch (err) {
    setProfileStatus(`✗ ${err.message}`);
  }
});

// PBKDF2 helper utilities (Web Crypto)
async function _pbkdf2Hex(password, saltHex, iterations) {
  const enc = new TextEncoder();
  const pwBuf = enc.encode(String(password || ''));
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const key = await crypto.subtle.importKey('raw', pwBuf, { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Number(iterations) },
    key,
    256
  );
  const arr = new Uint8Array(derivedBits);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _randomSaltHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

changePasswordForm?.addEventListener('submit', async e => {
  e.preventDefault();

  const currentPassword = String(currentPasswordInput?.value || '');
  const newPassword = String(newPasswordInput?.value || '');
  const confirmNewPassword = String(confirmNewPasswordInput?.value || '');

  if (currentPassword.length < 8) {
    setPasswordChangeStatus('✗ Enter your current password');
    return;
  }
  if (newPassword.length < 8) {
    setPasswordChangeStatus('✗ New password must be at least 8 characters');
    return;
  }
  if (newPassword !== confirmNewPassword) {
    setPasswordChangeStatus('✗ New passwords do not match');
    return;
  }

  const previousLabel = changePasswordBtn?.textContent || 'Update Password';
  if (changePasswordBtn) {
    changePasswordBtn.disabled = true;
    changePasswordBtn.textContent = 'Updating...';
  }
  setPasswordChangeStatus('Updating password...');

  try {
    // Fetch current salt & iterations for this user
    const params = await apiFetch('/auth/password-params');
    const saltHex = String(params?.salt || '') || '';
    const iterations = Number(params?.iterations || 240000);

    // Derive current password digest locally
    const currentDerived = await _pbkdf2Hex(currentPassword, saltHex, iterations);

    // Generate a new salt locally and derive the new password digest
    const newSaltHex = _randomSaltHex(16);
    const newDerived = await _pbkdf2Hex(newPassword, newSaltHex, iterations);

    await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password_derived: currentDerived,
        new_password_salt: newSaltHex,
        new_password_derived: newDerived,
      }),
    });

    setPasswordChangeStatus('✓ Password updated successfully');
    if (currentPasswordInput) currentPasswordInput.value = '';
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmNewPasswordInput) confirmNewPasswordInput.value = '';
    setPasswordFormVisible(false);
  } catch (err) {
    setPasswordChangeStatus(`✗ ${err.message}`);
  } finally {
    if (changePasswordBtn) {
      changePasswordBtn.disabled = false;
      changePasswordBtn.textContent = previousLabel;
    }
  }
});

profileInput?.addEventListener('keydown', async e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!profileDropdown?.classList.contains('open')) {
      openProfileDropdown();
    }
    if (!profileDropdownOptions.length) return;

    const delta = e.key === 'ArrowDown' ? 1 : -1;
    profileDropdownActiveIndex = (profileDropdownActiveIndex + delta + profileDropdownOptions.length) % profileDropdownOptions.length;
    renderProfileDropdown(profileInput?.value || '');
    return;
  }

  if (e.key === 'Escape') {
    closeProfileDropdown();
    return;
  }

  if (e.key !== 'Enter') return;
  e.preventDefault();

  if (profileDropdown?.classList.contains('open') && profileDropdownActiveIndex >= 0 && profileDropdownOptions[profileDropdownActiveIndex]) {
    profileInput.value = profileDropdownOptions[profileDropdownActiveIndex];
    closeProfileDropdown();
  }
  profileApplyBtn?.click();
});

profileInput?.addEventListener('input', () => {
  profileDropdownActiveIndex = -1;
  openProfileDropdown();
});

profileInput?.addEventListener('focus', () => { openProfileDropdown(); });
profileInput?.addEventListener('click', () => { openProfileDropdown(); });

profileDropdownToggle?.addEventListener('mousedown', e => {
  // Keep input focus state stable while toggling.
  e.preventDefault();
});

profileDropdownToggle?.addEventListener('click', () => {
  if (profileDropdown?.classList.contains('open')) {
    closeProfileDropdown();
    return;
  }
  openProfileDropdown();
  profileInput?.focus();
});

profileDropdown?.addEventListener('mousedown', e => {
  // Keep input focus while clicking options.
  e.preventDefault();
});

profileDropdown?.addEventListener('click', e => {
  const option = e.target.closest('.profile-option');
  if (!option) return;

  profileInput.value = option.dataset.profile || '';
  closeProfileDropdown();
});

document.addEventListener('click', e => {
  const target = e.target;
  const withinProfileUi =
    (profileInput && profileInput.contains(target)) ||
    (profileDropdownToggle && profileDropdownToggle.contains(target)) ||
    (profileApplyBtn && profileApplyBtn.contains(target)) ||
    (profileDropdown && profileDropdown.contains(target));
  if (!withinProfileUi) {
    closeProfileDropdown();
  }
});


// ── Confirmation Modal Logic ────────────────────────────────────────────────
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmInputRow = document.getElementById('confirm-input-row');
const confirmInput = document.getElementById('confirm-input');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmOk = document.getElementById('confirm-ok');
const confirmClose = document.getElementById('confirm-close');
const confirmModal = confirmOverlay?.querySelector('.confirm-modal');

function showConfirm({title, message, requireText, confirmText, okText = 'Delete', danger = true}) {
  return new Promise(resolve => {
    confirmTitle.textContent = title || 'Are you sure?';
    confirmMessage.textContent = message || '';
    confirmInputRow.style.display = requireText ? 'block' : 'none';
    confirmModal?.classList.toggle('confirm-modal--compact', !requireText);
    confirmInput.value = '';
    confirmOk.textContent = okText;
    confirmOk.disabled = !!requireText;
    if (danger) {
      confirmOk.classList.add('btn-danger');
      confirmOk.classList.remove('btn-primary');
    } else {
      confirmOk.classList.remove('btn-danger');
      confirmOk.classList.add('btn-primary');
    }
    confirmOverlay.classList.remove('hidden');
    confirmInput.focused = false;

    function cleanup(result) {
      confirmOverlay.classList.add('hidden');
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      confirmClose.removeEventListener('click', onCancel);
      confirmOverlay.removeEventListener('click', onBgClick);
      if (requireText) confirmInput.removeEventListener('input', onInput);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBgClick(e) { if (e.target === confirmOverlay) cleanup(false); }
    function onInput() {
      confirmOk.disabled = confirmInput.value.trim().toUpperCase() !== confirmText;
    }
    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    confirmClose.addEventListener('click', onCancel);
    confirmOverlay.addEventListener('click', onBgClick);
    if (requireText) confirmInput.addEventListener('input', onInput);
    if (requireText) setTimeout(() => confirmInput.focus(), 100);
  });
}

importCsvBtn.addEventListener('click', () => {
  triggerImportPicker('native');
});

importSourceBtn?.addEventListener('click', () => {
  if (!importSourceMenu) return;
  if (importSourceMenu.hidden) {
    openImportSourceMenu();
    return;
  }
  closeImportSourceMenu();
});

importSourceMenu?.addEventListener('click', e => {
  const option = e.target.closest('.import-source-option');
  if (!option) return;

  const source = (option.dataset.importSource || 'native').trim().toLowerCase();
  closeImportSourceMenu();
  triggerImportPicker(source);
});

document.addEventListener('click', e => {
  if (!importSplit) return;
  if (importSplit.contains(e.target)) return;
  closeImportSourceMenu();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (dateFormatHelpOverlay && !dateFormatHelpOverlay.classList.contains('hidden')) {
    closeDateFormatHelpOverlay({ restoreFocus: true });
    return;
  }
  closeImportSourceMenu();
});

window.addEventListener('resize', positionImportSourceMenu);
document.addEventListener('scroll', positionImportSourceMenu, true);

importCsvInput.addEventListener('change', async () => {
  const file = importCsvInput.files?.[0];
  if (!file) return;

  const importSource = pendingImportSource;
  pendingImportSource = 'native';

  setCsvStatus(importSource === 'pocket' ? 'Importing Mozilla Pocket CSV...' : 'Importing CSV...');
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API}/pages/import.csv?source=${encodeURIComponent(importSource)}`, {
      method: 'POST',
      headers: withAuthHeaders(),
      body: formData,
    });
    if (!response.ok) throw new Error(await response.text());

    const result = await response.json();
    setCsvStatus(`✓ Imported ${result.imported}, skipped ${result.skipped}`);

    await loadAvailableProfiles();
    await loadTagFilter();
    const viewName = getActiveViewName();
    if (viewName === 'domains') {
      await loadDomains();
    } else {
      reloadActiveListView();
    }
  } catch (err) {
    setCsvStatus(`✗ ${err.message}`);
  } finally {
    importCsvInput.value = '';
  }
});

deleteAllBtn.addEventListener('click', async () => {
  const confirmed = await showConfirm({
    title: 'Delete All Saves',
    message: 'This will permanently delete all saved pages. Type DELETE ALL to confirm.',
    requireText: true,
    confirmText: 'DELETE ALL',
    okText: 'Delete All',
    danger: true,
  });

  if (!confirmed) {
    setCsvStatus('✗ Deletion cancelled');
    return;
  }

  setCsvStatus('Deleting all saves...');
  try {
    const response = await fetch(`${API}/pages?confirm=${encodeURIComponent('DELETE ALL')}`, {
      method: 'DELETE',
      headers: withAuthHeaders(),
    });
    if (!response.ok) throw new Error(await response.text());

    const result = await response.json();
    setCsvStatus(`✓ Deleted ${result.deleted} saves`);

    await loadAvailableProfiles();
    await loadTagFilter();
    const viewName = getActiveViewName();
    if (viewName === 'domains') {
      await loadDomains();
    } else {
      reloadActiveListView();
    }
  } catch (err) {
    setCsvStatus(`✗ ${err.message}`);
  }
});

// ── Auth overlay ─────────────────────────────────────────────────────────────

const authOverlay = document.getElementById('auth-overlay');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const authPasswordHint = document.getElementById('auth-password-hint');
const authPasswordConfirmWrap = document.getElementById('auth-confirm-wrap');
const authPasswordConfirmInput = document.getElementById('auth-password-confirm');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authModeLoginBtn = document.getElementById('auth-mode-login');
const authModeRegisterBtn = document.getElementById('auth-mode-register');
const authFootnote = document.getElementById('auth-footnote');
const authStatus = document.getElementById('auth-status');

let authMode = 'login';

function setAuthStatus(message) {
  authStatus.textContent = message || '';
}

function applyAuthMode() {
  const isLogin = authMode === 'login';
  authTitle.textContent = isLogin ? 'Sign In' : 'Create Account';
  authSubtitle.textContent = isLogin
    ? 'Use your account to access your own saves.'
    : 'Create an account to keep your saves private.';
  authSubmitBtn.textContent = isLogin ? 'Sign In' : 'Register';
  authFootnote.textContent = isLogin
    ? 'New here? Switch to Register above to create your account.'
    : 'Already have an account? Switch to Sign In above.';
  authPasswordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
  authPasswordInput.placeholder = 'Password';
  if (authPasswordHint) {
    authPasswordHint.style.display = isLogin ? 'none' : 'block';
  }
  if (authPasswordConfirmWrap) {
    authPasswordConfirmWrap.style.display = isLogin ? 'none' : 'flex';
  }
  if (authPasswordConfirmInput) {
    authPasswordConfirmInput.required = !isLogin;
    authPasswordConfirmInput.autocomplete = 'new-password';
    if (isLogin) authPasswordConfirmInput.value = '';
  }
  authModeLoginBtn.classList.toggle('active', isLogin);
  authModeLoginBtn.setAttribute('aria-selected', isLogin ? 'true' : 'false');
  authModeRegisterBtn.classList.toggle('active', !isLogin);
  authModeRegisterBtn.setAttribute('aria-selected', isLogin ? 'false' : 'true');
}

function showAuthOverlay(message = '') {
  ['modal-overlay', 'add-overlay', 'settings-overlay', 'confirm-overlay', 'date-format-help-overlay'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  applyAuthMode();
  if (message) setAuthStatus(message);
  authOverlay.classList.remove('hidden');
}

function clearRenderedData() {
  ['pages-grid', 'recipes-grid', 'music-grid', 'shared-grid', 'domain-list', 'domain-pages'].forEach(id => {
    const node = document.getElementById(id);
    if (node) node.innerHTML = '';
  });

  activeDomain = '';
  if (typeof pagedViewStates === 'object') {
    Object.values(pagedViewStates).forEach(resetPagedViewState);
  }

  activeTagFilters = [];
  hideRecipesActive = false;
  hideMusicActive = false;
  hideReceivedSharesActive = false;
  hideSentSharesActive = false;
  renderFilterChips();

  knownTags = [];
  closeAllTagDropdowns();
  availableProfiles = [];
  renderProfileControls();
}

function hideAuthOverlay() {
  setAuthStatus('');
  authOverlay.classList.add('hidden');
}

async function refreshAppDataForCurrentUser() {
  geniusSearchCache.clear();
  await loadAvailableProfiles();
  await loadTagFilter();
  const viewName = getActiveViewName();
  if (viewName === 'domains') {
    await loadDomains();
  } else {
    reloadActiveListView();
  }
  appDataLoaded = true;
}

authModeLoginBtn?.addEventListener('click', () => {
  authMode = 'login';
  setAuthStatus('');
  applyAuthMode();
});

authModeRegisterBtn?.addEventListener('click', () => {
  authMode = 'register';
  setAuthStatus('');
  applyAuthMode();
});

authForm?.addEventListener('submit', async e => {
  e.preventDefault();

  const isLogin = authMode === 'login';
  const username = normalizeUsername(authUsernameInput.value);
  const password = String(authPasswordInput.value || '');
  const confirmPassword = String(authPasswordConfirmInput?.value || '');
  if (!username || username.length < 3) {
    setAuthStatus('✗ Username must be at least 3 characters');
    return;
  }
  if (password.length < 8) {
    setAuthStatus('✗ Password must be at least 8 characters');
    return;
  }
  if (!isLogin) {
    if (confirmPassword.length < 8) {
      setAuthStatus('✗ Please confirm your password');
      return;
    }
    if (password !== confirmPassword) {
      setAuthStatus('✗ Passwords do not match');
      return;
    }
  }

  setAuthStatus(isLogin ? 'Signing in...' : 'Creating account...');
  try {
    const endpoint = isLogin ? '/auth/login' : '/auth/register';
    const result = await publicApiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    const meResponse = await fetch(`${API}/auth/me`, {
      headers: {
        Authorization: `Bearer ${result.token}`,
      },
    });

    if (!meResponse.ok) {
      throw new Error(await meResponse.text() || `Failed to load profile (${meResponse.status})`);
    }

    const me = await meResponse.json();
    const isAdmin = Boolean(me.is_admin);
    const resolvedUsername = String(me.username || result.username || username).trim();

    setAuthSession(result.token, resolvedUsername, isAdmin, me.sharing_enabled !== false);
    if (isAdmin) {
      window.location.href = 'admin.html';
      return;
    }

    updateAccountNameLabel();
    authPasswordInput.value = '';
    if (authPasswordConfirmInput) authPasswordConfirmInput.value = '';
    hideAuthOverlay();
    await refreshAppDataForCurrentUser();
  } catch (err) {
    setAuthStatus(`✗ ${err.message}`);
  }
});

async function bootstrapAuthSession() {
  updateAccountNameLabel();
  if (!authToken) {
    clearRenderedData();
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
    return;
  }

  try {
    const me = await apiFetch('/auth/me');
    setAuthSession(authToken, me.username, me.is_admin || false, me.sharing_enabled !== false);
    if (me.is_admin) {
      window.location.href = 'admin.html';
      return;
    }
    updateAccountNameLabel();
    if (!appDataLoaded) {
      await refreshAppDataForCurrentUser();
    }
  } catch {
    clearAuthSession();
    clearRenderedData();
    updateAccountNameLabel();
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
  }
}

syncSharingControls();

// ── Add Page overlay ─────────────────────────────────────────────────────────

const addOverlay = document.getElementById('add-overlay');
document.getElementById('add-page-btn').addEventListener('click', () => {
  addStatus.textContent = '';
  addOverlay.classList.remove('hidden');
});
document.getElementById('add-overlay-close').addEventListener('click', () => {
  addOverlay.classList.add('hidden');
});
addOverlay.addEventListener('click', e => {
  if (e.target === addOverlay) addOverlay.classList.add('hidden');
});

// ── All Pages ────────────────────────────────────────────────────────────────

const pagesGrid = document.getElementById('pages-grid');
const pagesLoadStatus = document.getElementById('pages-load-status');
const searchInput = document.getElementById('search-input');
const filterTagInput = document.getElementById('filter-tag-input');
const filterTagClearBtn = document.getElementById('filter-tag-clear-btn');
const filterTagDropdown = document.getElementById('filter-tag-dropdown');
const filterBarChips = document.getElementById('filter-bar-chips');
let activeTagFilters = []; // [{tag, mode: 'include'|'exclude'}]
let hideRecipesActive = false;
let hideMusicActive = false;
let hideReceivedSharesActive = false;
let hideSentSharesActive = false;
let filterTagDropdownOptions = [];
let filterTagDropdownActiveIndex = -1;
const addTagsInput = document.getElementById('f-tags');
const editTagsInput = document.getElementById('e-tags');
let knownTags = [];
const tagSuggestionConfigs = [
  {
    inputEl: addTagsInput,
    toggleEl: document.getElementById('f-tags-dropdown-toggle'),
    dropdownEl: document.getElementById('f-tags-dropdown'),
    options: [],
    activeIndex: -1,
  },
  {
    inputEl: editTagsInput,
    toggleEl: document.getElementById('e-tags-dropdown-toggle'),
    dropdownEl: document.getElementById('e-tags-dropdown'),
    options: [],
    activeIndex: -1,
  },
].filter(config => config.inputEl && config.toggleEl && config.dropdownEl);

function parseTagList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function splitTagInput(rawValue) {
  const raw = String(rawValue || '');
  const hasTrailingComma = /,\s*$/.test(raw);
  const parts = raw.split(',').map(part => part.trim());

  if (hasTrailingComma) {
    return {
      selected: parts.filter(Boolean),
      current: '',
    };
  }

  return {
    selected: parts.slice(0, -1).filter(Boolean),
    current: (parts[parts.length - 1] || '').trim(),
  };
}

function getTagSuggestionCandidates(inputEl) {
  if (!inputEl) return [];
  const { selected, current } = splitTagInput(inputEl.value);
  const selectedLower = new Set(selected.map(tag => tag.toLowerCase()));
  const needle = current.toLowerCase();
  const prefix = selected.length ? `${selected.join(', ')}, ` : '';

  return knownTags.filter(tag => {
    if (selectedLower.has(tag.toLowerCase())) return false;
    if (!needle) return true;
    return tag.toLowerCase().includes(needle);
  }).map(tag => ({
    label: tag,
    value: prefix + tag,
  }));
}

function closeTagDropdown(config) {
  if (!config?.dropdownEl || !config?.inputEl) return;
  config.dropdownEl.classList.remove('open');
  config.inputEl.setAttribute('aria-expanded', 'false');
  config.toggleEl?.setAttribute('aria-expanded', 'false');
  config.toggleEl?.classList.remove('open');
  config.activeIndex = -1;
}

function closeAllTagDropdowns(exceptInputId = '') {
  tagSuggestionConfigs.forEach(config => {
    if (exceptInputId && config.inputEl.id === exceptInputId) return;
    closeTagDropdown(config);
  });
}

function renderTagDropdown(config) {
  if (!config?.dropdownEl) return;

  config.options = getTagSuggestionCandidates(config.inputEl);
  if (config.activeIndex >= config.options.length) {
    config.activeIndex = config.options.length - 1;
  }

  if (!config.options.length) {
    config.dropdownEl.innerHTML = '<div class="profile-dropdown-empty">No tags found</div>';
    return;
  }

  config.dropdownEl.innerHTML = config.options
    .map((option, index) => `
      <button
        type="button"
        class="profile-option${index === config.activeIndex ? ' active' : ''}"
        data-value="${escHtml(option.value)}"
      >${escHtml(option.label)}</button>
    `)
    .join('');
}

function openTagDropdown(config) {
  if (!config?.dropdownEl || !config?.inputEl) return;
  closeAllTagDropdowns(config.inputEl.id);
  renderTagDropdown(config);
  config.dropdownEl.classList.add('open');
  config.inputEl.setAttribute('aria-expanded', 'true');
  config.toggleEl?.setAttribute('aria-expanded', 'true');
  config.toggleEl?.classList.add('open');
}

function populateTagSuggestions(tags) {
  knownTags = [...tags];

  tagSuggestionConfigs.forEach(config => {
    if (config.dropdownEl.classList.contains('open')) {
      renderTagDropdown(config);
    }
  });

  if (filterTagDropdown?.classList.contains('open')) {
    renderFilterTagDropdown();
  }

  if (recipesPantryDropdown?.classList.contains('open')) {
    renderRecipesTagDropdown();
  }
}

function wireTagSuggestions(config) {
  if (!config?.inputEl || !config?.toggleEl || !config?.dropdownEl) return;

  config.inputEl.addEventListener('focus', () => {
    openTagDropdown(config);
  });

  config.inputEl.addEventListener('click', () => {
    openTagDropdown(config);
  });

  config.inputEl.addEventListener('input', () => {
    config.activeIndex = -1;
    openTagDropdown(config);
  });

  config.inputEl.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!config.dropdownEl.classList.contains('open')) {
        openTagDropdown(config);
      }
      if (!config.options.length) return;

      const delta = e.key === 'ArrowDown' ? 1 : -1;
      config.activeIndex = (config.activeIndex + delta + config.options.length) % config.options.length;
      renderTagDropdown(config);
      return;
    }

    if (e.key === 'Escape') {
      closeTagDropdown(config);
      return;
    }

    if (e.key !== 'Enter') return;
    if (!config.dropdownEl.classList.contains('open') || config.activeIndex < 0 || !config.options[config.activeIndex]) return;

    e.preventDefault();
    config.inputEl.value = config.options[config.activeIndex].value + ', ';
    openTagDropdown(config);
  });

  config.toggleEl.addEventListener('mousedown', e => {
    e.preventDefault();
  });

  config.toggleEl.addEventListener('click', () => {
    if (config.dropdownEl.classList.contains('open')) {
      closeTagDropdown(config);
      return;
    }
    openTagDropdown(config);
    config.inputEl.focus();
  });

  config.dropdownEl.addEventListener('mousedown', e => {
    e.preventDefault();
  });

  config.dropdownEl.addEventListener('click', e => {
    const option = e.target.closest('.profile-option');
    if (!option) return;

    config.inputEl.value = (option.dataset.value || '') + ', ';
    openTagDropdown(config);
    config.inputEl.focus();
  });
}

tagSuggestionConfigs.forEach(wireTagSuggestions);

document.addEventListener('click', e => {
  const target = e.target;
  if (!(target instanceof Element)) {
    closeAllTagDropdowns();
    closeFilterTagDropdown();
    closeRecipesTagDropdown();
    return;
  }

  const withinTagUi = tagSuggestionConfigs.some(config =>
    config.inputEl.contains(target) ||
    config.toggleEl.contains(target) ||
    config.dropdownEl.contains(target)
  );
  if (!withinTagUi) closeAllTagDropdowns();

  const withinFilterTag = filterTagInput?.contains(target) ||
    filterTagClearBtn?.contains(target) ||
    filterTagDropdown?.contains(target);
  if (!withinFilterTag) closeFilterTagDropdown();

  const withinRecipesFilter = recipesPantryInput?.contains(target) ||
    recipesPantryClearBtn?.contains(target) ||
    recipesPantryDropdown?.contains(target);
  if (!withinRecipesFilter) closeRecipesTagDropdown();
});

function getFirstTag(page) {
  const tags = String(page.tags || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  return (tags[0] || '').toLowerCase();
}

function getSortableTitle(page) {
  return String(page.title || page.url || '').trim().toLowerCase();
}

function getSortableTimestamp(page) {
  const value = Date.parse(page.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

function getSortableResaveCount(page) {
  const value = Number(page.resave_count);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sortPages(pages) {
  const mode = tagSort.value;
  const sorted = [...pages];

  if (mode === 'newest' || mode === 'oldest') {
    sorted.sort((a, b) => getSortableTimestamp(b) - getSortableTimestamp(a));
    return mode === 'oldest' ? sorted.reverse() : sorted;
  }

  if (mode === 'resaves-desc') {
    sorted.sort((a, b) => {
      const resaveDelta = getSortableResaveCount(b) - getSortableResaveCount(a);
      if (resaveDelta !== 0) return resaveDelta;
      return getSortableTimestamp(b) - getSortableTimestamp(a);
    });
    return sorted;
  }

  if (mode === 'title-asc' || mode === 'title-desc') {
    sorted.sort((a, b) => getSortableTitle(a).localeCompare(getSortableTitle(b)));
    return mode === 'title-desc' ? sorted.reverse() : sorted;
  }

  if (mode === 'tag-asc' || mode === 'tag-desc') {
    sorted.sort((a, b) => {
      const aTag = getFirstTag(a);
      const bTag = getFirstTag(b);
      if (!aTag && !bTag) return 0;
      if (!aTag) return 1;
      if (!bTag) return -1;
      return aTag.localeCompare(bTag);
    });
    return mode === 'tag-desc' ? sorted.reverse() : sorted;
  }

  return sorted;
}

async function loadTagFilter() {
  const tags = await apiFetch('/tags');
  populateTagSuggestions(tags);
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(reloadActiveListView, 300);
});
tagSort.addEventListener('change', reloadActiveListView);

// ── Filter tag chip input ────────────────────────────────────────────────────

function applyTagFilters(pages) {
  let result = pages;
  for (const { tag, mode } of activeTagFilters) {
    const t = tag.toLowerCase();
    if (mode === 'include') {
      result = result.filter(p => parseTagList(p.tags).some(pt => pt.toLowerCase() === t));
    } else {
      result = result.filter(p => !parseTagList(p.tags).some(pt => pt.toLowerCase() === t));
    }
  }
  return result;
}

function renderFilterChips(viewName) {
  if (!filterBarChips) return;
  const currentView = viewName || getActiveViewName();
  filterBarChips.innerHTML = '';

  activeTagFilters.forEach(({ tag, mode }, index) => {
    const chip = document.createElement('span');
    chip.className = `filter-chip${mode === 'exclude' ? ' exclude' : ''}`;

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'filter-chip-mode';
    modeBtn.title = mode === 'include' ? 'Switch to exclude filter' : 'Switch to include filter';
    modeBtn.textContent = `${mode === 'include' ? '+' : '−'} ${tag}`;
    modeBtn.addEventListener('click', () => {
      activeTagFilters[index].mode = mode === 'include' ? 'exclude' : 'include';
      renderFilterChips();
      reloadActiveListView();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'filter-chip-remove';
    removeBtn.setAttribute('aria-label', `Remove filter: ${tag}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      activeTagFilters.splice(index, 1);
      renderFilterChips();
      reloadActiveListView();
    });

    chip.append(modeBtn, removeBtn);
    filterBarChips.appendChild(chip);
  });

  if (currentView === 'all') {
    const recipesPill = document.createElement('button');
    recipesPill.type = 'button';
    recipesPill.className = `filter-pill filter-pill-right-start${hideRecipesActive ? ' active' : ''}`;
    recipesPill.textContent = '🍳 Hide Recipes';
    recipesPill.addEventListener('click', () => {
      hideRecipesActive = !hideRecipesActive;
      renderFilterChips();
      loadAll();
    });
    filterBarChips.appendChild(recipesPill);

    const musicPill = document.createElement('button');
    musicPill.type = 'button';
    musicPill.className = `filter-pill${hideMusicActive ? ' active' : ''}`;
    musicPill.textContent = '🎵 Hide Music';
    musicPill.addEventListener('click', () => {
      hideMusicActive = !hideMusicActive;
      renderFilterChips();
      loadAll();
    });
    filterBarChips.appendChild(musicPill);

    const receivedPill = document.createElement('button');
    receivedPill.type = 'button';
    receivedPill.className = `filter-pill${hideReceivedSharesActive ? ' active' : ''}`;
    receivedPill.textContent = '📥 Hide Received';
    receivedPill.addEventListener('click', () => {
      hideReceivedSharesActive = !hideReceivedSharesActive;
      renderFilterChips();
      loadAll();
    });
    filterBarChips.appendChild(receivedPill);

    const sentPill = document.createElement('button');
    sentPill.type = 'button';
    sentPill.className = `filter-pill${hideSentSharesActive ? ' active' : ''}`;
    sentPill.textContent = '📤 Hide Sent';
    sentPill.addEventListener('click', () => {
      hideSentSharesActive = !hideSentSharesActive;
      renderFilterChips();
      loadAll();
    });
    filterBarChips.appendChild(sentPill);
  }
}

function addFilterTag(rawTag) {
  const tag = String(rawTag || '').trim();
  if (!tag) return;
  if (activeTagFilters.some(f => f.tag.toLowerCase() === tag.toLowerCase())) return;
  activeTagFilters.push({ tag, mode: 'include' });
  renderFilterChips();
  reloadActiveListView();
}

function getFilterTagSuggestions() {
  const needle = (filterTagInput?.value || '').trim().toLowerCase();
  const active = new Set(activeTagFilters.map(f => f.tag.toLowerCase()));
  return knownTags
    .filter(t => !active.has(t.toLowerCase()) && (!needle || t.toLowerCase().includes(needle)))
    .slice(0, 10);
}

function renderFilterTagDropdown() {
  if (!filterTagDropdown) return;
  filterTagDropdownOptions = getFilterTagSuggestions();
  if (!filterTagDropdownOptions.length) {
    closeFilterTagDropdown();
    return;
  }
  filterTagDropdown.innerHTML = filterTagDropdownOptions
    .map((t, i) => `<button type="button" class="profile-option${i === filterTagDropdownActiveIndex ? ' active' : ''}" data-tag="${escHtml(t)}">${escHtml(t)}</button>`)
    .join('');
  filterTagDropdown.classList.add('open');
  if (filterTagInput) filterTagInput.setAttribute('aria-expanded', 'true');
}

function closeFilterTagDropdown() {
  if (filterTagDropdown) {
    filterTagDropdown.classList.remove('open');
    filterTagDropdown.innerHTML = '';
  }
  if (filterTagInput) filterTagInput.setAttribute('aria-expanded', 'false');
  filterTagDropdownActiveIndex = -1;
  filterTagDropdownOptions = [];
}

if (filterTagInput) {
  filterTagInput.addEventListener('focus', renderFilterTagDropdown);
  filterTagInput.addEventListener('click', renderFilterTagDropdown);
  filterTagInput.addEventListener('input', () => {
    filterTagDropdownActiveIndex = -1;
    renderFilterTagDropdown();
  });
  filterTagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const activeOpt = filterTagDropdownOptions[filterTagDropdownActiveIndex];
      const tag = activeOpt ?? filterTagInput.value.trim();
      if (tag) {
        addFilterTag(tag);
        filterTagInput.value = '';
        closeFilterTagDropdown();
      }
      return;
    }
    if (e.key === 'Escape') { closeFilterTagDropdown(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filterTagDropdown?.classList.contains('open')) renderFilterTagDropdown();
      if (!filterTagDropdownOptions.length) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      filterTagDropdownActiveIndex =
        (filterTagDropdownActiveIndex + delta + filterTagDropdownOptions.length) % filterTagDropdownOptions.length;
      renderFilterTagDropdown();
    }
  });
}

if (filterTagClearBtn) {
  filterTagClearBtn.addEventListener('click', () => {
    activeTagFilters = [];
    hideRecipesActive = false;
    hideMusicActive = false;
    hideReceivedSharesActive = false;
    hideSentSharesActive = false;
    if (filterTagInput) filterTagInput.value = '';
    closeFilterTagDropdown();
    renderFilterChips();
    reloadActiveListView();
  });
}

if (filterTagDropdown) {
  filterTagDropdown.addEventListener('mousedown', e => e.preventDefault());
  filterTagDropdown.addEventListener('click', e => {
    const btn = e.target.closest('[data-tag]');
    if (!btn?.dataset.tag) return;
    addFilterTag(btn.dataset.tag);
    if (filterTagInput) filterTagInput.value = '';
    closeFilterTagDropdown();
  });
}

// ── Recipes ──────────────────────────────────────────────────────────────────

const recipesGrid = document.getElementById('recipes-grid');
const recipesLoadStatus = document.getElementById('recipes-load-status');
const musicGrid = document.getElementById('music-grid');
const musicLoadStatus = document.getElementById('music-load-status');
const sharedGrid = document.getElementById('shared-grid');
const sharedLoadStatus = document.getElementById('shared-load-status');
const recipesPantryInput = document.getElementById('recipes-pantry-input');
const recipesPantryDropdown = document.getElementById('recipes-pantry-dropdown');
const recipesPantryClearBtn = document.getElementById('recipes-pantry-clear');
const recipesPantryList = document.getElementById('recipes-pantry-list');
const recipesMatchModeSelect = document.getElementById('recipes-match-mode');
const recipesMatchSummary = document.getElementById('recipes-match-summary');

let recipeFilters = []; // [{ type: 'ingredient'|'tag', value, mode: 'include'|'exclude' }]
let recipesTagDropdownOptions = [];
let recipesTagDropdownActiveIndex = -1;

function normalizeRecipeFilterType(rawType) {
  return String(rawType || '').toLowerCase() === 'tag' ? 'tag' : 'ingredient';
}

function normalizeRecipeFilterMode(rawMode) {
  return String(rawMode || '').toLowerCase() === 'exclude' ? 'exclude' : 'include';
}

function normalizeRecipeFilterValue(rawValue, type) {
  const cleaned = String(rawValue || '').trim();
  if (!cleaned) return '';
  if (type === 'tag') return cleaned.replace(/^#+/, '').trim();
  return cleaned;
}

function normalizeRecipeFilterEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') return null;

  const type = normalizeRecipeFilterType(rawEntry.type);
  const mode = normalizeRecipeFilterMode(rawEntry.mode);
  const value = normalizeRecipeFilterValue(rawEntry.value, type);
  if (!value) return null;

  return { type, value, mode };
}

function parseRecipeFilterToken(rawToken) {
  let token = String(rawToken || '').trim();
  if (!token) return null;

  let mode = 'include';
  if (token.startsWith('+')) {
    token = token.slice(1).trim();
  } else if (token.startsWith('-')) {
    mode = 'exclude';
    token = token.slice(1).trim();
  }

  const type = token.startsWith('#') ? 'tag' : 'ingredient';
  const value = normalizeRecipeFilterValue(token, type);
  if (!value) return null;

  return { type, value, mode };
}

function getRecipeFilterKey(entry) {
  return `${entry.type}:${entry.value.toLowerCase()}`;
}

try {
  const storedCombined = JSON.parse(localStorage.getItem('recipesCombinedFilters') || '[]');
  if (Array.isArray(storedCombined) && storedCombined.length) {
    recipeFilters = storedCombined
      .map(normalizeRecipeFilterEntry)
      .filter(Boolean);
  }
} catch {
  recipeFilters = [];
}

if (!recipeFilters.length) {
  let legacyIngredients = [];
  let legacyTags = [];

  try {
    const stored = JSON.parse(localStorage.getItem('recipesPantryIngredients') || '[]');
    if (Array.isArray(stored)) {
      legacyIngredients = stored
        .map(item => String(item || '').trim())
        .filter(Boolean);
    }
  } catch {
    legacyIngredients = [];
  }

  try {
    const stored = JSON.parse(localStorage.getItem('recipesTagFilters') || '[]');
    if (Array.isArray(stored)) {
      legacyTags = stored
        .map(item => String(item || '').trim().replace(/^#+/, '').trim())
        .filter(Boolean);
    }
  } catch {
    legacyTags = [];
  }

  const existing = new Set();
  legacyIngredients.forEach(value => {
    const entry = { type: 'ingredient', value, mode: 'include' };
    const key = getRecipeFilterKey(entry);
    if (existing.has(key)) return;
    existing.add(key);
    recipeFilters.push(entry);
  });
  legacyTags.forEach(value => {
    const entry = { type: 'tag', value, mode: 'include' };
    const key = getRecipeFilterKey(entry);
    if (existing.has(key)) return;
    existing.add(key);
    recipeFilters.push(entry);
  });
}

const storedRecipesMatchMode = localStorage.getItem('recipesMatchMode');
if (storedRecipesMatchMode === 'makeable' || storedRecipesMatchMode === 'near' || storedRecipesMatchMode === 'all') {
  recipesMatchModeSelect.value = storedRecipesMatchMode;
} else {
  recipesMatchModeSelect.value = 'all';
}

function savePantryState() {
  const normalized = recipeFilters
    .map(normalizeRecipeFilterEntry)
    .filter(Boolean);

  recipeFilters = normalized;
  localStorage.setItem('recipesCombinedFilters', JSON.stringify(recipeFilters));

  // Keep legacy keys updated for compatibility with older builds.
  const legacyIngredients = recipeFilters
    .filter(entry => entry.type === 'ingredient' && entry.mode === 'include')
    .map(entry => entry.value);
  const legacyTags = recipeFilters
    .filter(entry => entry.type === 'tag' && entry.mode === 'include')
    .map(entry => entry.value);

  localStorage.setItem('recipesPantryIngredients', JSON.stringify(legacyIngredients));
  localStorage.setItem('recipesTagFilters', JSON.stringify(legacyTags));
}

function getRecipeFilters(type, mode = '') {
  return recipeFilters.filter(entry => {
    if (type && entry.type !== type) return false;
    if (mode && entry.mode !== mode) return false;
    return true;
  });
}

function getRecipeTokenState() {
  const raw = String(recipesPantryInput?.value || '');
  const lastComma = raw.lastIndexOf(',');
  if (lastComma < 0) {
    return {
      prefix: '',
      current: raw.trim(),
    };
  }
  return {
    prefix: raw.slice(0, lastComma + 1),
    current: raw.slice(lastComma + 1).trim(),
  };
}

function writeRecipeCurrentToken(nextToken, appendComma = true) {
  if (!recipesPantryInput) return;

  const { prefix } = getRecipeTokenState();
  const cleanPrefix = prefix ? (prefix.endsWith(' ') ? prefix : `${prefix} `) : '';
  recipesPantryInput.value = appendComma
    ? `${cleanPrefix}${nextToken}, `
    : `${cleanPrefix}${nextToken}`;
}

function getRecipesTagSuggestions() {
  const { current } = getRecipeTokenState();
  const match = current.match(/^([+-]?)#(.*)$/);
  if (!match) return [];

  const sign = match[1] === '-' ? '-' : '';
  const needle = String(match[2] || '').trim().toLowerCase();
  const activeTags = new Set(getRecipeFilters('tag').map(entry => entry.value.toLowerCase()));

  return knownTags
    .filter(tag => {
      const lower = tag.toLowerCase();
      if (activeTags.has(lower)) return false;
      if (!needle) return true;
      return lower.includes(needle);
    })
    .slice(0, 10)
    .map(tag => ({
      label: `${sign}#${tag}`,
      value: `${sign}#${tag}`,
    }));
}

function closeRecipesTagDropdown() {
  if (recipesPantryDropdown) {
    recipesPantryDropdown.classList.remove('open');
    recipesPantryDropdown.innerHTML = '';
  }
  if (recipesPantryInput) recipesPantryInput.setAttribute('aria-expanded', 'false');
  recipesTagDropdownActiveIndex = -1;
  recipesTagDropdownOptions = [];
}

function renderRecipesTagDropdown() {
  if (!recipesPantryDropdown) return;

  recipesTagDropdownOptions = getRecipesTagSuggestions();
  if (!recipesTagDropdownOptions.length) {
    closeRecipesTagDropdown();
    return;
  }

  recipesPantryDropdown.innerHTML = recipesTagDropdownOptions
    .map((option, index) => `
      <button
        type="button"
        class="profile-option${index === recipesTagDropdownActiveIndex ? ' active' : ''}"
        data-value="${escHtml(option.value)}"
      >${escHtml(option.label)}</button>
    `)
    .join('');

  recipesPantryDropdown.classList.add('open');
  if (recipesPantryInput) recipesPantryInput.setAttribute('aria-expanded', 'true');
}

function commitRecipesTagSuggestion(value) {
  if (!value) return;
  writeRecipeCurrentToken(value, true);
  closeRecipesTagDropdown();
  recipesPantryInput?.focus();
}

const ingredientCanonicalCache = new Map();

function singularizeIngredientToken(token) {
  if (token.length <= 4) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 5) return token.slice(0, -1);
  return token;
}

function normalizeIngredientKey(value) {
  const units = /\b(g|kg|mg|ml|l|cl|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|pinch|pinches|slice|slices|can|cans|pack|packs|piece|pieces|gram|grams|gramm|liter|liters|litre|litres|el|tl|essloffel|teeloffel|stuck|prise|zehe|zehen|unze|onza|onzas)\b/g;
  const filler = /\b(of|and|with|fresh|optional|to taste|for serving|for garnish|small|medium|large|und|mit|frisch|optional|nach geschmack|zum servieren|zum garnieren|de|con|para servir|al gusto|frais|au gout|per servire)\b/g;

  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[0-9¼½¾⅓⅔⅛⅜⅝⅞/.,]+/g, ' ')
    .replace(units, ' ')
    .replace(filler, ' ')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized
    .split(' ')
    .map(part => singularizeIngredientToken(part.trim()))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadCanonicalIngredientKeys(rawKeys) {
  const keys = Array.from(new Set(
    (Array.isArray(rawKeys) ? rawKeys : [])
      .map(key => String(key || '').trim())
      .filter(Boolean)
  ));

  const missing = keys.filter(key => !ingredientCanonicalCache.has(key));
  if (!missing.length) return;

  try {
    const response = await apiFetch('/ingredients/canonicalize', {
      method: 'POST',
      body: JSON.stringify({ items: missing }),
    });

    const items = Array.isArray(response?.items) ? response.items : [];
    items.forEach(item => {
      const input = String(item?.input || '').trim();
      if (!input) return;
      const canonical = normalizeIngredientKey(item?.canonical || input) || input;
      ingredientCanonicalCache.set(input, canonical);
    });
  } catch {
    // If canonicalization fails, preserve local fuzzy matching with normalized values.
  }

  missing.forEach(key => {
    if (!ingredientCanonicalCache.has(key)) {
      ingredientCanonicalCache.set(key, key);
    }
  });
}

function getCanonicalIngredientKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return '';
  return ingredientCanonicalCache.get(key) || key;
}

function tokenizeIngredientKey(value) {
  return String(value || '')
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 3);
}

function withinEditDistance(a, b, maxDistance) {
  const s = String(a || '');
  const t = String(b || '');
  if (!s || !t) return false;
  if (Math.abs(s.length - t.length) > maxDistance) return false;

  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    let curr = [i];
    let rowMin = curr[0];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const val = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      curr.push(val);
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDistance) return false;
    for (let j = 0; j <= t.length; j += 1) prev[j] = curr[j];
  }

  return prev[t.length] <= maxDistance;
}

function ingredientMatchesPantry(ingredientKey, pantryKeys) {
  if (!ingredientKey) return false;

  const ingredientTokens = tokenizeIngredientKey(ingredientKey);
  return pantryKeys.some(pantryKey => {
    if (!pantryKey) return false;
    if (ingredientKey === pantryKey) return true;
    if (ingredientKey.includes(pantryKey) || pantryKey.includes(ingredientKey)) return true;

    const typoLimit = Math.max(1, Math.min(2, Math.floor(Math.max(ingredientKey.length, pantryKey.length) / 8)));
    if (withinEditDistance(ingredientKey, pantryKey, typoLimit)) return true;

    const pantryTokens = tokenizeIngredientKey(pantryKey);
    return ingredientTokens.some(token => pantryTokens.some(pantryToken => {
      if (token === pantryToken) return true;
      if (token.includes(pantryToken) || pantryToken.includes(token)) return true;

      const tokenTypoLimit = Math.max(1, Math.min(2, Math.floor(Math.max(token.length, pantryToken.length) / 7)));
      return withinEditDistance(token, pantryToken, tokenTypoLimit);
    }));
  });
}

function getRecipeMatchInfo(ingredientKeys, pantryKeys) {
  if (!ingredientKeys.length) {
    return { canEvaluate: false, missingCount: Infinity };
  }

  const missingCount = ingredientKeys.filter(key => !ingredientMatchesPantry(key, pantryKeys)).length;
  return { canEvaluate: true, missingCount };
}

async function applyRecipesPantryFilter(recipes) {
  const mode = recipesMatchModeSelect.value;
  const includeIngredients = getRecipeFilters('ingredient', 'include').map(entry => entry.value);
  const excludeIngredients = getRecipeFilters('ingredient', 'exclude').map(entry => entry.value);
  const includeIngredientKeys = Array.from(new Set(includeIngredients.map(normalizeIngredientKey).filter(Boolean)));
  const excludeIngredientKeys = Array.from(new Set(excludeIngredients.map(normalizeIngredientKey).filter(Boolean)));

  const summaryBits = [];
  const includeIngredientsCount = includeIngredients.length;
  const excludeIngredientsCount = excludeIngredients.length;
  const includeTagsCount = getRecipeFilters('tag', 'include').length;
  const excludeTagsCount = getRecipeFilters('tag', 'exclude').length;
  if (includeIngredientsCount) summaryBits.push(`+${includeIngredientsCount} ingredient${includeIngredientsCount === 1 ? '' : 's'}`);
  if (excludeIngredientsCount) summaryBits.push(`-${excludeIngredientsCount} ingredient${excludeIngredientsCount === 1 ? '' : 's'}`);
  if (includeTagsCount) summaryBits.push(`+${includeTagsCount} tag${includeTagsCount === 1 ? '' : 's'}`);
  if (excludeTagsCount) summaryBits.push(`-${excludeTagsCount} tag${excludeTagsCount === 1 ? '' : 's'}`);
  const summaryPrefix = summaryBits.length ? `Filters: ${summaryBits.join(', ')}` : '';

  if (!includeIngredientKeys.length && !excludeIngredientKeys.length) {
    return {
      recipes,
      summary: summaryPrefix || '',
    };
  }

  const records = recipes.map(page => ({
    page,
    ingredientKeys: Array.from(new Set(
      recipeLines(page.recipe_ingredients).map(normalizeIngredientKey).filter(Boolean)
    )),
  }));

  const canonicalInputKeys = [
    ...includeIngredientKeys,
    ...excludeIngredientKeys,
    ...records.flatMap(record => record.ingredientKeys),
  ];
  await loadCanonicalIngredientKeys(canonicalInputKeys);

  const canonicalIncludeKeys = Array.from(new Set(
    includeIngredientKeys.map(getCanonicalIngredientKey).filter(Boolean)
  ));
  const canonicalExcludeKeys = Array.from(new Set(
    excludeIngredientKeys.map(getCanonicalIngredientKey).filter(Boolean)
  ));
  const canonicalRecords = records.map(record => ({
    page: record.page,
    ingredientKeys: Array.from(new Set(
      record.ingredientKeys.map(getCanonicalIngredientKey).filter(Boolean)
    )),
  }));

  const withoutExcluded = canonicalExcludeKeys.length
    ? canonicalRecords.filter(record => !canonicalExcludeKeys.some(key => ingredientMatchesPantry(key, record.ingredientKeys)))
    : canonicalRecords;

  if (mode === 'all') {
    const allFiltered = withoutExcluded;

    return {
      recipes: allFiltered.map(record => record.page),
      summary: `${summaryPrefix ? `${summaryPrefix}. ` : ''}Showing ${allFiltered.length} of ${recipes.length} recipes`,
    };
  }

  if (!canonicalIncludeKeys.length) {
    return {
      recipes: withoutExcluded.map(record => record.page),
      summary: `${summaryPrefix ? `${summaryPrefix}. ` : ''}No positive ingredient filters set for ${mode === 'near' ? 'near-match' : 'makeable'} mode`,
    };
  }

  let skippedNoIngredients = 0;
  const filtered = withoutExcluded.filter(record => {
    const info = getRecipeMatchInfo(record.ingredientKeys, canonicalIncludeKeys);
    if (!info.canEvaluate) {
      skippedNoIngredients += 1;
      return false;
    }
    if (mode === 'makeable') return info.missingCount === 0;
    if (mode === 'near') return info.missingCount <= 3;
    return true;
  });

  const modeText = mode === 'near'
    ? 'missing up to 3 ingredients'
    : 'you can make right now';
  const skipText = skippedNoIngredients
    ? ` (${skippedNoIngredients} skipped: no ingredient list)`
    : '';

  return {
    recipes: filtered.map(record => record.page),
    summary: `${summaryPrefix ? `${summaryPrefix}. ` : ''}Showing ${filtered.length} of ${recipes.length} recipes ${modeText}${skipText}`,
  };
}

function applyRecipeTagFilters(recipes) {
  const includeTags = getRecipeFilters('tag', 'include').map(entry => entry.value.toLowerCase());
  const excludeTags = getRecipeFilters('tag', 'exclude').map(entry => entry.value.toLowerCase());
  if (!includeTags.length && !excludeTags.length) return recipes;

  return recipes.filter(page => {
    const pageTags = new Set(parseTagList(page.tags).map(tag => tag.toLowerCase()));
    const includeOk = includeTags.every(tag => pageTags.has(tag));
    const excludeOk = excludeTags.every(tag => !pageTags.has(tag));
    return includeOk && excludeOk;
  });
}

function renderRecipesFilters() {
  recipesPantryList.innerHTML = '';

  recipeFilters.forEach((entry, index) => {
    const chip = document.createElement('span');
    chip.className = `recipes-pantry-chip${entry.mode === 'exclude' ? ' exclude' : ''}`;

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'recipes-pantry-chip-mode';
    modeBtn.title = entry.mode === 'include' ? 'Switch to exclude filter' : 'Switch to include filter';
    modeBtn.textContent = `${entry.mode === 'include' ? '+' : '−'} ${entry.type === 'tag' ? `#${entry.value}` : entry.value}`;
    modeBtn.addEventListener('click', () => {
      recipeFilters[index].mode = entry.mode === 'include' ? 'exclude' : 'include';
      savePantryState();
      renderRecipesFilters();
      if (getActiveViewName() === 'recipes') loadRecipes();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'recipes-pantry-chip-remove';
    removeBtn.setAttribute('aria-label', `Remove ${entry.type} filter: ${entry.value}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      recipeFilters.splice(index, 1);
      savePantryState();
      renderRecipesFilters();
      if (getActiveViewName() === 'recipes') loadRecipes();
    });

    chip.append(modeBtn, removeBtn);
    recipesPantryList.appendChild(chip);
  });
}

function applyRecipesSummary(text) {
  recipesMatchSummary.textContent = text || '';
}

function addRecipesFilters(rawValue) {
  const additions = parseTagList(rawValue)
    .map(parseRecipeFilterToken)
    .filter(Boolean);
  if (!additions.length) return false;

  const existingFilterKeys = new Set(recipeFilters.map(getRecipeFilterKey));
  let changed = false;

  additions.forEach(entry => {
    const key = getRecipeFilterKey(entry);
    if (!existingFilterKeys.has(key)) {
      recipeFilters.push(entry);
      existingFilterKeys.add(key);
      changed = true;
    }
  });

  if (changed) {
    savePantryState();
    renderRecipesFilters();
  }
  return changed;
}

function commitRecipesFiltersFromInput() {
  const changed = addRecipesFilters(recipesPantryInput.value);
  recipesPantryInput.value = '';
  closeRecipesTagDropdown();
  recipesPantryInput.focus();
  if (changed && getActiveViewName() === 'recipes') loadRecipes();
}

recipesPantryInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!recipesPantryDropdown?.classList.contains('open')) renderRecipesTagDropdown();
    if (!recipesTagDropdownOptions.length) return;
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    recipesTagDropdownActiveIndex =
      (recipesTagDropdownActiveIndex + delta + recipesTagDropdownOptions.length) % recipesTagDropdownOptions.length;
    renderRecipesTagDropdown();
    return;
  }

  if (e.key === 'Escape') {
    closeRecipesTagDropdown();
    return;
  }

  if (e.key !== 'Enter') return;
  e.preventDefault();

  if (recipesPantryDropdown?.classList.contains('open') && recipesTagDropdownActiveIndex >= 0) {
    const active = recipesTagDropdownOptions[recipesTagDropdownActiveIndex];
    if (active?.value) {
      commitRecipesTagSuggestion(active.value);
      return;
    }
  }

  commitRecipesFiltersFromInput();
});

recipesPantryInput.addEventListener('focus', renderRecipesTagDropdown);
recipesPantryInput.addEventListener('click', renderRecipesTagDropdown);
recipesPantryInput.addEventListener('input', () => {
  recipesTagDropdownActiveIndex = -1;
  renderRecipesTagDropdown();
});

if (recipesPantryDropdown) {
  recipesPantryDropdown.addEventListener('mousedown', e => e.preventDefault());
  recipesPantryDropdown.addEventListener('click', e => {
    const option = e.target.closest('[data-value]');
    if (!option?.dataset.value) return;
    commitRecipesTagSuggestion(option.dataset.value);
  });
}

recipesPantryClearBtn.addEventListener('click', () => {
  recipeFilters = [];
  savePantryState();
  renderRecipesFilters();
  closeRecipesTagDropdown();
  if (getActiveViewName() === 'recipes') loadRecipes();
});

recipesMatchModeSelect.addEventListener('change', () => {
  localStorage.setItem('recipesMatchMode', recipesMatchModeSelect.value);
  if (getActiveViewName() === 'recipes') loadRecipes();
});

renderRecipesFilters();

const domainList = document.getElementById('domain-list');
const domainPages = document.getElementById('domain-pages');
const domainPagesLoadStatus = document.getElementById('domain-pages-load-status');

const PAGE_BATCH_SIZE = 60;
let activeDomain = '';

const pagedViewStates = {
  all: createPagedViewState('all', pagesGrid, pagesLoadStatus),
  recipes: createPagedViewState('recipes', recipesGrid, recipesLoadStatus, { showRecipeDetails: true }),
  music: createPagedViewState('music', musicGrid, musicLoadStatus),
  shared: createPagedViewState('shared', sharedGrid, sharedLoadStatus),
  domains: createPagedViewState('domains', domainPages, domainPagesLoadStatus),
};

function createPagedViewState(key, container, statusEl, cardOptions = {}) {
  return {
    key,
    container,
    statusEl,
    cardOptions,
    items: [],
    offset: 0,
    hasMore: true,
    loading: false,
    requestKey: '',
    serial: 0,
    fetchedCount: 0,
    renderedCount: 0,
  };
}

function setPagedViewStatus(state, message = '') {
  if (!state?.statusEl) return;
  state.statusEl.textContent = message;
  state.statusEl.style.display = message ? 'block' : 'none';
}

function resetPagedViewState(state) {
  if (!state) return;
  state.items = [];
  state.offset = 0;
  state.hasMore = true;
  state.loading = false;
  state.requestKey = '';
  state.serial += 1;
  state.fetchedCount = 0;
  state.renderedCount = 0;
  if (state.container) state.container.innerHTML = '';
  setPagedViewStatus(state, '');
}

function appendTagFilterParams(params, filters) {
  (filters || []).forEach(filter => {
    const tag = String(filter?.tag || '').trim();
    if (!tag) return;
    params.append(filter.mode === 'exclude' ? 'exclude_tag' : 'include_tag', tag);
  });
}

function getCurrentSortMode() {
  return String(tagSort?.value || 'newest');
}

function buildPagedPagesParams(viewKey, offsetValue = 0) {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_BATCH_SIZE));
  params.set('offset', String(Math.max(0, offsetValue)));
  params.set('sort', getCurrentSortMode());

  if (viewKey !== 'shared') {
    // Keep pending requests out of regular lists; they appear in the Requests tab.
    params.set('share_status', 'accepted');
  }

  if (viewKey !== 'domains' && searchInput.value) {
    params.set('search', searchInput.value);
  }

  if (viewKey === 'all') {
    appendTagFilterParams(params, activeTagFilters);
    if (hideRecipesActive) params.set('exclude_recipe', 'true');
    if (hideMusicActive) params.set('exclude_music', 'true');
    if (hideReceivedSharesActive) params.set('exclude_shared_received', 'true');
    if (hideSentSharesActive) params.set('exclude_shared_sent', 'true');
  } else if (viewKey === 'recipes') {
    params.set('is_recipe', 'true');
    appendTagFilterParams(
      params,
      getRecipeFilters('tag').map(entry => ({ tag: entry.value, mode: entry.mode }))
    );
  } else if (viewKey === 'music') {
    params.set('is_music', 'true');
    appendTagFilterParams(params, activeTagFilters);
  } else if (viewKey === 'shared') {
    params.set('shared_only', 'true');
    params.set('share_status', 'accepted');  // Only show accepted/sent shares in the main view
    appendTagFilterParams(params, activeTagFilters);
  } else if (viewKey === 'domains' && activeDomain) {
    params.set('domain', activeDomain);
  }

  return params;
}

function getPagedRequestKey(viewKey) {
  return buildPagedPagesParams(viewKey, 0).toString();
}

function getActivePagedViewState() {
  const viewName = getActiveViewName();
  if (viewName === 'domains') {
    return activeDomain ? pagedViewStates.domains : null;
  }
  return pagedViewStates[viewName] || null;
}

function getRecipeSummaryPrefix() {
  const summaryBits = [];
  const includeIngredientsCount = getRecipeFilters('ingredient', 'include').length;
  const excludeIngredientsCount = getRecipeFilters('ingredient', 'exclude').length;
  const includeTagsCount = getRecipeFilters('tag', 'include').length;
  const excludeTagsCount = getRecipeFilters('tag', 'exclude').length;

  if (includeIngredientsCount) summaryBits.push(`+${includeIngredientsCount} ingredient${includeIngredientsCount === 1 ? '' : 's'}`);
  if (excludeIngredientsCount) summaryBits.push(`-${excludeIngredientsCount} ingredient${excludeIngredientsCount === 1 ? '' : 's'}`);
  if (includeTagsCount) summaryBits.push(`+${includeTagsCount} tag${includeTagsCount === 1 ? '' : 's'}`);
  if (excludeTagsCount) summaryBits.push(`-${excludeTagsCount} tag${excludeTagsCount === 1 ? '' : 's'}`);

  return summaryBits.length ? `Filters: ${summaryBits.join(', ')}` : '';
}

function updatePagedRecipesSummary(state) {
  const prefix = getRecipeSummaryPrefix();

  if (!state.renderedCount && !state.loading && !prefix) {
    applyRecipesSummary('');
    return;
  }

  let summary = prefix ? `${prefix}. ` : '';
  if (state.loading && !state.renderedCount) {
    summary += 'Loading recipes...';
  } else if (state.hasMore) {
    summary += `Loaded ${state.renderedCount} matching recipe${state.renderedCount === 1 ? '' : 's'} so far`;
  } else {
    summary += `Showing ${state.renderedCount} recipe${state.renderedCount === 1 ? '' : 's'}`;
  }
  applyRecipesSummary(summary.trim());
}

async function transformPagedChunk(viewKey, pages) {
  if (viewKey === 'recipes') {
    const result = await applyRecipesPantryFilter(pages);
    return result.recipes;
  }
  return pages;
}

function beginPagedRequest(state) {
  state.items = [];
  state.offset = 0;
  state.hasMore = true;
  state.loading = false;
  state.serial += 1;
  state.fetchedCount = 0;
  state.renderedCount = 0;
  state.requestKey = getPagedRequestKey(state.key);
  state.container.innerHTML = '';
  setPagedViewStatus(state, '');
  if (state.key === 'recipes') updatePagedRecipesSummary(state);
}

async function loadNextPageForState(state) {
  if (!state || state.loading || !state.hasMore) return;

  const serial = state.serial;
  state.loading = true;
  setPagedViewStatus(state, state.renderedCount ? 'Loading more...' : 'Loading...');
  if (state.key === 'recipes') updatePagedRecipesSummary(state);

  try {
    const params = buildPagedPagesParams(state.key, state.offset);
    const rawPages = await apiFetch('/pages?' + params.toString());
    if (serial !== state.serial) return;

    state.offset += rawPages.length;
    state.hasMore = rawPages.length === PAGE_BATCH_SIZE;
    state.fetchedCount += rawPages.length;

    const visiblePages = await transformPagedChunk(state.key, rawPages);
    if (serial !== state.serial) return;

    const append = state.renderedCount > 0;
    if (visiblePages.length) {
      renderCards(state.container, visiblePages, { ...state.cardOptions, append });
      state.items.push(...visiblePages);
      state.renderedCount += visiblePages.length;
    } else if (!state.renderedCount && !state.hasMore) {
      renderCards(state.container, [], state.cardOptions);
    }
  } catch (err) {
    if (serial !== state.serial) return;
    if (!state.renderedCount) {
      renderCards(state.container, [], state.cardOptions);
    }
    setPagedViewStatus(state, `Failed to load: ${err.message}`);
    return;
  } finally {
    if (serial === state.serial) {
      state.loading = false;
      if (!state.hasMore) setPagedViewStatus(state, '');
      else if (state.renderedCount) setPagedViewStatus(state, 'Scroll to load more');
      if (state.key === 'recipes') updatePagedRecipesSummary(state);
    }
  }
}

async function ensurePagedViewFilled(state) {
  if (!state) return;

  let guard = 0;
  while (state.hasMore && !state.loading && guard < 8) {
    const rect = state.container.getBoundingClientRect();
    const needsMore = state.renderedCount === 0 || rect.bottom < window.innerHeight + 160;
    if (!needsMore) break;
    await loadNextPageForState(state);
    guard += 1;
  }
}

async function loadPagedView(viewKey) {
  const state = pagedViewStates[viewKey];
  if (!state) return;
  beginPagedRequest(state);
  await loadNextPageForState(state);
  await ensurePagedViewFilled(state);
}

async function maybeLoadMoreActiveView() {
  const state = getActivePagedViewState();
  if (!state || state.loading || !state.hasMore) return;

  const scrollBottom = window.innerHeight + window.scrollY;
  const threshold = document.documentElement.scrollHeight - 720;
  if (scrollBottom < threshold) return;

  await loadNextPageForState(state);
}

window.addEventListener('scroll', () => {
  maybeLoadMoreActiveView();
}, { passive: true });

window.addEventListener('resize', () => {
  ensurePagedViewFilled(getActivePagedViewState());
});

async function loadAll() {
  await loadPagedView('all');
}

async function loadRecipes() {
  await loadPagedView('recipes');
}

async function loadMusic() {
  await loadPagedView('music');
}

// Build a card for a pending share request with accept/decline buttons
function buildPendingShareCard(page) {
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.id = page.id;
  
  const sharedByUsername = page.shared_by || 'Unknown';
  const sharedAtIso = String(page.created_at || '');
  const sharedAt = formatDate(sharedAtIso) || 'Unknown date';
  const sharedAtIsoAttr = sharedAtIso ? ` data-iso="${escHtml(sharedAtIso)}"` : '';

  const tags = page.tags ? page.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const tagHtml = [
    page.is_recipe ? '<span class="tag recipe-badge">🍳 Recipe</span>' : '',
    page.is_music ? '<span class="tag music-badge">🎵 Music</span>' : '',
    ...tags.map(t => `<span class="tag">${escHtml(t)}</span>`),
  ].join('');

  card.innerHTML = `
    <div class="card-top">
      <img class="card-favicon" src="${escHtml(page.favicon)}" alt=""
           onerror="this.style.display='none'" />
      <span class="card-domain">${escHtml(page.domain)}</span>
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(page.title || page.url)}</div>
      ${page.description ? `<div class="card-desc">${escHtml(page.description)}</div>` : ''}
      ${tagHtml ? `<div class="card-tags">${tagHtml}</div>` : ''}
      <div class="card-meta">
        <span class="card-date">📤 Shared by: ${escHtml(sharedByUsername)}</span>
        <span class="card-date"${sharedAtIsoAttr}>🕒 ${escHtml(sharedAt)}</span>
      </div>
      <div class="card-actions" style="display: flex; gap: 0.5rem;">
        <button type="button" class="accept-share-btn btn-primary" data-page-id="${page.id}">✓ Accept</button>
        <button type="button" class="decline-share-btn btn-danger" data-page-id="${page.id}">✗ Decline</button>
      </div>
    </div>
  `;

  return card;
}

// Load sent shares (pages you shared with others)
async function loadSentShares() {
  const sentGrid = document.getElementById('sent-grid');
  const sentStatus = document.getElementById('sent-load-status');
  
  try {
    sentStatus.textContent = 'Loading...';
    const params = new URLSearchParams();
    params.set('is_shared_sent', 'true');
    params.set('share_status', 'accepted');
    params.set('limit', '100');
    
    const sentPages = await apiFetch('/pages?' + params.toString());
    
    if (!Array.isArray(sentPages) || !sentPages.length) {
      sentGrid.innerHTML = '<p class="settings-hint">No sent shares yet.</p>';
      sentStatus.textContent = '';
      return;
    }
    
    sentGrid.innerHTML = '';
    sentPages.forEach(p => sentGrid.appendChild(buildCard(p)));
    sentStatus.textContent = '';
    
  } catch (err) {
    sentGrid.innerHTML = '<p class="settings-hint">No shared pages found.</p>';
    sentStatus.textContent = `Failed to load: ${err.message}`;
  }
}

// Load received shares (pages others shared with you that you accepted)
async function loadReceivedShares() {
  const receivedGrid = document.getElementById('received-grid');
  const receivedStatus = document.getElementById('received-load-status');
  
  try {
    receivedStatus.textContent = 'Loading...';
    const params = new URLSearchParams();
    params.set('is_shared_received', 'true');
    params.set('share_status', 'accepted');
    params.set('limit', '100');
    
    const receivedPages = await apiFetch('/pages?' + params.toString());
    
    if (!Array.isArray(receivedPages) || !receivedPages.length) {
      receivedGrid.innerHTML = '<p class="settings-hint">No received shares yet.</p>';
      receivedStatus.textContent = '';
      return;
    }
    
    receivedGrid.innerHTML = '';
    receivedPages.forEach(p => receivedGrid.appendChild(buildCard(p)));
    receivedStatus.textContent = '';
    
  } catch (err) {
    receivedGrid.innerHTML = '<p class="settings-hint">No shared pages found.</p>';
    receivedStatus.textContent = `Failed to load: ${err.message}`;
  }
}

// Load pending share requests (pages others shared with you that are pending)
async function loadPendingRequests() {
  const requestsGrid = document.getElementById('requests-grid');
  const requestsStatus = document.getElementById('requests-load-status');
  
  try {
    requestsStatus.textContent = 'Loading...';
    const params = new URLSearchParams();
    params.set('is_shared_received', 'true');
    params.set('share_status', 'pending');
    params.set('limit', '100');
    
    const pendingPages = await apiFetch('/pages?' + params.toString());
    
    if (!Array.isArray(pendingPages) || !pendingPages.length) {
      requestsGrid.innerHTML = '<p class="settings-hint">No pending requests.</p>';
      requestsStatus.textContent = '';
      return;
    }
    
    requestsGrid.innerHTML = '';
    pendingPages.forEach(p => requestsGrid.appendChild(buildPendingShareCard(p)));
    requestsStatus.textContent = '';
    
    // Add event listeners
    requestsGrid.querySelectorAll('.accept-share-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await handleShareAction(btn.dataset.pageId, 'accept');
      });
    });
    
    requestsGrid.querySelectorAll('.decline-share-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await handleShareAction(btn.dataset.pageId, 'decline');
      });
    });
    
  } catch (err) {
    requestsGrid.innerHTML = '<p class="settings-hint">No pending requests.</p>';
    requestsStatus.textContent = `Failed to load: ${err.message}`;
  }
}

// Handle accepting or declining a share
async function handleShareAction(pageId, action) {
  try {
    const endpoint = action === 'accept' ? 'share-accept' : 'share-decline';
    await apiFetch(`/pages/${pageId}/${endpoint}`, {
      method: 'POST',
    });
    
    // Reload all share views
    await loadSentShares();
    await loadReceivedShares();
    await loadPendingRequests();
    
  } catch (err) {
    alert(`Failed to ${action} share: ${err.message}`);
  }
}

// ── Domains ──────────────────────────────────────────────────────────────────

async function loadDomainPages() {
  const state = pagedViewStates.domains;
  if (!activeDomain) {
    resetPagedViewState(state);
    return;
  }
  await loadPagedView('domains');
}

async function loadDomains() {
  const domains = await apiFetch('/domains');
  domainList.innerHTML = domains.map(d =>
    `<button class="domain-chip" data-domain="${escHtml(d)}">${escHtml(d)}</button>`
  ).join('');
  activeDomain = '';
  resetPagedViewState(pagedViewStates.domains);

  domainList.querySelectorAll('.domain-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      domainList.querySelectorAll('.domain-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeDomain = String(chip.dataset.domain || '').trim();
      await loadDomainPages();
    });
  });
}

// ── Add Form ─────────────────────────────────────────────────────────────────

const addForm = document.getElementById('add-form');
const addStatus = document.getElementById('add-status');

addForm.addEventListener('submit', async e => {
  e.preventDefault();
  addStatus.textContent = 'Saving…';

  const rawUrl = document.getElementById('f-url').value;
  const ytTimestamp = document.getElementById('f-yt-time').value;
  const deviceLabel = await getDeviceLabel('web');
  let urlToSave = rawUrl;

  try {
    urlToSave = withYouTubeTimestamp(rawUrl, ytTimestamp);
  } catch (err) {
    addStatus.textContent = '✗ Error: ' + err.message;
    return;
  }

  try {
    const manualTitle = String(document.getElementById('f-title').value || '').trim();
    await apiFetch('/pages', {
      method: 'POST',
      body: JSON.stringify({
        url: urlToSave,
        title: manualTitle,
        title_is_manual: Boolean(manualTitle),
        notes: document.getElementById('f-notes').value,
        tags: document.getElementById('f-tags').value,
        is_recipe: document.getElementById('f-recipe').checked,
        is_music: document.getElementById('f-music').checked,
        device: deviceLabel,
        saved_via: 'web',
      }),
    });
    addStatus.textContent = '✓ Saved!';
    addForm.reset();
    await loadAvailableProfiles();
    await loadTagFilter();
    setTimeout(() => { addOverlay.classList.add('hidden'); addStatus.textContent = ''; }, 1200);
  } catch (err) {
    addStatus.textContent = '✗ Error: ' + err.message;
  }
});

// ── Edit Modal ───────────────────────────────────────────────────────────────

const overlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const editForm = document.getElementById('edit-form');

async function deletePageById(pageId, options = {}) {
  const { closeEditModal = false } = options;
  const confirmed = await showConfirm({
    title: 'Delete Page',
    message: 'Are you sure you want to delete this page?',
    requireText: false,
    danger: true,
  });
  if (!confirmed) return false;

  await apiFetch(`/pages/${pageId}`, { method: 'DELETE' });
  if (closeEditModal) {
    overlay.classList.add('hidden');
  }
  if (getActiveViewName() === 'domains') await loadDomains();
  else await reloadActiveListView();
  await loadTagFilter();
  return true;
}

async function profileContainsPageUrl(profileName, rawUrl) {
  const profile = normalizeProfile(profileName);
  const url = String(rawUrl || '').trim();
  if (!profile || !url) return false;

  const params = new URLSearchParams({
    search: url,
    limit: '200',
    sort: 'newest',
  });
  const pages = await apiFetch(`/pages?${params.toString()}`, { profile });
  if (!Array.isArray(pages)) return false;
  return pages.some(page => String(page?.url || '').trim() === url);
}

async function transferPageToProfile(pageId, targetProfile, options = {}) {
  const { move = false } = options;
  const normalizedTarget = normalizeProfile(targetProfile);
  if (!normalizedTarget || normalizedTarget === activeProfile) {
    return false;
  }

  const page = await apiFetch(`/pages/${pageId}`);
  const pageUrl = String(page.url || '').trim();

  if (move) {
    const existsInTarget = await profileContainsPageUrl(normalizedTarget, pageUrl);
    if (existsInTarget) {
      const confirmedDelete = await showConfirm({
        title: 'Delete Existing Save',
        message: `This save already exists in profile "${normalizedTarget}". Delete it from your current profile?`,
        requireText: false,
        okText: 'Delete',
        danger: true,
      });
      if (!confirmedDelete) return false;

      await apiFetch(`/pages/${pageId}`, { method: 'DELETE' });
      await loadAvailableProfiles();
      if (getActiveViewName() === 'domains') await loadDomains();
      else await reloadActiveListView();
      await loadTagFilter();
      return true;
    }

    const confirmed = await showConfirm({
      title: 'Move Save',
      message: `Move this save to profile "${normalizedTarget}"?`,
      requireText: false,
      okText: 'Move',
      danger: false,
    });
    if (!confirmed) return false;
  }

  await apiFetch('/pages', {
    method: 'POST',
    profile: normalizedTarget,
    body: JSON.stringify({
      url: page.url,
      title: page.title,
      title_is_manual: true,
      description: page.description || '',
      tags: page.tags || '',
      is_recipe: Boolean(page.is_recipe),
      is_music: Boolean(page.is_music),
      notes: page.notes || '',
      device: page.device || '',
      saved_via: page.saved_via || 'web',
    }),
  });

  if (!move) {
    await loadAvailableProfiles();
    return true;
  }

  await apiFetch(`/pages/${pageId}`, { method: 'DELETE' });
  await loadAvailableProfiles();
  if (getActiveViewName() === 'domains') await loadDomains();
  else await reloadActiveListView();
  await loadTagFilter();
  return true;
}

function openEditModal(page) {
  currentEditId = page.id;
  modalTitle.textContent = page.title || page.url;
  document.getElementById('e-title').value = page.title;
  document.getElementById('e-notes').value = page.notes;
  document.getElementById('e-tags').value = page.tags;
  document.getElementById('e-recipe').checked = page.is_recipe;
  document.getElementById('e-music').checked = page.is_music;
  overlay.classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

editForm.addEventListener('submit', async e => {
  e.preventDefault();
  await apiFetch(`/pages/${currentEditId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: document.getElementById('e-title').value,
      notes: document.getElementById('e-notes').value,
      tags: document.getElementById('e-tags').value,
      is_recipe: document.getElementById('e-recipe').checked,
      is_music: document.getElementById('e-music').checked,
    }),
  });
  overlay.classList.add('hidden');
  if (getActiveViewName() === 'domains') await loadDomains();
  else await reloadActiveListView();
  await loadTagFilter();
});

document.getElementById('modal-delete').addEventListener('click', async () => {
  if (!currentEditId) return;
  await deletePageById(currentEditId, { closeEditModal: true });
});

// ── Auto-tag rules ────────────────────────────────────────────────────────────

const ruleList = document.getElementById('rule-list');
const ruleForm = document.getElementById('rule-form');
const ruleStatus = document.getElementById('rule-status');

const MATCH_LABELS = {
  domain: 'domain =',
  domain_wildcard: 'domain ~', // legacy label for existing rules
  url_contains: 'URL contains',
  url_wildcard: 'URL wildcard', // legacy label for existing rules
  title_contains: 'title contains',
  title_wildcard: 'title wildcard', // legacy label for existing rules
  device_or_origin_contains: 'device/origin contains',
};

async function loadRules() {
  const rules = await apiFetch('/auto-tag-rules');
  ruleList.innerHTML = '';
  if (!rules.length) {
    ruleList.innerHTML = '<p class="empty-state">No rules yet. Add one above.</p>';
    return;
  }
  rules.forEach(rule => {
    const item = document.createElement('div');
    item.className = 'rule-item';
    const tagHtml = rule.tags.split(',').map(t => `<span class="tag">${escHtml(t.trim())}</span>`).join('');
    item.innerHTML = `
      <span class="rule-type">${escHtml(MATCH_LABELS[rule.match_type] ?? rule.match_type)}</span>
      <span class="rule-pattern">${escHtml(rule.pattern)}</span>
      <span class="rule-sep">&#8594;</span>
      <span class="rule-tags">${tagHtml}</span>
      <button class="rule-delete" data-id="${rule.id}">&times;</button>
    `;
    item.querySelector('.rule-delete').addEventListener('click', async () => {
      await apiFetch(`/auto-tag-rules/${rule.id}`, { method: 'DELETE' });
      loadRules();
    });
    ruleList.appendChild(item);
  });
}

ruleForm.addEventListener('submit', async e => {
  e.preventDefault();
  ruleStatus.textContent = 'Saving…';
  try {
    await apiFetch('/auto-tag-rules', {
      method: 'POST',
      body: JSON.stringify({
        match_type: document.getElementById('r-match-type').value,
        pattern: document.getElementById('r-pattern').value.trim(),
        tags: document.getElementById('r-tags').value.trim(),
      }),
    });
    ruleStatus.textContent = '✓ Rule added';
    document.getElementById('r-pattern').value = '';
    document.getElementById('r-tags').value = '';
    loadRules();
  } catch (err) {
    ruleStatus.textContent = '✗ ' + err.message;
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
initCustomSelects();
applyThemeMode();
applyViewMode();
applyDateFormatMode();
updateFilterBarState(getActiveViewName());
bootstrapAuthSession();
