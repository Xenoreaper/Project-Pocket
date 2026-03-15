const DEFAULT_SERVER = 'http://localhost:3000';
let knownTags = [];

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

function updateTagSuggestionsForInput(inputEl) {
  const suggestionList = document.getElementById('tag-suggestions-list');
  if (!inputEl || !suggestionList) return;

  const { selected, current } = splitTagInput(inputEl.value);
  const selectedLower = new Set(selected.map(tag => tag.toLowerCase()));
  const needle = current.toLowerCase();
  const prefix = selected.length ? `${selected.join(', ')}, ` : '';

  const candidates = knownTags.filter(tag => {
    if (selectedLower.has(tag.toLowerCase())) return false;
    if (!needle) return true;
    return tag.toLowerCase().includes(needle);
  });

  suggestionList.innerHTML = '';
  candidates.forEach(tag => {
    const option = document.createElement('option');
    option.value = prefix + tag;
    suggestionList.appendChild(option);
  });
}

function wireTagSuggestions(inputEl) {
  if (!inputEl) return;

  inputEl.addEventListener('focus', () => {
    updateTagSuggestionsForInput(inputEl);
    try { inputEl.showPicker?.(); } catch {}
  });

  inputEl.addEventListener('click', () => {
    updateTagSuggestionsForInput(inputEl);
    try { inputEl.showPicker?.(); } catch {}
  });

  inputEl.addEventListener('input', () => {
    updateTagSuggestionsForInput(inputEl);
  });

  inputEl.addEventListener('change', () => {
    updateTagSuggestionsForInput(inputEl);
  });
}

async function loadKnownTags(serverUrl) {
  try {
    const resp = await fetch(`${serverUrl}/api/tags`);
    if (!resp.ok) throw new Error('Failed to load tags');
    const tags = await resp.json();
    if (!Array.isArray(tags)) throw new Error('Invalid tags payload');

    knownTags = [...new Set(tags
      .map(tag => String(tag || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
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
}

async function getServerUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl'], result => {
      resolve(result.serverUrl || DEFAULT_SERVER);
    });
  });
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
  const tab = await getCurrentTab().catch(() => null);
  const titleInput = document.getElementById('title');
  const tagsInput = document.getElementById('tags');
  wireTagSuggestions(tagsInput);

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
  document.getElementById('server-url').value = serverUrl;
  await loadKnownTags(serverUrl);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: urlToSave,
        title: customTitle || tab.title || '',
        tags,
        notes,
        is_recipe: isRecipe,
        is_music: isMusic,
        device: deviceLabel,
        saved_via: 'extension',
      }),
    });

    if (!resp.ok) throw new Error(`Server error ${resp.status}`);

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
  chrome.storage.local.set({ serverUrl: url }, () => {
    document.getElementById('status').textContent = '✓ Settings saved';
  });
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
