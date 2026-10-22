const DEFAULT_SERVER = 'http://localhost:3000';
const DEFAULT_POPUP_THEME = 'dark';
const POPUP_THEME_VALUES = new Set(['dark', 'light', 'oled']);
let knownTags = [];
let availableProfiles = [];
const popupTagsInput = document.getElementById('tags');
const tagsDropdownToggle = document.getElementById('tags-dropdown-toggle');
const tagsDropdown = document.getElementById('tags-dropdown');
const popupProfileInput = document.getElementById('pocket-user');
const profileDropdownToggle = document.getElementById('profile-dropdown-toggle');
const profileDropdown = document.getElementById('profile-dropdown');
let tagSuggestionController = null;
let profileSuggestionController = null;
let knownTagsLoaded = false;
let profilesLoaded = false;
let knownTagsLoadPromise = null;
let profilesLoadPromise = null;

function normalizePopupTheme(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return POPUP_THEME_VALUES.has(value) ? value : DEFAULT_POPUP_THEME;
}

function applyPopupTheme(rawValue) {
  const theme = normalizePopupTheme(rawValue);
  document.body?.setAttribute('data-theme', theme);
  const themeSelect = document.getElementById('theme-mode');
  if (themeSelect && themeSelect.value !== theme) {
    themeSelect.value = theme;
  }
  return theme;
}

async function getPopupTheme() {
  return new Promise(resolve => {
    chrome.storage.local.get(['popupTheme'], result => {
      resolve(normalizePopupTheme(result.popupTheme));
    });
  });
}

function normalizePocketUser(rawValue) {
  const input = String(rawValue || '').trim();
  if (!input) return 'default';
  const safe = input.replace(/[^a-zA-Z0-9._-]/g, '');
  return safe.slice(0, 64) || 'default';
}

function normalizeUsername(rawValue) {
  const input = String(rawValue || '').trim().toLowerCase();
  const safe = input.replace(/[^a-zA-Z0-9._-]/g, '');
  return safe.slice(0, 64);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function createSuggestionController({ inputEl, toggleEl, dropdownEl, getOptions, emptyMessage }) {
  if (!inputEl || !toggleEl || !dropdownEl) return null;

  const controller = {
    options: [],
    activeIndex: -1,
    isOpen() {
      return dropdownEl.classList.contains('open');
    },
    refresh() {
      controller.options = getOptions();
      if (controller.activeIndex >= controller.options.length) {
        controller.activeIndex = controller.options.length - 1;
      }

      if (!controller.options.length) {
        dropdownEl.innerHTML = `<div class="suggestion-empty">${emptyMessage}</div>`;
        return;
      }

      dropdownEl.innerHTML = controller.options
        .map((option, index) => `
          <button
            type="button"
            class="suggestion-option${index === controller.activeIndex ? ' active' : ''}"
            data-value="${escHtml(option.value)}"
          >${escHtml(option.label)}</button>
        `)
        .join('');
    },
    open() {
      closeAllSuggestionDropdowns(inputEl.id);
      controller.refresh();
      dropdownEl.classList.add('open');
      inputEl.setAttribute('aria-expanded', 'true');
      toggleEl.setAttribute('aria-expanded', 'true');
      toggleEl.classList.add('open');
    },
    close() {
      dropdownEl.classList.remove('open');
      inputEl.setAttribute('aria-expanded', 'false');
      toggleEl.setAttribute('aria-expanded', 'false');
      toggleEl.classList.remove('open');
      controller.activeIndex = -1;
    },
  };

  inputEl.addEventListener('focus', () => controller.open());
  inputEl.addEventListener('click', () => controller.open());
  inputEl.addEventListener('input', () => {
    controller.activeIndex = -1;
    controller.open();
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!controller.isOpen()) controller.open();
      if (!controller.options.length) return;

      const delta = e.key === 'ArrowDown' ? 1 : -1;
      controller.activeIndex = (controller.activeIndex + delta + controller.options.length) % controller.options.length;
      controller.refresh();
      return;
    }

    if (e.key === 'Escape') {
      controller.close();
      return;
    }

    if (e.key !== 'Enter') return;
    if (!controller.isOpen() || controller.activeIndex < 0 || !controller.options[controller.activeIndex]) return;

    e.preventDefault();
    inputEl.value = controller.options[controller.activeIndex].value;
    controller.close();
  });

  toggleEl.addEventListener('mousedown', e => {
    e.preventDefault();
  });

  toggleEl.addEventListener('click', () => {
    if (controller.isOpen()) {
      controller.close();
      return;
    }
    controller.open();
    inputEl.focus();
  });

  dropdownEl.addEventListener('mousedown', e => {
    e.preventDefault();
  });

  dropdownEl.addEventListener('click', e => {
    const option = e.target.closest('.suggestion-option');
    if (!option) return;

    inputEl.value = option.dataset.value || '';
    controller.close();
    inputEl.focus();
  });

  return controller;
}

