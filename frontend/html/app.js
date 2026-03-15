const API = '/api';
let currentEditId = null;

// ── Utilities ────────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
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

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  if (isEuropeanDateFormat) {
    const hours = String(date.getHours()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  }

  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  return `${month}/${day}/${year} ${String(hours12).padStart(2, '0')}:${minutes} ${meridiem}`;
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
    return '<div class="recipe-preview-empty">No structured recipe data found on this page.</div>';
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
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.id = page.id;

  const tags = page.tags ? page.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const tagHtml = [
    page.is_recipe ? '<span class="tag recipe-badge">🍳 recipe</span>' : '',
    page.is_music ? '<span class="tag music-badge">🎵 music</span>' : '',
    ...tags.map(t => `<span class="tag">${escHtml(t)}</span>`),
  ].join('');

  const metaTagHtml = tagHtml ? `<span class="card-meta-tags">${tagHtml}</span>` : '';
  const noteFlagHtml = hasNotes ? '<span class="card-note-flag" title="This save contains notes">📝 Notes</span>' : '';

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
        ${noteFlagHtml}
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

  card.addEventListener('click', () => openEditModal(page));
  return card;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderCards(container, pages, options = {}) {
  container.innerHTML = '';
  if (!pages.length) {
    container.innerHTML = '<p class="empty-state">No pages saved yet.</p>';
    return;
  }
  pages.forEach(p => container.appendChild(buildCard(p, options)));
  applyViewMode();
  // Masonry only needed in grid mode, and never on fixed-grid containers
  if (!isListMode && !container.classList.contains('fixed-grid')) {
    requestAnimationFrame(() => fitMasonryCards(container));
  }
}

// ── View mode (grid / list) ────────────────────────────────────────────────────────

let isLightMode = localStorage.getItem('themeMode') === 'light';
let isListMode = localStorage.getItem('viewMode') === 'list';
let isEuropeanDateFormat = localStorage.getItem('dateFormatMode') === 'eu-24h';

function refreshVisibleDates() {
  document.querySelectorAll('.card-date[data-iso]').forEach(node => {
    const iso = node.dataset.iso;
    node.textContent = `🕒 ${formatDate(iso)}`;
  });
}

function applyThemeMode() {
  document.body.classList.toggle('light-mode', isLightMode);
  const btn = document.getElementById('theme-mode-btn');
  btn.textContent = isLightMode ? '☀️ Light' : '🌙 Dark';
}

document.getElementById('theme-mode-btn').addEventListener('click', () => {
  isLightMode = !isLightMode;
  localStorage.setItem('themeMode', isLightMode ? 'light' : 'dark');
  applyThemeMode();
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
  const btn = document.getElementById('date-format-btn');
  btn.textContent = isEuropeanDateFormat ? 'DD.MM.YYYY 24h' : 'MM/DD/YYYY 12h';
  refreshVisibleDates();
}

document.getElementById('date-format-btn').addEventListener('click', () => {
  isEuropeanDateFormat = !isEuropeanDateFormat;
  localStorage.setItem('dateFormatMode', isEuropeanDateFormat ? 'eu-24h' : 'us-12h');
  applyDateFormatMode();
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
  domains: document.getElementById('view-domains'),
};

const filterBar = document.getElementById('filter-bar');
const tagSort = document.getElementById('tag-sort');

function updateFilterBarState(viewName) {
  const showFilter = viewName === 'all' || viewName === 'recipes' || viewName === 'music';
  filterBar.style.display = showFilter ? 'flex' : 'none';

  const showTagSort = viewName === 'all' || viewName === 'recipes' || viewName === 'music';
  tagSort.style.display = showTagSort ? '' : 'none';
  if (!showTagSort) tagSort.value = 'newest';

  if (viewName === 'recipes') searchInput.placeholder = 'Search recipes…';
  else if (viewName === 'music') searchInput.placeholder = 'Search music…';
  else searchInput.placeholder = 'Search pages…';
}

function getActiveViewName() {
  return document.querySelector('.nav-btn.active')?.dataset.view || 'all';
}

function reloadActiveListView() {
  const viewName = getActiveViewName();
  if (viewName === 'all') loadAll();
  if (viewName === 'recipes') loadRecipes();
  if (viewName === 'music') loadMusic();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const viewName = btn.dataset.view;
    if (!viewName || !views[viewName]) return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
    updateFilterBarState(viewName);
    if (viewName === 'all') loadAll();
    if (viewName === 'recipes') loadRecipes();
    if (viewName === 'music') loadMusic();
    if (viewName === 'domains') loadDomains();
  });
});