function closeAllSuggestionDropdowns(exceptInputId = '') {
  [tagSuggestionController, profileSuggestionController].forEach(controller => {
    if (!controller) return;
    if (exceptInputId && controller.inputId === exceptInputId) return;
    controller.close();
  });
}

function getTagSuggestionOptions() {
  if (!popupTagsInput) return [];

  const { selected, current } = splitTagInput(popupTagsInput.value);
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

function getProfileSuggestionOptions() {
  if (!popupProfileInput) return [];
  const needle = String(popupProfileInput.value || '').trim().toLowerCase();

  return availableProfiles
    .filter(profile => !needle || profile.toLowerCase().includes(needle))
    .map(profile => ({ label: profile, value: profile }));
}

function ensureTagSuggestionController() {
  if (tagSuggestionController) return tagSuggestionController;
  tagSuggestionController = createSuggestionController({
    inputEl: popupTagsInput,
    toggleEl: tagsDropdownToggle,
    dropdownEl: tagsDropdown,
    getOptions: getTagSuggestionOptions,
    emptyMessage: 'No tags found',
  });
  if (tagSuggestionController) tagSuggestionController.inputId = popupTagsInput.id;
  return tagSuggestionController;
}

function ensureProfileSuggestionController() {
  if (profileSuggestionController) return profileSuggestionController;
  profileSuggestionController = createSuggestionController({
    inputEl: popupProfileInput,
    toggleEl: profileDropdownToggle,
    dropdownEl: profileDropdown,
    getOptions: getProfileSuggestionOptions,
    emptyMessage: 'No profiles found',
  });
  if (profileSuggestionController) profileSuggestionController.inputId = popupProfileInput.id;
  return profileSuggestionController;
}

function updateTagSuggestionsForInput(inputEl) {
  if (!inputEl || inputEl !== popupTagsInput) return;
  ensureTagSuggestionController()?.refresh();
}

function wireTagSuggestions(inputEl) {
  if (!inputEl || inputEl !== popupTagsInput) return;
  ensureTagSuggestionController();
}

function wireProfileSuggestions(inputEl) {
  if (!inputEl || inputEl !== popupProfileInput) return;
  ensureProfileSuggestionController();
}

function invalidateSuggestionCaches({ clearTags = false, clearProfiles = false } = {}) {
  if (clearTags) {
    knownTags = [];
    ensureTagSuggestionController()?.refresh();
  }
  if (clearProfiles) {
    availableProfiles = [];
    ensureProfileSuggestionController()?.refresh();
  }

  knownTagsLoaded = false;
  profilesLoaded = false;
  knownTagsLoadPromise = null;
  profilesLoadPromise = null;
}

async function loadKnownTags(serverUrl, pocketUser, authToken = '') {
  try {
    const headers = {
      'X-Pocket-Profile': pocketUser,
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const resp = await fetch(`${serverUrl}/api/tags`, { headers });
    if (!resp.ok) throw new Error('Failed to load tags');
    const tags = await resp.json();
    if (!Array.isArray(tags)) throw new Error('Invalid tags payload');

    knownTags = [...new Set(tags
      .map(tag => String(tag || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    ensureTagSuggestionController()?.refresh();
  } catch {
    // Keep suggestions optional; popup save flow should work even if tag lookup fails.
  }
}

function mergeKnownTagsFromInput(rawTagValue) {
  const additions = parseTagList(rawTagValue);
  if (!additions.length) return;

  const byLower = new Map(knownTags.map(tag => [tag.toLowerCase(), tag]));
  additions.forEach(tag => {
    const key = tag.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, tag);
  });

  knownTags = Array.from(byLower.values()).sort((a, b) => a.localeCompare(b));
  ensureTagSuggestionController()?.refresh();
}

function renderProfileControls(currentProfile) {
  if (!popupProfileInput) return;

  const normalizedCurrent = normalizePocketUser(currentProfile || 'default');
  popupProfileInput.value = normalizedCurrent;
  ensureProfileSuggestionController()?.refresh();
}

document.addEventListener('click', e => {
  const target = e.target;
  if (!(target instanceof Element)) {
    closeAllSuggestionDropdowns();
    return;
  }

  const withinSuggestionUi = [
    popupTagsInput,
    tagsDropdownToggle,
    tagsDropdown,
    popupProfileInput,
    profileDropdownToggle,
    profileDropdown,
  ].some(node => node && node.contains(target));

  if (!withinSuggestionUi) {
    closeAllSuggestionDropdowns();
  }
});

async function loadAvailableProfiles(serverUrl, pocketUser, authToken = '') {
  if (!authToken) {
    availableProfiles = [];
    renderProfileControls(pocketUser);
    return;
  }

  try {
    const headers = {
      Authorization: `Bearer ${authToken}`,
      'X-Pocket-Profile': pocketUser,
    };
    const resp = await fetch(`${serverUrl}/api/profiles`, { headers });
    if (!resp.ok) throw new Error('Failed to load profiles');
    const profiles = await resp.json();
    if (!Array.isArray(profiles)) throw new Error('Invalid profiles payload');

    availableProfiles = [...new Set(profiles
      .map(profile => normalizePocketUser(profile))
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  } catch {
    availableProfiles = [];
  }

  renderProfileControls(pocketUser);
}

async function ensureKnownTagsLoaded({ force = false } = {}) {
  if (knownTagsLoaded && !force) return;
  if (knownTagsLoadPromise && !force) return knownTagsLoadPromise;

  knownTagsLoadPromise = (async () => {
    const [serverUrl, pocketUser, { authToken }] = await Promise.all([
      getServerUrl(),
      getPocketUser(),
      getAuthState(),
    ]);
    await loadKnownTags(serverUrl, pocketUser, authToken);
    knownTagsLoaded = true;
    updateTagSuggestionsForInput(popupTagsInput);
  })().finally(() => {
    knownTagsLoadPromise = null;
  });

  return knownTagsLoadPromise;
}

async function ensureAvailableProfilesLoaded({ force = false } = {}) {
  if (profilesLoaded && !force) return;
  if (profilesLoadPromise && !force) return profilesLoadPromise;

  profilesLoadPromise = (async () => {
    const [serverUrl, pocketUser, { authToken }] = await Promise.all([
      getServerUrl(),
      getPocketUser(),
      getAuthState(),
    ]);
    await loadAvailableProfiles(serverUrl, pocketUser, authToken);
    profilesLoaded = true;
  })().finally(() => {
    profilesLoadPromise = null;
  });

  return profilesLoadPromise;
}

function wireLazySuggestionLoads() {
  popupTagsInput?.addEventListener('focus', () => {
    ensureKnownTagsLoaded();
  });
  popupTagsInput?.addEventListener('click', () => {
    ensureKnownTagsLoaded();
  });
  tagsDropdownToggle?.addEventListener('click', () => {
    ensureKnownTagsLoaded();
  });

  popupProfileInput?.addEventListener('focus', () => {
    ensureAvailableProfilesLoaded();
  });
  popupProfileInput?.addEventListener('click', () => {
    ensureAvailableProfilesLoaded();
  });
  profileDropdownToggle?.addEventListener('click', () => {
    ensureAvailableProfilesLoaded();
  });
}

async function getServerUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl'], result => {
      resolve((result.serverUrl || DEFAULT_SERVER).trim().replace(/\/$/, ''));
    });
  });
}

async function getPocketUser() {
  return new Promise(resolve => {
    chrome.storage.local.get(['pocketUser'], result => {
      resolve(normalizePocketUser(result.pocketUser || 'default'));
    });
  });
}

async function getAuthState() {
  return new Promise(resolve => {
    chrome.storage.local.get(['authToken', 'authUsername'], result => {
      resolve({
        authToken: String(result.authToken || '').trim(),
        authUsername: normalizeUsername(result.authUsername || ''),
      });
    });
  });
}

async function buildApiHeaders(options = {}) {
  const includeJson = options.includeJson !== false;
  const pocketUser = await getPocketUser();
  const { authToken } = await getAuthState();

  const headers = {
    'X-Pocket-Profile': pocketUser,
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (includeJson) headers['Content-Type'] = 'application/json';
  return headers;
}

function updateAuthInfo(text) {
  const info = document.getElementById('auth-info');
  if (info) info.textContent = text || '';
}

function setAuthUiState(authState) {
  const saveUi = document.getElementById('save-ui');
  const authOnlyPanel = document.getElementById('auth-only-panel');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings-panel');
  const logoutPanel = document.getElementById('auth-logout-panel');
  const hasToken = Boolean(authState?.authToken);

  if (saveUi) saveUi.style.display = hasToken ? 'block' : 'none';
  if (authOnlyPanel) authOnlyPanel.style.display = hasToken ? 'none' : 'block';
  if (settingsToggle) settingsToggle.style.display = hasToken ? 'inline-block' : 'none';
  if (!hasToken && settingsPanel) settingsPanel.classList.remove('open');
  if (logoutPanel) logoutPanel.style.display = hasToken ? 'block' : 'none';

  updateAuthInfo(hasToken ? `Signed in as ${authState.authUsername || 'user'}` : '');
}

function promptForLogin(statusMessage = '✗ Please sign in first') {
  const status = document.getElementById('status');
  const usernameInput = document.getElementById('auth-username');
  if (status) status.textContent = statusMessage;
  if (usernameInput) usernameInput.focus();
}

async function getCurrentTab() {
  const queryInfo = { active: true, currentWindow: true };

  // Firefox Promise API via `browser` namespace
  if (typeof browser !== 'undefined' && browser.tabs?.query) {
    try {
      const tabs = await browser.tabs.query(queryInfo);
      return (tabs && tabs[0]) || null;
    } catch {
      // Fall through to chrome-based paths.
    }
  }

  // Promise-style `chrome.tabs.query`
  try {
    const maybePromise = chrome.tabs.query(queryInfo);
    if (maybePromise && typeof maybePromise.then === 'function') {
      const tabs = await maybePromise;
      return (tabs && tabs[0]) || null;
    }
  } catch {
    // Fall through to callback-based path.
  }

  // Callback-style `chrome.tabs.query`
  return new Promise(resolve => {
    try {
      chrome.tabs.query(queryInfo, tabs => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve((tabs && tabs[0]) || null);
      });
    } catch {
      resolve(null);
    }
  });
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

function isDefaultMusicUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();

    const exactHosts = new Set([
      'music.youtube.com',
      'spotify.com',
      'open.spotify.com',
      'soundcloud.com',
      'm.soundcloud.com',
      'tidal.com',
      'listen.tidal.com',
      'deezer.com',
      'www.deezer.com',
      'music.apple.com',
      'bandcamp.com',
      'last.fm',
      'www.last.fm',
      'pandora.com',
      'www.pandora.com',
      'music.amazon.com',
    ]);

    const suffixHosts = [
      '.spotify.com',
      '.bandcamp.com',
      '.soundcloud.com',
      '.tidal.com',
      '.deezer.com',
      '.last.fm',
      '.pandora.com',
    ];

    return (
      exactHosts.has(host) ||
      suffixHosts.some(suffix => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

function isDefaultRecipeUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();

    const exactHosts = new Set([
      'chefkoch.de',
      'www.chefkoch.de',
      'bbcgoodfood.com',
      'www.bbcgoodfood.com',
      'allrecipes.com',
      'www.allrecipes.com',
      'foodnetwork.com',
      'www.foodnetwork.com',
      'seriouseats.com',
      'www.seriouseats.com',
      'simplyrecipes.com',
      'www.simplyrecipes.com',
      'tasty.co',
      'www.tasty.co',
      'epicurious.com',
      'www.epicurious.com',
      'giallozafferano.it',
      'www.giallozafferano.it',
    ]);

    const suffixHosts = [
      '.chefkoch.de',
      '.bbcgoodfood.com',
      '.allrecipes.com',
      '.foodnetwork.com',
      '.seriouseats.com',
      '.simplyrecipes.com',
      '.tasty.co',
      '.epicurious.com',
      '.giallozafferano.it',
    ];

    return (
      exactHosts.has(host) ||
      suffixHosts.some(suffix => host.endsWith(suffix))
    );
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

  const brands = (navigator.userAgentData?.brands || [])
    .map(brand => brand.brand)
    .join(' ');
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

// ── Init popup ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const popupTheme = await getPopupTheme();
  applyPopupTheme(popupTheme);

  const tab = await getCurrentTab().catch(() => null);
  const titleInput = document.getElementById('title');
  const tagsInput = document.getElementById('tags');
  wireTagSuggestions(tagsInput);
  wireProfileSuggestions(document.getElementById('pocket-user'));
  wireLazySuggestionLoads();

  titleInput.placeholder = tab?.title || tab?.url || 'Title';

  const ytTimeRow = document.getElementById('yt-time-row');
  ytTimeRow.style.display = isYouTubeUrl(tab?.url || '') ? 'flex' : 'none';

  // Recipe pages default to checked to speed up saves.
  document.getElementById('is-recipe').checked = isDefaultRecipeUrl(tab?.url || '');

  // Music pages default to checked to speed up saves.
  document.getElementById('is-music').checked = isDefaultMusicUrl(tab?.url || '');

  // Pre-fill tags from storage (last used)
  chrome.storage.local.get(['lastTags'], r => {
    if (r.lastTags) tagsInput.value = r.lastTags;
    updateTagSuggestionsForInput(tagsInput);
  });

  // Load server URL into settings
  const serverUrl = await getServerUrl();
  const pocketUser = await getPocketUser();
  const { authToken, authUsername } = await getAuthState();
  document.getElementById('server-url').value = serverUrl;
  document.getElementById('auth-username').value = authUsername;
  renderProfileControls(pocketUser);
  applyPopupTheme(popupTheme);
  setAuthUiState({ authToken, authUsername });
  updateTagSuggestionsForInput(tagsInput);
});

// ── Save button ──────────────────────────────────────────────────────────────

document.getElementById('save-btn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const tags = document.getElementById('tags').value.trim();
  const customTitle = document.getElementById('title').value.trim();
  const notes = document.getElementById('notes').value.trim();
  const isRecipe = document.getElementById('is-recipe').checked;
  const isMusic = document.getElementById('is-music').checked;
  const ytTimestamp = document.getElementById('yt-time').value.trim();

  const tab = await getCurrentTab().catch(() => null);
  if (!tab?.url) {
    status.textContent = '✗ Could not read current tab URL';
    return;
  }
  const serverUrl = await getServerUrl();
  const deviceLabel = await getDeviceLabel('extension');
  let urlToSave = tab.url;

  try {
    urlToSave = withYouTubeTimestamp(tab.url, ytTimestamp);
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
    return;
  }

  status.textContent = 'Saving…';

  try {
    const resp = await fetch(`${serverUrl}/api/pages`, {
      method: 'POST',
      headers: await buildApiHeaders(),
      body: JSON.stringify({
        url: urlToSave,
        title: customTitle || tab.title || '',
        title_is_manual: Boolean(customTitle),
        tags,
        notes,
        is_recipe: isRecipe,
        is_music: isMusic,
        device: deviceLabel,
        saved_via: 'extension',
      }),
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        await new Promise(resolve => {
          chrome.storage.local.remove(['authToken', 'authUsername'], resolve);
        });
        setAuthUiState({ authToken: '', authUsername: '' });
        promptForLogin();
        return;
      }
      throw new Error(`Server error ${resp.status}`);
    }

    status.textContent = '✓ Saved!';
    mergeKnownTagsFromInput(tags);
    updateTagSuggestionsForInput(document.getElementById('tags'));
    chrome.storage.local.set({ lastTags: tags });
    document.getElementById('title').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('is-recipe').checked = false;
    document.getElementById('is-music').checked = false;
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
  }
});

// ── Settings ─────────────────────────────────────────────────────────────────

document.getElementById('settings-toggle').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.toggle('open');
});