// ── Settings overlay ─────────────────────────────────────────────────────────────

const settingsOverlay = document.getElementById('settings-overlay');
document.getElementById('settings-btn').addEventListener('click', () => {
  settingsOverlay.classList.remove('hidden');
  loadRules();
});
document.getElementById('settings-close').addEventListener('click', () => {
  settingsOverlay.classList.add('hidden');
});
settingsOverlay.addEventListener('click', e => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});

const exportCsvBtn = document.getElementById('export-csv-btn');
const importCsvBtn = document.getElementById('import-csv-btn');
const deleteAllBtn = document.getElementById('delete-all-btn');
const importCsvInput = document.getElementById('import-csv-input');
const csvStatus = document.getElementById('csv-status');

function setCsvStatus(message) {
  csvStatus.textContent = message;
}

exportCsvBtn.addEventListener('click', async () => {
  setCsvStatus('Preparing CSV export...');
  try {
    const response = await fetch(`${API}/pages/export.csv`);
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

importCsvBtn.addEventListener('click', () => {
  importCsvInput.click();
});

importCsvInput.addEventListener('change', async () => {
  const file = importCsvInput.files?.[0];
  if (!file) return;

  setCsvStatus('Importing CSV...');
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API}/pages/import.csv`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) throw new Error(await response.text());

    const result = await response.json();
    setCsvStatus(`✓ Imported ${result.imported}, skipped ${result.skipped}`);

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
  const typed = window.prompt(
    'This will permanently delete all saved pages.\nType DELETE ALL to confirm.'
  );

  if (typed === null) return;
  if (typed.trim().toUpperCase() !== 'DELETE ALL') {
    setCsvStatus('✗ Deletion cancelled: confirmation text did not match');
    return;
  }

  setCsvStatus('Deleting all saves...');
  try {
    const response = await fetch(`${API}/pages?confirm=${encodeURIComponent('DELETE ALL')}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(await response.text());

    const result = await response.json();
    setCsvStatus(`✓ Deleted ${result.deleted} saves`);

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
const searchInput = document.getElementById('search-input');
const tagFilter = document.getElementById('tag-filter');
const addTagsInput = document.getElementById('f-tags');
const editTagsInput = document.getElementById('e-tags');
const tagSuggestionsList = document.getElementById('tag-suggestions-list');
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
  if (!inputEl || !tagSuggestionsList) return;

  const { selected, current } = splitTagInput(inputEl.value);
  const selectedLower = new Set(selected.map(tag => tag.toLowerCase()));
  const needle = current.toLowerCase();
  const prefix = selected.length ? `${selected.join(', ')}, ` : '';

  const candidates = knownTags.filter(tag => {
    if (selectedLower.has(tag.toLowerCase())) return false;
    if (!needle) return true;
    return tag.toLowerCase().includes(needle);
  });

  tagSuggestionsList.innerHTML = candidates
    .map(tag => `<option value="${escHtml(prefix + tag)}"></option>`)
    .join('');
}

function populateTagSuggestions(tags) {
  knownTags = [...tags];

  const active = document.activeElement;
  if (active === addTagsInput || active === editTagsInput) {
    updateTagSuggestionsForInput(active);
    return;
  }

  tagSuggestionsList.innerHTML = knownTags
    .map(tag => `<option value="${escHtml(tag)}"></option>`)
    .join('');
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

wireTagSuggestions(addTagsInput);
wireTagSuggestions(editTagsInput);

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

function sortPages(pages) {
  const mode = tagSort.value;
  const sorted = [...pages];

  if (mode === 'newest' || mode === 'oldest') {
    sorted.sort((a, b) => getSortableTimestamp(b) - getSortableTimestamp(a));
    return mode === 'oldest' ? sorted.reverse() : sorted;
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

async function loadAll() {
  const params = new URLSearchParams();
  if (searchInput.value) params.set('search', searchInput.value);
  if (tagFilter.value) params.set('tag', tagFilter.value);
  const pages = await apiFetch('/pages?' + params);
  renderCards(pagesGrid, sortPages(pages));
}

async function loadTagFilter() {
  const tags = await apiFetch('/tags');
  tagFilter.innerHTML = '<option value="">All tags</option>' +
    tags.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
  populateTagSuggestions(tags);
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(reloadActiveListView, 300);
});
tagFilter.addEventListener('change', reloadActiveListView);
tagSort.addEventListener('change', reloadActiveListView);

// ── Recipes ──────────────────────────────────────────────────────────────────

const recipesGrid = document.getElementById('recipes-grid');
const musicGrid = document.getElementById('music-grid');
const recipesPantryInput = document.getElementById('recipes-pantry-input');
const recipesPantryAddBtn = document.getElementById('recipes-pantry-add');
const recipesPantryClearBtn = document.getElementById('recipes-pantry-clear');
const recipesPantryList = document.getElementById('recipes-pantry-list');
const recipesMatchModeSelect = document.getElementById('recipes-match-mode');
const recipesMatchSummary = document.getElementById('recipes-match-summary');

let pantryIngredients = [];

try {
  const stored = JSON.parse(localStorage.getItem('recipesPantryIngredients') || '[]');
  if (Array.isArray(stored)) {
    pantryIngredients = stored
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }
} catch {
  pantryIngredients = [];
}

const storedRecipesMatchMode = localStorage.getItem('recipesMatchMode');
if (storedRecipesMatchMode === 'makeable' || storedRecipesMatchMode === 'near' || storedRecipesMatchMode === 'all') {
  recipesMatchModeSelect.value = storedRecipesMatchMode;
} else {
  recipesMatchModeSelect.value = 'all';
}

function savePantryState() {
  localStorage.setItem('recipesPantryIngredients', JSON.stringify(pantryIngredients));
}

function normalizeIngredientKey(value) {
  const units = /\b(g|kg|mg|ml|l|cl|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|pinch|pinches|slice|slices|can|cans|pack|packs|piece|pieces|gram|grams|liter|liters)\b/g;
  const filler = /\b(of|and|with|fresh|optional|to taste|for serving|for garnish|small|medium|large)\b/g;

  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\[\]{}]/g, ' ')
    .replace(/[0-9¼½¾⅓⅔⅛⅜⅝⅞/.,]+/g, ' ')
    .replace(units, ' ')
    .replace(filler, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function getRecipeMatchInfo(page, pantryKeys) {
  const ingredientKeys = Array.from(new Set(
    recipeLines(page.recipe_ingredients).map(normalizeIngredientKey).filter(Boolean)
  ));

  if (!ingredientKeys.length) {
    return { canEvaluate: false, missingCount: Infinity };
  }

  const missingCount = ingredientKeys.filter(key => !ingredientMatchesPantry(key, pantryKeys)).length;
  return { canEvaluate: true, missingCount };
}

function applyRecipesPantryFilter(recipes) {
  const mode = recipesMatchModeSelect.value;
  const pantryKeys = Array.from(new Set(pantryIngredients.map(normalizeIngredientKey).filter(Boolean)));

  if (!pantryKeys.length || mode === 'all') {
    return {
      recipes,
      summary: pantryIngredients.length
        ? `Pantry loaded: ${pantryIngredients.length} ingredient${pantryIngredients.length === 1 ? '' : 's'} (filter: all recipes)`
        : '',
    };
  }

  let skippedNoIngredients = 0;
  const filtered = recipes.filter(page => {
    const info = getRecipeMatchInfo(page, pantryKeys);
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
    recipes: filtered,
    summary: `Showing ${filtered.length} of ${recipes.length} recipes ${modeText}${skipText}`,
  };
}

function renderPantryIngredients() {
  recipesPantryList.innerHTML = '';
  pantryIngredients.forEach((ingredient, index) => {
    const chip = document.createElement('span');
    chip.className = 'recipes-pantry-chip';
    chip.innerHTML = `${escHtml(ingredient)} <button type="button" data-index="${index}" aria-label="Remove ingredient">×</button>`;
    recipesPantryList.appendChild(chip);
  });
}

function applyRecipesSummary(text) {
  recipesMatchSummary.textContent = text || '';
}

function addPantryIngredients(rawValue) {
  const additions = parseTagList(rawValue);
  if (!additions.length) return false;

  const existingLower = new Set(pantryIngredients.map(item => item.toLowerCase()));
  let changed = false;
  additions.forEach(item => {
    const clean = item.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!existingLower.has(key)) {
      pantryIngredients.push(clean);
      existingLower.add(key);
      changed = true;
    }
  });

  if (changed) {
    savePantryState();
    renderPantryIngredients();
  }
  return changed;
}

recipesPantryAddBtn.addEventListener('click', () => {
  const changed = addPantryIngredients(recipesPantryInput.value);
  recipesPantryInput.value = '';
  recipesPantryInput.focus();
  if (changed && getActiveViewName() === 'recipes') loadRecipes();
});

recipesPantryInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  recipesPantryAddBtn.click();
});

recipesPantryClearBtn.addEventListener('click', () => {
  pantryIngredients = [];
  savePantryState();
  renderPantryIngredients();
  if (getActiveViewName() === 'recipes') loadRecipes();
});

recipesPantryList.addEventListener('click', e => {
  const removeBtn = e.target.closest('button[data-index]');
  if (!removeBtn) return;

  const idx = Number(removeBtn.dataset.index);
  if (!Number.isFinite(idx) || idx < 0 || idx >= pantryIngredients.length) return;
  pantryIngredients.splice(idx, 1);
  savePantryState();
  renderPantryIngredients();
  if (getActiveViewName() === 'recipes') loadRecipes();
});

recipesMatchModeSelect.addEventListener('change', () => {
  localStorage.setItem('recipesMatchMode', recipesMatchModeSelect.value);
  if (getActiveViewName() === 'recipes') loadRecipes();
});

renderPantryIngredients();

async function loadRecipes() {
  const params = new URLSearchParams();
  params.set('is_recipe', 'true');
  if (searchInput.value) params.set('search', searchInput.value);
  if (tagFilter.value) params.set('tag', tagFilter.value);
  const pages = await apiFetch('/pages?' + params);
  const sorted = sortPages(pages);
  const { recipes, summary } = applyRecipesPantryFilter(sorted);
  applyRecipesSummary(summary);
  renderCards(recipesGrid, recipes, { showRecipeDetails: true });
}

async function loadMusic() {
  const params = new URLSearchParams();
  params.set('is_music', 'true');
  if (searchInput.value) params.set('search', searchInput.value);
  if (tagFilter.value) params.set('tag', tagFilter.value);
  const pages = await apiFetch('/pages?' + params);
  renderCards(musicGrid, sortPages(pages));
}

// ── Domains ──────────────────────────────────────────────────────────────────

const domainList = document.getElementById('domain-list');
const domainPages = document.getElementById('domain-pages');

async function loadDomains() {
  const domains = await apiFetch('/domains');
  domainList.innerHTML = domains.map(d =>
    `<button class="domain-chip" data-domain="${escHtml(d)}">${escHtml(d)}</button>`
  ).join('');
  domainPages.innerHTML = '';

  domainList.querySelectorAll('.domain-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      domainList.querySelectorAll('.domain-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const pages = await apiFetch('/pages?domain=' + encodeURIComponent(chip.dataset.domain));
      renderCards(domainPages, pages);
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
    await apiFetch('/pages', {
      method: 'POST',
      body: JSON.stringify({
        url: urlToSave,
        title: document.getElementById('f-title').value,
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
    loadTagFilter();
    setTimeout(() => { addOverlay.classList.add('hidden'); addStatus.textContent = ''; }, 1200);
  } catch (err) {
    addStatus.textContent = '✗ Error: ' + err.message;
  }
});

// ── Edit Modal ───────────────────────────────────────────────────────────────

const overlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const editForm = document.getElementById('edit-form');

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
  loadAll();
  loadTagFilter();
});

document.getElementById('modal-delete').addEventListener('click', async () => {
  if (!confirm('Delete this page?')) return;
  await apiFetch(`/pages/${currentEditId}`, { method: 'DELETE' });
  overlay.classList.add('hidden');
  loadAll();
  loadTagFilter();
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
applyThemeMode();
applyViewMode();
applyDateFormatMode();
updateFilterBarState(getActiveViewName());
loadAll();
loadTagFilter();