document.getElementById('save-settings').addEventListener('click', () => {
  const url = document.getElementById('server-url').value.trim().replace(/\/$/, '');
  const pocketUser = normalizePocketUser(document.getElementById('pocket-user').value);
  const popupTheme = applyPopupTheme(document.getElementById('theme-mode')?.value || DEFAULT_POPUP_THEME);
  document.getElementById('pocket-user').value = pocketUser;

  chrome.storage.local.set({ serverUrl: url, pocketUser, popupTheme }, async () => {
    invalidateSuggestionCaches({ clearTags: true, clearProfiles: true });
    document.getElementById('status').textContent = '✓ Settings saved';
  });
});

document.getElementById('theme-mode')?.addEventListener('change', e => {
  applyPopupTheme(e.target?.value || DEFAULT_POPUP_THEME);
});

document.getElementById('auth-login-btn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const serverUrl = await getServerUrl();
  const pocketUser = await getPocketUser();
  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');

  const username = normalizeUsername(usernameInput.value);
  const password = String(passwordInput.value || '');
  if (username.length < 3) {
    status.textContent = '✗ Username too short';
    return;
  }
  if (password.length < 8) {
    status.textContent = '✗ Password too short';
    return;
  }

  status.textContent = 'Signing in...';
  try {
    const resp = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) throw new Error(await resp.text());

    const data = await resp.json();
    await new Promise(resolve => {
      chrome.storage.local.set({ authToken: data.token, authUsername: data.username }, resolve);
    });

    passwordInput.value = '';
    setAuthUiState({ authToken: data.token, authUsername: data.username });
    invalidateSuggestionCaches({ clearTags: true, clearProfiles: true });
    status.textContent = '✓ Signed in';
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
  }
});

document.getElementById('auth-logout-btn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const serverUrl = await getServerUrl();
  const pocketUser = await getPocketUser();
  const { authToken } = await getAuthState();

  try {
    if (authToken) {
      await fetch(`${serverUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
    }
  } catch {
    // Ignore logout errors and still clear local token.
  }

  await new Promise(resolve => {
    chrome.storage.local.remove(['authToken', 'authUsername'], resolve);
  });

  setAuthUiState({ authToken: '', authUsername: '' });
  invalidateSuggestionCaches({ clearTags: true, clearProfiles: true });
  promptForLogin('✓ Signed out');
});

document.getElementById('open-pocket-btn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const rawUrl = (await getServerUrl()).trim().replace(/\/$/, '');

  try {
    const parsed = new URL(rawUrl);
    await chrome.tabs.create({ url: parsed.toString() });
    window.close();
  } catch {
    status.textContent = '✗ Invalid Pocket server URL in settings';
  }
});
