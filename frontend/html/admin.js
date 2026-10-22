const API = '/api';

const THEME_MODES = ['light', 'dark', 'oled'];
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

function normalizeTheme(mode) {
  return THEME_MODES.includes(mode) ? mode : 'dark';
}

function getStoredTheme() {
  return normalizeTheme(localStorage.getItem('themeMode') || localStorage.getItem('theme-mode') || 'dark');
}

function syncThemeControls(mode) {
  const index = mode === 'light' ? 0 : mode === 'dark' ? 1 : 2;

  document.querySelectorAll('.theme-slider').forEach(control => {
    control.style.setProperty('--theme-slider-index', String(index));
    control.querySelectorAll('.theme-slider-option').forEach(option => {
      const isActive = option.dataset.themeValue === mode;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-selected', isActive ? 'true' : 'false');
      option.tabIndex = isActive ? 0 : -1;
    });
  });
}

function applyTheme(mode) {
  const nextMode = normalizeTheme(mode);
  document.documentElement.setAttribute('data-theme', nextMode);
  document.body.classList.toggle('light-mode', nextMode === 'light');
  document.body.classList.toggle('oled-mode', nextMode === 'oled');
  syncThemeControls(nextMode);
  localStorage.setItem('theme-mode', nextMode);
  localStorage.setItem('themeMode', nextMode);
}

function setThemeMode(mode) {
  applyTheme(normalizeTheme(mode));
}

(function initThemeControls() {
  setThemeMode(getStoredTheme());

  document.querySelectorAll('.theme-slider').forEach(control => {
    control.addEventListener('click', e => {
      const btn = e.target.closest('.theme-slider-option');
      if (!btn) return;
      setThemeMode(btn.dataset.themeValue || 'dark');
    });

    control.addEventListener('keydown', e => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement) || !target.classList.contains('theme-slider-option')) return;

      const currentMode = getStoredTheme();
      const currentIndex = THEME_MODES.indexOf(currentMode);
      if (currentIndex < 0) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextMode = THEME_MODES[Math.min(THEME_MODES.length - 1, currentIndex + 1)];
        setThemeMode(nextMode);
        control.querySelector(`[data-theme-value="${nextMode}"]`)?.focus();
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nextMode = THEME_MODES[Math.max(0, currentIndex - 1)];
        setThemeMode(nextMode);
        control.querySelector(`[data-theme-value="${nextMode}"]`)?.focus();
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        setThemeMode(THEME_MODES[0]);
        control.querySelector('[data-theme-value="light"]')?.focus();
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        setThemeMode(THEME_MODES[THEME_MODES.length - 1]);
        control.querySelector('[data-theme-value="oled"]')?.focus();
      }
    });
  });
})();

let authToken = localStorage.getItem('authToken') || '';
let authUsername = localStorage.getItem('authUsername') || '';
let usersCache = [];
let analyticsCache = null;
const expandedUsers = new Set();
let dateFormatPattern = normalizeDateFormatPattern(
  localStorage.getItem('dateFormatPattern')
  || LEGACY_DATE_FORMAT_PATTERNS[localStorage.getItem('dateFormatMode') || '']
  || DEFAULT_DATE_FORMAT_PATTERN
);

const usersGrid = document.getElementById('users-grid');
const usersLoadStatus = document.getElementById('users-load-status');
const analyticsSummary = document.getElementById('analytics-summary');
const analyticsTrends = document.getElementById('analytics-trends');
const analyticsTopUsers = document.getElementById('analytics-top-users');
const analyticsTopDomains = document.getElementById('analytics-top-domains');
const analyticsUserSpecific = document.getElementById('analytics-user-specific');
const analyticsLoadStatus = document.getElementById('analytics-load-status');
const analyticsGeneratedAt = document.getElementById('analytics-generated-at');
const analyticsRefreshBtn = document.getElementById('analytics-refresh-btn');
const analyticsTimespanSelect = document.getElementById('analytics-timespan-select');
const analyticsTrendsRange = document.getElementById('analytics-trends-range');
const analyticsUserSelect = document.getElementById('analytics-user-select');
const analyticsUserTimespanSelect = document.getElementById('analytics-user-timespan-select');
const adminStatus = document.getElementById('admin-status');
const accountLabel = document.getElementById('admin-account-label');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsBtn = document.getElementById('admin-settings-btn');
const settingsCloseBtn = document.getElementById('settings-close');
const adminLoginBtn = document.getElementById('admin-login-btn');
const togglePasswordFormBtn = document.getElementById('admin-toggle-password-form-btn');
const changePasswordForm = document.getElementById('admin-change-password-form');
const changePasswordBtn = document.getElementById('admin-change-password-btn');
const currentPasswordInput = document.getElementById('admin-current-password-input');
const newPasswordInput = document.getElementById('admin-new-password-input');
const confirmNewPasswordInput = document.getElementById('admin-confirm-new-password-input');
const passwordChangeStatus = document.getElementById('admin-password-change-status');
const dateFormatPreset = document.getElementById('date-format-preset');
const dateFormatInput = document.getElementById('date-format-input');
const dateFormatResetBtn = document.getElementById('date-format-reset-btn');
const dateFormatHelpBtn = document.getElementById('date-format-help-btn');
const dateFormatHelpOverlay = document.getElementById('date-format-help-overlay');
const dateFormatHelpCloseBtn = document.getElementById('date-format-help-close');
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmInputRow = document.getElementById('confirm-input-row');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmOk = document.getElementById('confirm-ok');
const confirmClose = document.getElementById('confirm-close');
const confirmModal = confirmOverlay?.querySelector('.confirm-modal');

const views = {
  users: document.getElementById('view-users'),
  analytics: document.getElementById('view-analytics'),
};

const adminViewController = window.ProjectPocketAdminTabs.createAdminViewController({
  views,
  storageKey: 'projectPocket.adminView',
  defaultView: 'users',
  getViewButtons: () => document.querySelectorAll('.nav-btn[data-view]'),
  loadUsers,
  loadAnalytics,
});

function setAdminStatus(message) {
  if (adminStatus) adminStatus.textContent = message || '';
}

function setUsersStatus(message) {
  if (usersLoadStatus) usersLoadStatus.textContent = message || '';
}

function setAnalyticsStatus(message) {
  if (analyticsLoadStatus) analyticsLoadStatus.textContent = message || '';
}

function updateAccountNameLabel() {
  if (!accountLabel) return;
  accountLabel.textContent = authUsername
    ? `Signed in as: ${authUsername} (Admin)`
    : 'Signed in as: -';
}

function setPasswordChangeStatus(message) {
  if (passwordChangeStatus) passwordChangeStatus.textContent = message || '';
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

function closeSettingsOverlay() {
  closeDateFormatHelpOverlay();
  setPasswordFormVisible(false);
  settingsOverlay?.classList.add('hidden');
}

function openSettingsOverlay() {
  updateAccountNameLabel();
  applyDateFormatMode();
  setPasswordFormVisible(false);
  settingsOverlay?.classList.remove('hidden');
}

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

function normalizeUsername(rawValue) {
  return String(rawValue || '').trim().toLowerCase();
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString();
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

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return formatDateWithPattern(date, dateFormatPattern);
}

function closeAdminConfirmOverlay() {
  if (!confirmOverlay) return;
  confirmOverlay.classList.add('hidden');
}

function showAdminDialog({
  title = 'Confirm',
  message = '',
  messageHtml = '',
  okText = 'OK',
  cancelText = 'Cancel',
  danger = false,
  showCancel = true,
} = {}) {
  if (!confirmOverlay || !confirmTitle || !confirmMessage || !confirmOk || !confirmCancel || !confirmClose) {
    return Promise.resolve(false);
  }

  return new Promise(resolve => {
    confirmTitle.textContent = String(title || 'Confirm');
    confirmMessage.innerHTML = messageHtml || escHtml(String(message || ''));
    if (confirmInputRow) confirmInputRow.style.display = 'none';
    confirmModal?.classList.add('confirm-modal--compact');

    confirmOk.textContent = String(okText || 'OK');
    confirmCancel.textContent = String(cancelText || 'Cancel');
    confirmCancel.hidden = !showCancel;

    confirmOk.classList.remove('btn-danger', 'btn-primary', 'btn');
    if (danger) {
      confirmOk.classList.add('btn-danger');
    } else if (!showCancel) {
      // For info-only dialogs with a single Close action, match the neutral cancel style.
      confirmOk.classList.add('btn');
    } else {
      confirmOk.classList.add('btn-primary');
    }

    confirmOverlay.classList.remove('hidden');

    function cleanup(result) {
      closeAdminConfirmOverlay();
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      confirmClose.removeEventListener('click', onCancel);
      confirmOverlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeyDown);
      confirmCancel.hidden = false;
      resolve(result);
    }

    function onOk() {
      cleanup(true);
    }

    function onCancel() {
      cleanup(false);
    }

    function onOverlayClick(event) {
      if (event.target === confirmOverlay) cleanup(false);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') cleanup(false);
    }

    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    confirmClose.addEventListener('click', onCancel);
    confirmOverlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeyDown);
  });
}

function renderAnalyticsTrendGraph(labels, savesTrendRaw, signupsTrendRaw, shareRequestsRaw = [], shareAcceptedRaw = [], shareDeclinedRaw = [], options = {}) {
  const opts = options || {};
  const hideSignups = Boolean(opts.hideSignups);
  const width = Number(opts.width || 760);
  const height = Number(opts.height || 300);
  const margin = opts.margin || { top: 18, right: 16, bottom: 52, left: 44 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const savesTrend = labels.map((_, index) => Math.max(0, Number(savesTrendRaw[index] || 0)));
  const signupsTrend = labels.map((_, index) => Math.max(0, Number(signupsTrendRaw[index] || 0)));
  const shareRequestsTrend = labels.map((_, index) => Math.max(0, Number((shareRequestsRaw || [])[index] || 0)));
  const shareAcceptedTrend = labels.map((_, index) => Math.max(0, Number((shareAcceptedRaw || [])[index] || 0)));
  const shareDeclinedTrend = labels.map((_, index) => Math.max(0, Number((shareDeclinedRaw || [])[index] || 0)));
  const yMax = Math.max(1, ...savesTrend, ...(hideSignups ? [] : signupsTrend), ...shareRequestsTrend, ...shareAcceptedTrend, ...shareDeclinedTrend);

  const xForIndex = index => {
    if (labels.length <= 1) return margin.left + (chartWidth / 2);
    return margin.left + (index / (labels.length - 1)) * chartWidth;
  };

  const yForValue = value => margin.top + chartHeight - (Math.max(0, value) / yMax) * chartHeight;

  const toPointString = values => values
    .map((value, index) => `${xForIndex(index).toFixed(2)},${yForValue(value).toFixed(2)}`)
    .join(' ');

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, idx) => {
    const ratio = idx / yTickCount;
    const value = Math.round(yMax * (1 - ratio));
    const y = margin.top + chartHeight * ratio;
    return { value, y };
  });

  const xTickStep = Math.max(1, Math.ceil(labels.length / 7));
  const xTickIndices = labels
    .map((_, index) => index)
    .filter(index => index === labels.length - 1 || index % xTickStep === 0);

  const gridLines = yTicks.map(tick => [
    `<line class="analytics-chart-grid-line" x1="${margin.left}" y1="${tick.y.toFixed(2)}" x2="${(margin.left + chartWidth).toFixed(2)}" y2="${tick.y.toFixed(2)}"></line>`,
    `<text class="analytics-chart-axis-label" x="${(margin.left - 8).toFixed(2)}" y="${(tick.y + 4).toFixed(2)}" text-anchor="end">${formatCount(tick.value)}</text>`,
  ].join('')).join('');

  const xLabels = xTickIndices.map(index => [
    `<line class="analytics-chart-axis-tick" x1="${xForIndex(index).toFixed(2)}" y1="${(margin.top + chartHeight).toFixed(2)}" x2="${xForIndex(index).toFixed(2)}" y2="${(margin.top + chartHeight + 5).toFixed(2)}"></line>`,
    `<text class="analytics-chart-axis-label" x="${xForIndex(index).toFixed(2)}" y="${(height - 18).toFixed(2)}" text-anchor="middle">${escHtml(labels[index])}</text>`,
  ].join('')).join('');

  const savesPoints = toPointString(savesTrend);
  const signupsPoints = toPointString(signupsTrend);
  const shareRequestsPoints = toPointString(shareRequestsTrend);
  const shareAcceptedPoints = toPointString(shareAcceptedTrend);
  const shareDeclinedPoints = toPointString(shareDeclinedTrend);

  const savesDots = savesTrend.map((value, index) => {
    const isZero = !value;
    const r = isZero ? 2 : 3;
    const zeroClass = isZero ? ' analytics-chart-dot--zero' : '';
    return `<circle class="analytics-chart-dot analytics-chart-dot--saves${zeroClass}" cx="${xForIndex(index).toFixed(2)}" cy="${yForValue(value).toFixed(2)}" r="${r}" data-index="${index}" data-series="Saves" data-label="${escHtml(labels[index] || '')}" data-value="${value}"></circle>`;
  }).join('');

  const signupsDots = signupsTrend.map((value, index) => {
    const isZero = !value;
    const r = isZero ? 2 : 3;
    const zeroClass = isZero ? ' analytics-chart-dot--zero' : '';
    return `<circle class="analytics-chart-dot analytics-chart-dot--signups${zeroClass}" cx="${xForIndex(index).toFixed(2)}" cy="${yForValue(value).toFixed(2)}" r="${r}" data-index="${index}" data-series="Signups" data-label="${escHtml(labels[index] || '')}" data-value="${value}"></circle>`;
  }).join('');

  const shareRequestsDots = shareRequestsTrend.map((value, index) => {
    const isZero = !value;
    const r = isZero ? 2 : 3;
    const zeroClass = isZero ? ' analytics-chart-dot--zero' : '';
    return `<circle class="analytics-chart-dot analytics-chart-dot--requests${zeroClass}" cx="${xForIndex(index).toFixed(2)}" cy="${yForValue(value).toFixed(2)}" r="${r}" data-index="${index}" data-series="Share Requests" data-label="${escHtml(labels[index] || '')}" data-value="${value}"></circle>`;
  }).join('');

  const shareAcceptedDots = shareAcceptedTrend.map((value, index) => {
    const isZero = !value;
    const r = isZero ? 2 : 3;
    const zeroClass = isZero ? ' analytics-chart-dot--zero' : '';
    return `<circle class="analytics-chart-dot analytics-chart-dot--accepts${zeroClass}" cx="${xForIndex(index).toFixed(2)}" cy="${yForValue(value).toFixed(2)}" r="${r}" data-index="${index}" data-series="Share Accepts" data-label="${escHtml(labels[index] || '')}" data-value="${value}"></circle>`;
  }).join('');

  const shareDeclinedDots = shareDeclinedTrend.map((value, index) => {
    const isZero = !value;
    const r = isZero ? 2 : 3;
    const zeroClass = isZero ? ' analytics-chart-dot--zero' : '';
    return `<circle class="analytics-chart-dot analytics-chart-dot--declines${zeroClass}" cx="${xForIndex(index).toFixed(2)}" cy="${yForValue(value).toFixed(2)}" r="${r}" data-index="${index}" data-series="Share Declines" data-label="${escHtml(labels[index] || '')}" data-value="${value}"></circle>`;
  }).join('');

  const legendParts = ['<div class="analytics-chart-legend">', '  <span class="analytics-chart-legend-item"><span class="analytics-chart-legend-swatch analytics-chart-legend-swatch--saves"></span>Saves</span>'];
  if (!hideSignups) legendParts.push('  <span class="analytics-chart-legend-item"><span class="analytics-chart-legend-swatch analytics-chart-legend-swatch--signups"></span>Signups</span>');
  legendParts.push('  <span class="analytics-chart-legend-item"><span class="analytics-chart-legend-swatch analytics-chart-legend-swatch--requests"></span>Share Requests</span>');
  legendParts.push('  <span class="analytics-chart-legend-item"><span class="analytics-chart-legend-swatch analytics-chart-legend-swatch--accepts"></span>Share Accepts</span>');
  legendParts.push('  <span class="analytics-chart-legend-item"><span class="analytics-chart-legend-swatch analytics-chart-legend-swatch--declines"></span>Share Declines</span>');
  legendParts.push('</div>');

  const svgParts = ['<div class="analytics-chart-wrap">', `  <svg class="analytics-chart-svg" viewBox="0 0 ${width} ${height}" data-labels='${escHtml(JSON.stringify(labels))}' role="img" aria-label="Usage trends chart for saves, signups, and shares">`, `    ${gridLines}`, `    <line class="analytics-chart-axis" x1="${margin.left}" y1="${(margin.top + chartHeight).toFixed(2)}" x2="${(margin.left + chartWidth).toFixed(2)}" y2="${(margin.top + chartHeight).toFixed(2)}"></line>`, `    <polyline class="analytics-chart-line analytics-chart-line--saves" points="${savesPoints}" data-values='${escHtml(JSON.stringify(savesTrend))}' fill="none"></polyline>`];
  if (!hideSignups) svgParts.push(`    <polyline class="analytics-chart-line analytics-chart-line--signups" points="${signupsPoints}" data-values='${escHtml(JSON.stringify(signupsTrend))}' fill="none"></polyline>`);
  svgParts.push(`    <polyline class="analytics-chart-line analytics-chart-line--requests" points="${shareRequestsPoints}" data-values='${escHtml(JSON.stringify(shareRequestsTrend))}' fill="none"></polyline>`);
  svgParts.push(`    <polyline class="analytics-chart-line analytics-chart-line--accepts" points="${shareAcceptedPoints}" data-values='${escHtml(JSON.stringify(shareAcceptedTrend))}' fill="none"></polyline>`);
  svgParts.push(`    <polyline class="analytics-chart-line analytics-chart-line--declines" points="${shareDeclinedPoints}" data-values='${escHtml(JSON.stringify(shareDeclinedTrend))}' fill="none"></polyline>`);
  svgParts.push(`    ${savesDots}`);
  if (!hideSignups) svgParts.push(`    ${signupsDots}`);
  svgParts.push(`    ${shareRequestsDots}`);
  svgParts.push(`    ${shareAcceptedDots}`);
  svgParts.push(`    ${shareDeclinedDots}`);
  svgParts.push(`    ${xLabels}`);
  svgParts.push('  </svg>');
  svgParts.push('</div>');

  return `${legendParts.join('')} ${svgParts.join('')}`;
}

function renderTopDomainsList(domains) {
  if (!Array.isArray(domains) || !domains.length) {
    return '<p class="settings-hint">No domain data available yet.</p>';
  }
  const values = domains.map(d => Math.max(0, Number(d.save_count || 0)));
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    return '<p class="settings-hint">No domain data available yet.</p>';
  }
  // Group small slices into "Other" (cutoff: 1%) and build pie/legend
  const entries = domains.map(d => ({ domain: String(d.domain || d.name || ''), value: Math.max(0, Number(d.save_count || 0)) })).filter(e => e.value > 0);
  const cutoff = total * 0.01; // 1% cutoff
  const major = [];
  let otherCount = 0;
  for (const e of entries) {
    if (e.value >= cutoff) major.push(e);
    else otherCount += e.value;
  }
  if (otherCount > 0) major.push({ domain: 'Other', value: otherCount });
  major.sort((a, b) => b.value - a.value);

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = Math.floor(size / 2) - 6;
  let startAngle = -Math.PI / 2; // start at 12 o'clock
  const TAU = Math.PI * 2;

  const palette = major.map((_, i) => `hsl(${Math.round((i * 360) / Math.max(1, major.length))}, 70%, 55%)`);
  const slices = [];
  const legendItems = [];

  major.forEach((entry, idx) => {
    const value = Math.max(0, Number(entry.value || 0));
    if (value <= 0) return;
    const angle = (value / total) * TAU;
    const endAngle = startAngle + angle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const mid = startAngle + angle / 2;
    const color = palette[idx] || '#777';
    const label = entry.domain || '';

    if (Math.abs(angle - TAU) < 1e-6) {
      // full circle
      slices.push(`<circle class="analytics-pie-slice" cx="${cx}" cy="${cy}" r="${r}" fill="${color}" data-mid="${mid}" data-value="${value}" data-domain="${escHtml(label)}"></circle>`);
    } else {
      const startX = cx + r * Math.cos(startAngle);
      const startY = cy + r * Math.sin(startAngle);
      const endX = cx + r * Math.cos(endAngle);
      const endY = cy + r * Math.sin(endAngle);
      const d = `M ${cx} ${cy} L ${startX.toFixed(2)} ${startY.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)} Z`;
      slices.push(`<path class="analytics-pie-slice" d="${d}" fill="${color}" data-mid="${mid}" data-value="${value}" data-domain="${escHtml(label)}"></path>`);
    }

    legendItems.push([
      `<div class="analytics-pie-legend-item">`,
      `  <span class="analytics-pie-swatch" style="background:${color}"></span>`,
      `  <span class="analytics-pie-legend-label">${escHtml(label)}</span>`,
      `  <span class="analytics-pie-legend-count">${formatCount(value)}</span>`,
      `</div>`,
    ].join(''));

    startAngle = endAngle;
  });

  const svg = `<svg class="analytics-pie-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Top saved domains pie chart">${slices.join('')}</svg>`;
  const legend = `<div class="analytics-pie-legend">${legendItems.join('')}</div>`;
  return `<div class="analytics-domains-pie-wrap">${svg}${legend}</div>`;
}

// Render the user-specific analytics panel (totals, small trend, top domains & tags)
function renderUserSpecific(data) {
  if (!analyticsUserSpecific) return;
  if (!data || !data.username) {
    analyticsUserSpecific.innerHTML = '<p class="settings-hint">No user selected.</p>';
    return;
  }

  if (data.exists === false) {
    analyticsUserSpecific.innerHTML = `<p class="settings-hint">User not found: ${escHtml(data.username)}</p>`;
    return;
  }

  const saves = data.saves || {};
  const trends = data.trends || {};
  const topDomains = Array.isArray(data.top_domains) ? data.top_domains : [];

  const html = [
    '<div class="user-specific-grid">',
    '  <div class="user-summary">',
    `    <h4>${escHtml(data.username)}</h4>`,
    '    <div class="user-stats">',
    `      <div class="user-stat"><p class="analytics-card-label">Total saves</p><p class="analytics-card-value">${formatCount(saves.total)}</p></div>`,
    `      <div class="user-stat"><p class="analytics-card-label">Last 7 days</p><p class="analytics-card-value">${formatCount(saves.created_last_7d || 0)}</p></div>`,
    `      <div class="user-stat"><p class="analytics-card-label">Last 30 days</p><p class="analytics-card-value">${formatCount(saves.created_last_30d || 0)}</p></div>`,
    `      <div class="user-stat"><p class="analytics-card-label">Last save</p><p class="analytics-card-value">${escHtml(formatDateTime(data.last_save_at))}</p></div>`,
    `      <div class="user-stat"><p class="analytics-card-label">Last session</p><p class="analytics-card-value">${escHtml(formatDateTime(data.last_session_at))}</p></div>`,
    '    </div>',
    '  </div>',
    '  <div class="user-domains">',
    '    <h4>Top Domains</h4>',
    renderTopDomainsList(topDomains),
    '  </div>',
    '</div>',
    '<div class="user-bottom-grid">',
    '  <div class="user-trend user-trend--large">',
    '    <h4>Activity</h4>',
    // Render larger trend for the user-specific panel and hide signups.
    renderAnalyticsTrendGraph(trends.labels || [], trends.saves || [], [], [], [], [], { hideSignups: true, width: 920, height: 380 }),
    '  </div>',
    '</div>',
  ].join('');

  analyticsUserSpecific.innerHTML = html;

  // Attach interactions for the pie chart and the trend we just inserted.
  try { attachPieInteractions(analyticsUserSpecific, topDomains); } catch (e) { /* ignore */ }
  try { attachTrendInteractions(analyticsUserSpecific); } catch (e) { /* ignore */ }

  try { scheduleRelayout(60); } catch (e) { /* ignore */ }
}

async function loadUserSpecific(username) {
  if (!analyticsUserSpecific) return;
  if (!username) {
    analyticsUserSpecific.innerHTML = '<p class="settings-hint">No user selected.</p>';
    return;
  }

  setAnalyticsStatus(`Loading analytics for ${username}...`);
  try {
    const span = analyticsUserTimespanSelect ? (analyticsUserTimespanSelect.value || '14d') : (analyticsTimespanSelect ? (analyticsTimespanSelect.value || '14d') : '14d');
    const data = await apiFetch(`/admin/user-analytics?username=${encodeURIComponent(username)}&span=${encodeURIComponent(span)}`);
    analyticsCache = analyticsCache || {};
    analyticsCache.userSpecific = analyticsCache.userSpecific || {};
    analyticsCache.userSpecific[username] = data;
    renderUserSpecific(data);
    if (analyticsUserSelect) analyticsUserSelect.value = username;
    setAnalyticsStatus('');
  } catch (err) {
    setAnalyticsStatus(`Failed to load user analytics: ${err.message}`);
  }
}

function attachPieInteractions(container, domains) {
  if (!container) return;
  const svg = container.querySelector('.analytics-pie-svg');
  if (!svg) return;

  // Create tooltip element (append to body so it's not clipped by container overflow)
  const tooltipFor = container.id || '';
  let tooltip = document.querySelector(`.analytics-pie-tooltip[data-for="${tooltipFor}"]`);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'analytics-pie-tooltip';
    tooltip.setAttribute('data-for', tooltipFor);
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }

  const total = domains.reduce((s, d) => s + Math.max(0, Number(d.save_count || 0)), 0);
  const paths = svg.querySelectorAll('path.analytics-pie-slice, circle.analytics-pie-slice');

  paths.forEach(path => {
    path.style.transition = 'transform 0.18s ease, filter 0.18s ease';
    path.style.transformBox = 'fill-box';
    path.style.transformOrigin = 'center';
    path.style.cursor = 'pointer';

    function onEnter(e) {
      const mid = Number(path.dataset.mid || 0);
      const value = Number(path.dataset.value || 0);
      const offset = 8; // svg units
      const dx = Math.cos(mid) * offset;
      const dy = Math.sin(mid) * offset;
      // Use CSS transform to avoid changing SVG transform attribute which can
      // cause pointer event reflow and jitter. transformBox is set to fill-box.
      path.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(1.06)`;
      path.style.filter = 'drop-shadow(0 6px 12px rgba(0,0,0,0.25))';

      const pct = total ? (value / total * 100) : 0;
      tooltip.innerHTML = `<strong>${escHtml(path.dataset.domain)}</strong><div>${formatCount(value)} saves • ${pct.toFixed(1)}%</div>`;
      tooltip.style.display = 'block';

      // Position tooltip near pointer using viewport coordinates and clamp to viewport
      const margin = 8;
      const preferLeft = e.clientX + 12;
      const preferTop = e.clientY + 12;
      // measure after making visible
      const tRect = tooltip.getBoundingClientRect();
      let left = preferLeft;
      let top = preferTop;
      if (left + tRect.width + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - tRect.width - margin);
      if (top + tRect.height + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - tRect.height - margin);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function onMove(e) {
      const margin = 8;
      const preferLeft = e.clientX + 12;
      const preferTop = e.clientY + 12;
      const tRect = tooltip.getBoundingClientRect();
      let left = preferLeft;
      let top = preferTop;
      if (left + tRect.width + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - tRect.width - margin);
      if (top + tRect.height + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - tRect.height - margin);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function onLeave() {
      path.style.transform = '';
      path.style.filter = '';
      tooltip.style.display = 'none';
    }

    path.addEventListener('pointerenter', onEnter);
    path.addEventListener('pointermove', onMove);
    path.addEventListener('pointerleave', onLeave);
    path.addEventListener('pointercancel', onLeave);
  });
}

// Attach hover tooltip interactions to trend chart points.
function attachTrendInteractions(container) {
  if (!container) return;
  const svg = container.querySelector('.analytics-chart-svg');
  if (!svg) return;

  const tooltipFor = container.id || '';
  let tooltip = document.querySelector(`.analytics-pie-tooltip[data-for="${tooltipFor}"]`);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'analytics-pie-tooltip';
    tooltip.setAttribute('data-for', tooltipFor);
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }

  // Determine day x positions from the primary polyline's points so we
  // have one x coordinate per label/index even if no circle was drawn.
  // read labels embedded on the svg (if present)
  let labelsArrLocal = [];
  try { labelsArrLocal = JSON.parse(svg.getAttribute('data-labels') || '[]'); } catch (e) { labelsArrLocal = []; }

  const primaryLine = svg.querySelector('.analytics-chart-line--saves') || svg.querySelector('.analytics-chart-line--signups') || svg.querySelector('.analytics-chart-line');
  const pts = Array.from(svg.querySelectorAll('circle.analytics-chart-dot'));

  const idxXs = [];
  if (primaryLine && primaryLine.getAttribute) {
    const ptsAttr = primaryLine.getAttribute('points') || '';
    const tokens = ptsAttr.trim().split(/\s+/).filter(Boolean);
    tokens.forEach(tok => {
      const parts = String(tok).split(',');
      const x = Number(parts[0] || 0);
      idxXs.push(isFinite(x) ? x : 0);
    });
  }

  // build index map for every day/index (use idxXs length if available, otherwise derive from points present)
  const idxCount = idxXs.length || (pts.length ? Math.max(...pts.map(p => Number(p.dataset.index || p.getAttribute('data-index') || 0))) + 1 : 0);
  const idxMap = new Map();
  for (let i = 0; i < idxCount; i++) idxMap.set(i, { cx: idxXs[i] != null ? idxXs[i] : null, pts: [] });
  // attach any visible circles to their index entry
  pts.forEach(pt => {
    const idx = Number(pt.dataset.index || pt.getAttribute('data-index') || 0);
    if (!idxMap.has(idx)) idxMap.set(idx, { cx: Number(pt.getAttribute('cx') || 0), pts: [] });
    idxMap.get(idx).pts.push(pt);
    // ensure cx is populated when missing
    if (idxMap.get(idx).cx == null) {
      const cxAttr = pt.getAttribute('cx');
      idxMap.get(idx).cx = cxAttr ? Number(cxAttr) : null;
    }
  });

  const sortedIdx = Array.from(idxMap.keys()).sort((a, b) => a - b);

  // vertical guide line inside SVG (limit to chart area using grid/axis lines)
  const ns = 'http://www.w3.org/2000/svg';
  let vline = svg.querySelector('.analytics-chart-vline');
  const vb = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null;
  const svgHeight = (vb && vb.height) ? vb.height : svg.getBoundingClientRect().height || 300;
  // determine top/bottom of chart area from grid lines / axis
  let topY = 0;
  let bottomY = svgHeight;
  try {
    const gridLines = Array.from(svg.querySelectorAll('line.analytics-chart-grid-line'))
      .map(l => Number(l.getAttribute('y1') || l.getAttribute('y2') || 0)).filter(v => isFinite(v));
    if (gridLines.length) topY = Math.min(...gridLines);
    const axis = svg.querySelector('line.analytics-chart-axis');
    if (axis) bottomY = Number(axis.getAttribute('y1') || axis.getAttribute('y2') || bottomY);
  } catch (e) {}

  if (!vline) {
    vline = document.createElementNS(ns, 'line');
    vline.classList.add('analytics-chart-vline');
    vline.setAttribute('y1', String(topY));
    vline.setAttribute('y2', String(bottomY));
    vline.setAttribute('x1', '0');
    vline.setAttribute('x2', '0');
    vline.style.display = 'none';
    svg.appendChild(vline);
  } else {
    try { vline.setAttribute('y1', String(topY)); vline.setAttribute('y2', String(bottomY)); } catch (e) {}
  }

  const seriesDefs = [
    { name: 'Saves', cls: '.analytics-chart-line--saves' },
    { name: 'Signups', cls: '.analytics-chart-line--signups' },
    { name: 'Share Requests', cls: '.analytics-chart-line--requests' },
    { name: 'Share Accepts', cls: '.analytics-chart-line--accepts' },
    { name: 'Share Declines', cls: '.analytics-chart-line--declines' },
  ];
  let seriesMeta = seriesDefs.map(def => {
    const line = svg.querySelector(def.cls);
    let values = [];
    try { values = JSON.parse(line?.getAttribute('data-values') || '[]'); } catch (e) { values = []; }
    let color = '#999';
    try { color = (line ? (window.getComputedStyle(line).stroke || line.getAttribute('stroke')) : '') || color; } catch (e) {}
    // Build point pairs using exact vertex coords (line.points) when available,
    // otherwise fall back to getPointAtLength or parsing the points attribute.
    let ptsPairs = [];
    if (line && labelsArrLocal.length > 0) {
      try {
        if (line.points && typeof line.points.getItem === 'function' && line.points.numberOfItems >= labelsArrLocal.length) {
          for (let i = 0; i < labelsArrLocal.length; i++) {
            const p = line.points.getItem(i);
            ptsPairs.push([Number(p.x || 0), Number(p.y || 0)]);
          }
        } else if (typeof line.getTotalLength === 'function') {
          const total = line.getTotalLength();
          for (let i = 0; i < labelsArrLocal.length; i++) {
            const ratio = (labelsArrLocal.length <= 1) ? 0.5 : (i / (labelsArrLocal.length - 1));
            const p = line.getPointAtLength(total * ratio);
            ptsPairs.push([Number(p.x || 0), Number(p.y || 0)]);
          }
        } else {
          const ptsAttr = line?.getAttribute('points') || '';
          ptsPairs = ptsAttr.trim().split(/\s+/).filter(Boolean).map(tok => {
            const parts = String(tok).split(',');
            return [Number(parts[0] || 0), Number(parts[1] || 0)];
          });
        }
      } catch (e) { ptsPairs = []; }
    } else {
      try {
        const ptsAttr = line?.getAttribute('points') || '';
        ptsPairs = ptsAttr.trim().split(/\s+/).filter(Boolean).map(tok => {
          const parts = String(tok).split(',');
          return [Number(parts[0] || 0), Number(parts[1] || 0)];
        });
      } catch (e) { ptsPairs = []; }
    }

    return { key: def.name, line, values, color, ptsPairs };
  });

  // Only include series that are actually present in the rendered SVG.
  // This prevents showing a Signups row in tooltips when signups are intentionally hidden.
  try {
    seriesMeta = seriesMeta.filter(m => !!m.line);
  } catch (e) {}

  function hideHover() {
    try { tooltip.style.display = 'none'; } catch (e) {}
    try { vline.style.display = 'none'; } catch (e) {}
    pts.forEach(p => { try { p.setAttribute('r', '3'); p.style.transform = ''; } catch (e) {} });
    // remove any temporary hover dots we created
    try {
      const temp = Array.from(svg.querySelectorAll('.analytics-chart-hover-dot'));
      temp.forEach(t => t.parentNode && t.parentNode.removeChild(t));
    } catch (e) {}
    try {
      const htmlTemp = Array.from(document.querySelectorAll('.analytics-hover-dot'));
      htmlTemp.forEach(t => t.parentNode && t.parentNode.removeChild(t));
    } catch (e) {}
    try {
      const hoverLayer = svg.querySelector('.analytics-hover-layer');
      if (hoverLayer && hoverLayer.parentNode) hoverLayer.parentNode.removeChild(hoverLayer);
    } catch (e) {}
  }

  function onLeave() { hideHover(); }

  function onMove(e) {
    // transform client point to SVG coordinate
    let xSvg = null;
    try {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const inv = ctm.inverse();
        const sp = pt.matrixTransform(inv);
        xSvg = sp.x;
      }
    } catch (err) {
      // fallback: map by bounding rect and viewBox
      const rect = svg.getBoundingClientRect();
      const viewW = (vb && vb.width) ? vb.width : rect.width;
      xSvg = ((e.clientX - rect.left) / rect.width) * viewW;
    }

    // find nearest index by cx distance
    let nearestIdx = null;
    let bestDist = Infinity;
    for (const idx of sortedIdx) {
      const info = idxMap.get(idx);
      if (info.cx == null) continue;
      const dist = Math.abs(info.cx - xSvg);
      if (dist < bestDist) { bestDist = dist; nearestIdx = idx; }
    }
    if (nearestIdx == null) return hideHover();

    const info = idxMap.get(nearestIdx);
    if (!info) return hideHover();
    const cx = info.cx;

    // Reset all existing visible point markers to their default state
    try { pts.forEach(p => { p.setAttribute('r', '3'); p.style.transform = ''; }); } catch (e) {}

    // position vertical line at cx (SVG coord)
    try {
      vline.setAttribute('x1', String(cx));
      vline.setAttribute('x2', String(cx));
      vline.style.display = 'block';
    } catch (e) {}

    // build tooltip content from seriesMeta (shows zeros even when no circle exists)
    const circles = info.pts;
    const label = labelsArrLocal[nearestIdx] || circles[0]?.dataset.label || '';
    const metricsHtml = seriesMeta.map(m => {
      const value = Number(m.values[nearestIdx] || 0);
      const color = m.color || '#999';
      return `<div class="analytics-trend-metric"><span class="analytics-trend-swatch" style="background:${color};width:10px;height:10px;display:inline-block;border-radius:2px;margin-right:.5rem;flex:0 0 auto"></span><span style="flex:1 1 auto">${escHtml(m.key)}</span><span style="margin-left:.6rem;font-weight:700">${formatCount(value)}</span></div>`;
    }).join('');

    tooltip.innerHTML = `<strong>${escHtml(label)}</strong><div class="analytics-trend-metrics">${metricsHtml}</div>`;
    tooltip.style.display = 'block';

    // remove any old temporary hover dots / clear previous hover layer
    try {
      const hoverLayerOld = svg.querySelector('.analytics-hover-layer');
      if (hoverLayerOld) hoverLayerOld.innerHTML = '';
      const oldLegacy = Array.from(svg.querySelectorAll('.analytics-chart-hover-dot'));
      oldLegacy.forEach(o => o.parentNode && o.parentNode.removeChild(o));
    } catch (e) {}

    // create temporary hover markers for series that don't have visible circles
    try {
      // compute chart mapping consistent with renderAnalyticsTrendGraph
      const vbLocal = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null;
      const svgW = (vbLocal && vbLocal.width) ? vbLocal.width : svg.getBoundingClientRect().width;
      const svgH = (vbLocal && vbLocal.height) ? vbLocal.height : svg.getBoundingClientRect().height;
      const marginLocal = { top: 18, right: 16, bottom: 52, left: 44 };
      const chartW = svgW - marginLocal.left - marginLocal.right;
      const chartH = svgH - marginLocal.top - marginLocal.bottom;
      const labelsCount = Math.max(1, labelsArrLocal.length || 1);
      const xForIndexLocal = idx => labelsCount <= 1 ? (marginLocal.left + chartW / 2) : (marginLocal.left + (idx / (labelsCount - 1)) * chartW);
      const seriesMax = Math.max(1, ...seriesMeta.map(s => Math.max(0, ...(s.values || []).map(v => Number(v || 0)))));
      const yForValueLocal = val => marginLocal.top + chartH - (Math.max(0, Number(val || 0)) / seriesMax) * chartH;

      seriesMeta.forEach(m => {
        try {
          const hasVisible = !!circles.find(c => String(c.dataset.series || '') === String(m.key || ''));
          if (hasVisible) return;
          // prefer exact vertex coords from the polyline if available
          const pair = (m.ptsPairs || [])[nearestIdx];
          let px = null; let py = null;
          if (pair && isFinite(pair[0]) && isFinite(pair[1])) {
            px = pair[0]; py = pair[1];
          } else {
            // fallback to computed positions matching renderAnalyticsTrendGraph
            const sval = Number((m.values || [])[nearestIdx] || 0);
            px = xForIndexLocal(nearestIdx);
            py = yForValueLocal(sval);
          }
          if (!isFinite(px) || !isFinite(py)) return;

          // create an SVG marker inside an overlay group (more robust than fixed HTML positioning)
          try {
            let hoverLayer = svg.querySelector('.analytics-hover-layer');
            if (!hoverLayer) {
              hoverLayer = document.createElementNS(ns, 'g');
              hoverLayer.classList.add('analytics-hover-layer');
              svg.appendChild(hoverLayer);
            }

            const tmp = document.createElementNS(ns, 'circle');
            tmp.classList.add('analytics-hover-dot');
            tmp.setAttribute('cx', String(px));
            tmp.setAttribute('cy', String(py));
            tmp.setAttribute('r', '4');
            tmp.setAttribute('fill', m.color || '#999');
            tmp.setAttribute('stroke', '#ffffff');
            tmp.setAttribute('stroke-width', '1');
            hoverLayer.appendChild(tmp);
          } catch (e) {}
        } catch (e) {}
      });
    } catch (e) {}

    // position tooltip centered on the vertical guide (clamped to viewport)
    const rect = svg.getBoundingClientRect();
    let clientX;
    try {
      // map SVG user-space x (cx) to screen/client coordinates using CTM
      const pt = svg.createSVGPoint();
      pt.x = cx; pt.y = 0;
      const screenCTM = svg.getScreenCTM();
      if (screenCTM) {
        const transformed = pt.matrixTransform(screenCTM);
        clientX = transformed.x;
      } else {
        const viewW = (vb && vb.width) ? vb.width : rect.width;
        clientX = rect.left + (cx / viewW) * rect.width;
      }
    } catch (err) {
      const viewW = (vb && vb.width) ? vb.width : rect.width;
      clientX = rect.left + (cx / viewW) * rect.width;
    }

    const tRect = tooltip.getBoundingClientRect();
    const margin = 8;
    // center tooltip horizontally above the guide
    let left = clientX - (tRect.width / 2);
    if (left < margin) left = margin;
    if (left + tRect.width + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - tRect.width - margin);
    // position tooltip near top of svg; if it would overflow bottom, shift up
    let top = rect.top + 8;
    if (top + tRect.height + margin > window.innerHeight) top = Math.max(margin, rect.bottom - tRect.height - margin);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    // highlight circles for this day
    circles.forEach(c => { try { c.setAttribute('r', '5'); c.style.transform = 'scale(1.1)'; } catch (e) {} });
  }

  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', onLeave);
}

function refreshDateFormattedContent() {
  if (views.users?.classList.contains('active')) {
    renderUsers(usersCache);
  }

  if (analyticsCache && views.analytics?.classList.contains('active')) {
    renderAnalytics(analyticsCache);
  }
}

function applyDateFormatMode() {
  if (dateFormatInput) dateFormatInput.value = dateFormatPattern;
  if (dateFormatPreset) dateFormatPreset.value = getDateFormatPresetId(dateFormatPattern);
  refreshDateFormattedContent();
}

function setDateFormatPattern(nextPattern) {
  dateFormatPattern = normalizeDateFormatPattern(nextPattern);
  localStorage.setItem('dateFormatPattern', dateFormatPattern);
  localStorage.removeItem('dateFormatMode');
  applyDateFormatMode();
}

function clearAuthSession() {
  authToken = '';
  authUsername = '';
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUsername');
  localStorage.removeItem('authIsAdmin');
}

function withAuthHeaders(headers) {
  const merged = new Headers(headers || {});
  if (authToken) merged.set('Authorization', `Bearer ${authToken}`);
  return merged;
}

async function apiFetch(path, opts = {}) {
  const headers = withAuthHeaders(opts.headers);
  if (!(opts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API}${path}`, {
    ...opts,
    headers,
  });

  if (response.status === 401) {
    clearAuthSession();
    window.location.href = 'login.html';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed (${response.status})`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function activateView(viewName, sourceBtn = null) {
  adminViewController.activateView(viewName, sourceBtn);
}

function renderUsers(users) {
  if (!usersGrid) return;

  if (!Array.isArray(users) || !users.length) {
    usersGrid.innerHTML = '<p class="settings-hint">No users found.</p>';
    return;
  }

  const currentUsername = normalizeUsername(authUsername);

  usersGrid.innerHTML = users.map(user => {
    const username = String(user.username || '');
    const normalized = normalizeUsername(username);
    const isCurrentUser = normalized === currentUsername;
    const isDisabled = Boolean(user.is_disabled);
    const isSystemAccount = Boolean(user.is_system_account);
    const isAdmin = Boolean(user.is_admin);
    const roleLabel = isAdmin ? 'Admin' : 'User';
    const createdDate = formatDateTime(user.created_at);
    const forceChangeFlag = user.force_password_change ? 'Password change required' : 'Password change optional';
    const disabledBadge = isDisabled ? '<span class="user-status-pill user-status-pill--disabled">Disabled</span>' : '';
    const systemBadge = isSystemAccount ? '<span class="user-status-pill user-status-pill--system">System Account</span>' : '';
    const nextDisabledState = isDisabled ? 'false' : 'true';
    const nextAdminState = isAdmin ? 'false' : 'true';
    const disableButtonLabel = isDisabled ? 'Enable Account' : 'Disable Account';
    const disableButtonClass = 'user-disable-btn btn-toggle';
    const adminButtonLabel = isAdmin ? 'Revoke Admin' : 'Make Admin';
    const adminButtonClass = 'user-role-btn btn-toggle';
    const isExpanded = expandedUsers.has(normalized);
    const metaLine = `Role: ${escHtml(roleLabel)} • Created ${escHtml(createdDate)}`;
    const actionButtons = isSystemAccount
      ? [
          `<button class="${disableButtonClass}" type="button" data-username="${username}" data-next-disabled="${nextDisabledState}">${disableButtonLabel}</button>`,
        ]
      : [
          `<button class="${adminButtonClass}" type="button" data-username="${username}" data-next-admin="${nextAdminState}">${adminButtonLabel}</button>`,
          `<button class="${disableButtonClass}" type="button" data-username="${username}" data-next-disabled="${nextDisabledState}">${disableButtonLabel}</button>`,
          `<button class="user-password-btn btn-toggle" type="button" data-username="${username}" data-action="reset">Reset Password</button>`,
          `<button class="user-password-btn btn-toggle" type="button" data-username="${username}" data-action="force">Force Change</button>`,
          `<button class="user-delete-btn btn-danger" type="button" data-username="${username}">Delete</button>`,
        ];

    return [
      `<div class="user-item user-item-expandable${isExpanded ? ' expanded' : ''}" data-username="${username}">`,
      `  <button class="user-expand-btn" type="button" data-username="${username}" aria-expanded="${isExpanded ? 'true' : 'false'}">`,
      '    <span class="user-expand-main">',
      `      <span class="user-name">${username} ${disabledBadge} ${systemBadge}</span>`,
      `      <span class="user-created">${metaLine}</span>`,
      '    </span>',
      `    <span class="user-expand-icon" aria-hidden="true">${isExpanded ? '▴' : '▾'}</span>`,
      '  </button>',
      `  <div class="user-expand-panel"${isExpanded ? '' : ' hidden'}>`,
      `    <p class="user-expanded-meta">${forceChangeFlag}${isCurrentUser ? ' • Current user' : ''}</p>`,
      '    <div class="user-actions">',
      `      ${actionButtons.join('')}`,
      '    </div>',
      '  </div>',
      '</div>',
    ].join('');
  }).join('');

  usersGrid.querySelectorAll('.user-expand-btn').forEach(button => {
    button.addEventListener('click', () => {
      const username = normalizeUsername(button.dataset.username || '');
      if (!username) return;

      if (expandedUsers.has(username)) expandedUsers.delete(username);
      else expandedUsers.add(username);
      renderUsers(usersCache);
    });
  });

  usersGrid.querySelectorAll('.user-role-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const username = String(button.dataset.username || '');
      const nextAdmin = button.dataset.nextAdmin === 'true';
      if (!username) return;

      // Confirmation dialog before promoting/demoting admin
      const action = nextAdmin ? 'promote' : 'demote';
      const confirmTitle = nextAdmin ? 'Promote to Admin' : 'Revoke Admin Rights';
      const confirmMessage = nextAdmin
        ? `Are you sure you want to promote <b>${escHtml(username)}</b> to admin?`
        : `Are you sure you want to revoke admin rights from <b>${escHtml(username)}</b>?`;
      const okText = nextAdmin ? 'Promote' : 'Revoke';
      const danger = !nextAdmin; // Demote is a dangerous action

      const confirmed = await showAdminDialog({
        title: confirmTitle,
        messageHtml: confirmMessage,
        okText,
        cancelText: 'Cancel',
        danger,
        showCancel: true,
      });
      if (!confirmed) return;

      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = 'Saving...';
      setUsersStatus('');

      try {
        await apiFetch(`/users/${encodeURIComponent(username)}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_admin: nextAdmin }),
        });
        await loadUsers();
      } catch (err) {
        button.disabled = false;
        button.textContent = previousText;
        setUsersStatus(`Failed to update role: ${err.message}`);
      }
    });
  });

  usersGrid.querySelectorAll('.user-password-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const username = String(button.dataset.username || '');
      const action = String(button.dataset.action || 'reset');
      if (!username) return;

      const shouldContinue = await showAdminDialog({
        title: action === 'reset' ? 'Reset Password?' : 'Force Password Change?',
        message: action === 'reset'
          ? `Generate a temporary password for "${username}" and sign out active sessions?`
          : `Require "${username}" to change password on next login?`,
        okText: action === 'reset' ? 'Generate' : 'Force Change',
        danger: action === 'reset',
        showCancel: true,
      });

      if (!shouldContinue) return;

      const previousText = button.textContent;
      button.disabled = true;

      try {
        if (action === 'reset') {
          button.textContent = 'Generating...';
          const response = await apiFetch(`/users/${encodeURIComponent(username)}/password/reset`, {
            method: 'POST',
          });
          setUsersStatus('');
          // For security reasons the backend does not return the temporary password in the API response.
          // Inform the admin that a temporary password was generated and instruct to deliver it securely out-of-band.
          await showAdminDialog({
            title: 'Temporary Password Generated',
            messageHtml: [
              `<p>A temporary password has been generated for <strong>${escHtml(username)}</strong>.</p>`,
              '<p class="settings-hint">For security reasons the temporary password is not shown here. Deliver the temporary password to the user using a secure out-of-band method (for example, a phone call or an encrypted message).</p>',
              '<p><em>User will be required to change password on next login.</em></p>',
            ].join(''),
            okText: 'Close',
            danger: false,
            showCancel: false,
          });
        } else if (action === 'force') {
          button.textContent = 'Saving...';
          await apiFetch(`/users/${encodeURIComponent(username)}/password/force-change`, {
            method: 'POST',
          });
          setUsersStatus('');
          await showAdminDialog({
            title: 'Password Change Required',
            message: `User "${username}" will be required to change password on next login.`,
            okText: 'Close',
            danger: false,
            showCancel: false,
          });
        }
        await loadUsers();
      } catch (err) {
        button.disabled = false;
        button.textContent = previousText;
        setUsersStatus(`Failed to ${action === 'reset' ? 'reset' : 'force change'} password: ${err.message}`);
      }
    });
  });

  usersGrid.querySelectorAll('.user-delete-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const username = String(button.dataset.username || '');
      if (!username) return;

      const shouldDelete = await showAdminDialog({
        title: 'Delete Account?',
        message: `Delete user "${username}"? This cannot be undone.`,
        okText: 'Delete',
        danger: true,
        showCancel: true,
      });

      if (!shouldDelete) {
        return;
      }

      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = 'Deleting...';
      setUsersStatus('');

      try {
        await apiFetch(`/users/${encodeURIComponent(username)}`, {
          method: 'DELETE',
        });
        expandedUsers.delete(normalizeUsername(username));
        await loadUsers();
      } catch (err) {
        button.disabled = false;
        button.textContent = previousText;
        setUsersStatus(`Failed to delete user: ${err.message}`);
      }
    });
  });

  usersGrid.querySelectorAll('.user-disable-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const username = String(button.dataset.username || '');
      const nextDisabled = button.dataset.nextDisabled === 'true';
      if (!username) return;

      if (nextDisabled) {
        const shouldDisable = await showAdminDialog({
          title: 'Disable Account?',
          message: `Disable user "${username}"? They will be signed out immediately.`,
          okText: 'Disable',
          danger: true,
          showCancel: true,
        });
        if (!shouldDisable) return;
      }

      if (!nextDisabled) {
        const shouldEnable = await showAdminDialog({
          title: 'Enable Account?',
          message: `Enable user "${username}" and allow login again?`,
          okText: 'Enable',
          danger: false,
          showCancel: true,
        });
        if (!shouldEnable) return;
      }

      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = nextDisabled ? 'Disabling...' : 'Enabling...';
      setUsersStatus('');

      try {
        await apiFetch(`/users/${encodeURIComponent(username)}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_disabled: nextDisabled }),
        });
        await loadUsers();
      } catch (err) {
        button.disabled = false;
        button.textContent = previousText;
        setUsersStatus(`Failed to ${nextDisabled ? 'disable' : 'enable'} account: ${err.message}`);
      }
    });
  });
}

async function loadUsers() {
  setUsersStatus('Loading users...');

  try {
    const users = await apiFetch('/users');
    usersCache = Array.isArray(users) ? users : [];
    renderUsers(usersCache);
    // populate analytics user-select for switching user-specific stats
    try { populateAnalyticsUserSelect(usersCache); } catch (e) { /* ignore */ }
    setUsersStatus('');
  } catch (err) {
    setUsersStatus(`Failed to load users: ${err.message}`);
  }
}

function populateAnalyticsUserSelect(users) {
  if (!analyticsUserSelect) return;
  const list = Array.isArray(users) && users.length ? users : (Array.isArray(usersCache) ? usersCache : []);
  const current = analyticsUserSelect.value || '';
  const opts = ['<option value="">Select user…</option>'];
  list.slice().sort((a, b) => String((a.username||'')).localeCompare(String((b.username||'')))).forEach(u => {
    const name = String(u.username || '');
    opts.push(`<option value="${escHtml(name)}">${escHtml(name)}</option>`);
  });
  analyticsUserSelect.innerHTML = opts.join('');
  if (current && Array.from(analyticsUserSelect.options).some(o => o.value === current)) analyticsUserSelect.value = current;
  // If a custom select enhancer is present, sync it so the visible widget updates.
  try { if (typeof syncAdminCustomSelect === 'function') syncAdminCustomSelect('analytics-user-select'); } catch (e) {}
}

function renderAnalytics(data) {
  if (!analyticsSummary || !analyticsTrends || !analyticsTopUsers) return;

  const users = data?.users || {};
  const sessions = data?.sessions || {};
  const saves = data?.saves || {};
  const trends = data?.trends || {};
  const topUsers = Array.isArray(data?.top_users) ? data.top_users : [];

  const summaryCards = [
    { label: 'Users (Total)', value: users.total },
    { label: 'Users (Enabled)', value: users.enabled },
    { label: 'Users (Disabled)', value: users.disabled },
    { label: 'Admins', value: users.admins },
    { label: 'Active Sessions', value: sessions.active },
    { label: 'Saves (Total)', value: saves.total },
    { label: 'Total Music', value: saves.music },
    { label: 'Total Recipes', value: saves.recipes },
    { label: 'Unique Domains', value: saves.unique_domains },
    { label: 'Accepted Shares', value: (saves.accepted_shares != null) ? saves.accepted_shares : saves.shared_total },
    { label: 'Declined Shares', value: saves.declined_shares },
    { label: 'Saves (24h)', value: saves.created_last_24h },
    { label: 'Music (24h)', value: saves.music_last_24h },
    { label: 'Recipes (24h)', value: saves.recipes_last_24h },
    { label: 'Saves (7d)', value: saves.created_last_7d },
    { label: 'Music (7d)', value: saves.music_last_7d },
    { label: 'Recipes (7d)', value: saves.recipes_last_7d },
    { label: 'Pending Shares', value: saves.pending_share_requests },
    { label: 'New Signups (30d)', value: users.signups_last_30d },
  ];

  analyticsSummary.innerHTML = summaryCards.map(card => [
    '<article class="analytics-card">',
    `  <p class="analytics-card-label">${escHtml(card.label)}</p>`,
    `  <p class="analytics-card-value">${formatCount(card.value)}</p>`,
    '</article>',
  ].join('')).join('');

  const labels = Array.isArray(trends.labels) ? trends.labels : [];
  const savesTrend = Array.isArray(trends.saves) ? trends.saves : [];
  const signupsTrend = Array.isArray(trends.signups) ? trends.signups : [];
  const shareRequestsTrend = Array.isArray(trends.share_requests) ? trends.share_requests : [];
  const shareAcceptedTrend = Array.isArray(trends.share_accepted) ? trends.share_accepted : [];
  const shareDeclinedTrend = Array.isArray(trends.share_declined) ? trends.share_declined : [];

  if (!labels.length) {
    analyticsTrends.innerHTML = '<p class="settings-hint">No trend data available yet.</p>';
  } else {
    analyticsTrends.innerHTML = renderAnalyticsTrendGraph(labels, savesTrend, signupsTrend, shareRequestsTrend, shareAcceptedTrend, shareDeclinedTrend);
    try { attachTrendInteractions(analyticsTrends); } catch (e) { /* ignore */ }
  }

  if (!topUsers.length) {
    analyticsTopUsers.innerHTML = '<p class="settings-hint">No save activity available yet.</p>';
  } else {
    analyticsTopUsers.innerHTML = [
      '<table class="analytics-table">',
      '  <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Saves</th><th>Profiles</th><th>Last Save</th></tr></thead>',
      '  <tbody>',
      ...topUsers.map(entry => {
        const role = entry.is_admin ? 'Admin' : 'User';
        const statuses = [];
        if (entry.is_system_account) statuses.push('System');
        if (entry.is_disabled) statuses.push('Disabled');

        return [
          '<tr>',
          `  <td><span class="analytics-user-name">${escHtml(entry.username || '-')}</span></td>`,
          `  <td>${escHtml(role)}</td>`,
          `  <td>${escHtml(statuses.join(', ') || 'Active')}</td>`,
          `  <td>${formatCount(entry.save_count)}</td>`,
          `  <td>${formatCount(entry.profile_count)}</td>`,
          `  <td>${escHtml(formatDateTime(entry.last_save_at))}</td>`,
          '</tr>',
        ].join('');
      }).join(''),
      '  </tbody>',
      '</table>',
    ].join('');
  }

  const topDomains = Array.isArray(data?.top_domains) ? data.top_domains : [];
  if (!analyticsTopDomains) {
    // no-op if element missing
  } else if (!topDomains.length) {
    analyticsTopDomains.innerHTML = '<p class="settings-hint">No domain data available yet.</p>';
  } else {
    try {
      analyticsTopDomains.innerHTML = renderTopDomainsList(topDomains);
      // Attach interactive hover handlers after the SVG is inserted
      try {
        attachPieInteractions(analyticsTopDomains, topDomains);
      } catch (err) {
        console.error('Failed to attach pie interactions', err);
      }
    } catch (err) {
      console.error('Failed to render top domains', err);
      analyticsTopDomains.innerHTML = '<p class="settings-hint">Failed to render domain chart.</p>';
    }
  }

  // Top users are shown for reference only (no click/auto-load behavior).

  if (analyticsGeneratedAt) {
    analyticsGeneratedAt.textContent = `Last updated: ${formatDateTime(data?.generated_at)}`;
  }

  // Content changed (charts rendered) — ensure spanning panels are repositioned.
  try { scheduleRelayout(60); } catch (e) { /* noop */ }
}

// Render only the trends portion of analytics into the trends panel.
function renderAnalyticsTrends(data) {
  if (!analyticsTrends) return;

  const trends = data?.trends || {};
  const labels = Array.isArray(trends.labels) ? trends.labels : [];
  const savesTrend = Array.isArray(trends.saves) ? trends.saves : [];
  const signupsTrend = Array.isArray(trends.signups) ? trends.signups : [];
  const shareRequestsTrend = Array.isArray(trends.share_requests) ? trends.share_requests : [];
  const shareAcceptedTrend = Array.isArray(trends.share_accepted) ? trends.share_accepted : [];
  const shareDeclinedTrend = Array.isArray(trends.share_declined) ? trends.share_declined : [];

  if (!labels.length) {
    analyticsTrends.innerHTML = '<p class="settings-hint">No trend data available yet.</p>';
  } else {
    analyticsTrends.innerHTML = renderAnalyticsTrendGraph(labels, savesTrend, signupsTrend, shareRequestsTrend, shareAcceptedTrend, shareDeclinedTrend);
    try { attachTrendInteractions(analyticsTrends); } catch (e) { /* ignore */ }
  }

  if (analyticsGeneratedAt) analyticsGeneratedAt.textContent = `Last updated: ${formatDateTime(data?.generated_at)}`;
  try { scheduleRelayout(60); } catch (e) { /* noop */ }
}

// Fetch and apply only the trends data for a chosen span (does not re-render summaries/tables).
async function loadAnalyticsTrends(span) {
  if (!analyticsTrends) return;
  setAnalyticsStatus('Loading analytics...');
  try {
    const selectedSpan = span || (analyticsTimespanSelect ? (analyticsTimespanSelect.value || '14d') : '14d');
    const data = await apiFetch(`/admin/analytics?span=${encodeURIComponent(selectedSpan)}`);
    // keep cache in sync for other UI bits if present
    analyticsCache = analyticsCache || {};
    analyticsCache.trends = data.trends || {};

    if (analyticsTrendsRange) {
      const spanLabels = {
        'all': 'All time',
        '365d': 'Last year',
        '30d': 'Last month (30 days)',
        '14d': 'Last 14 days',
        '7d': 'Last week (7 days)',
        '24h': 'Last 24 hours',
      };
      analyticsTrendsRange.textContent = `(${spanLabels[selectedSpan] || selectedSpan})`;
    }

    renderAnalyticsTrends(analyticsCache);
    setAnalyticsStatus('');
  } catch (err) {
    setAnalyticsStatus(`Failed to load analytics trends: ${err.message}`);
  }
}

async function loadAnalytics() {
  if (!analyticsSummary || !analyticsTrends || !analyticsTopUsers) return;

  setAnalyticsStatus('Loading analytics...');

  try {
    const selectedSpan = analyticsTimespanSelect ? (analyticsTimespanSelect.value || '14d') : '14d';
    const data = await apiFetch(`/admin/analytics?span=${encodeURIComponent(selectedSpan)}`);
    analyticsCache = data || {};
    if (analyticsTrendsRange) {
      const spanLabels = {
        'all': 'All time',
        '365d': 'Last year',
        '30d': 'Last month (30 days)',
        '14d': 'Last 14 days',
        '7d': 'Last week (7 days)',
        '24h': 'Last 24 hours',
      };
      analyticsTrendsRange.textContent = `(${spanLabels[selectedSpan] || selectedSpan})`;
    }
    renderAnalytics(analyticsCache);
    setAnalyticsStatus('');
  } catch (err) {
    analyticsCache = null;
    analyticsSummary.innerHTML = '';
    analyticsTrends.innerHTML = '';
    analyticsTopUsers.innerHTML = '';
    if (analyticsGeneratedAt) analyticsGeneratedAt.textContent = '';
    setAnalyticsStatus(`Failed to load analytics: ${err.message}`);
  }
}

async function logoutCurrentUser(triggerButton = null) {
  const previousLabel = triggerButton?.textContent || 'Logout';
  const logoutBtn = triggerButton;
  if (logoutBtn) {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Logging out...';
  }

  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore server logout errors and always clear local auth.
  } finally {
    if (logoutBtn) {
      logoutBtn.disabled = false;
      logoutBtn.textContent = previousLabel;
    }
    closeSettingsOverlay();
    clearAuthSession();
    window.location.href = 'login.html';
  }
}

async function bootstrapAdminSession() {
  if (!authToken) {
    clearAuthSession();
    window.location.href = 'login.html';
    return;
  }

  try {
    const me = await apiFetch('/auth/me');
    authUsername = String(me.username || '').trim();
    localStorage.setItem('authUsername', authUsername);

    if (!me.is_admin) {
      localStorage.setItem('authIsAdmin', 'false');
      window.location.href = 'index.html';
      return;
    }

    localStorage.setItem('authIsAdmin', 'true');
    updateAccountNameLabel();

    const activeView = adminViewController.getActiveViewName();
    if (activeView === 'analytics') {
      await loadAnalytics();
      return;
    }
    await loadUsers();
  } catch (err) {
    clearAuthSession();
    window.location.href = 'login.html';
    throw err;
  }
}

adminViewController.bindNavigation();
adminViewController.hydrateFromStorage();

analyticsRefreshBtn?.addEventListener('click', () => {
  void loadAnalytics();
});
// When the timespan selector changes, reload only the trends for the chosen range.
analyticsTimespanSelect?.addEventListener('change', () => {
  const span = analyticsTimespanSelect?.value || '14d';
  void loadAnalyticsTrends(span);
});

// If a user-specific timespan selector exists, keep it in sync with the global selector
if (analyticsUserTimespanSelect && analyticsTimespanSelect) {
  try { analyticsUserTimespanSelect.value = analyticsTimespanSelect.value || '14d'; } catch (e) {}
}

// Reload the user-specific analytics when the user-timespan changes
analyticsUserTimespanSelect?.addEventListener('change', () => {
  const uname = analyticsUserSelect?.value || '';
  if (uname) {
    void loadUserSpecific(uname);
  }
});

// User select change/clear handlers
analyticsUserSelect?.addEventListener('change', () => {
  const uname = analyticsUserSelect.value || '';
  if (uname) {
    void loadUserSpecific(uname);
  } else {
    if (analyticsUserSpecific) analyticsUserSpecific.innerHTML = '<p class="settings-hint">No user selected.</p>';
  }
});


// --- Editable panels grid (layout persistence, edit mode, drag/reorder, span controls) ---
const panelsGrid = document.getElementById('analytics-panels-grid');
const layoutStorageKey = 'analyticsLayout_v1';
const editLayoutBtn = document.getElementById('analytics-edit-layout-btn');
// maximum number of rows a panel may span (keeps rows compact)
const MAX_PANEL_ROW_SPAN = 3;
// base row height in pixels (used for snapping vertical resizes)
const BASE_ROW_HEIGHT = 240;

function getDefaultLayout() {
  return {
    order: [
      'panel-trends',
      'panel-top-users',
      'panel-top-domains',
      'panel-user-specific',
    ],
    spans: {
      'panel-trends': { col: 1, row: 1 },
      'panel-top-users': { col: 1, row: 1 },
      'panel-top-domains': { col: 1, row: 1 },
      'panel-user-specific': { col: 1, row: 1 },
    },
  };
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(layoutStorageKey);
    if (!raw) return getDefaultLayout();
    const parsed = JSON.parse(raw);
    const def = getDefaultLayout();
    // ensure keys exist
    parsed.order = Array.isArray(parsed.order) ? parsed.order : def.order.slice();
    parsed.spans = parsed.spans || {};
    for (const id of def.order) {
      if (!parsed.spans[id]) parsed.spans[id] = { ...(def.spans[id] || { col: 1, row: 1 }) };
      // sanitize spans to valid ranges
      const s = parsed.spans[id] || {};
      s.col = Math.max(1, Math.min(3, Number(s.col || 1)));
      s.row = Math.max(1, Math.min(MAX_PANEL_ROW_SPAN, Number(s.row || 1)));
      parsed.spans[id] = s;
    }
    // persist sanitized layout so future loads are clean
    try { localStorage.setItem(layoutStorageKey, JSON.stringify(parsed)); } catch (e) {}
    return parsed;
  } catch (err) {
    return getDefaultLayout();
  }
}

function saveLayout(layout) {
  try {
    localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
  } catch (err) {
    console.error('Failed to save layout', err);
  }
}

function applyLayout(/* layout */) {
  // Static 3-column layout used for admin analytics per user request.
  // Left area: `panel-trends` spans columns 1-2 and rows 1-2.
  // Right area: `panel-top-users` at row 1, column 3; `panel-top-domains` at row 2, column 3.
  if (!panelsGrid) return;

  // Ensure the container uses the CSS grid defined in stylesheet
  panelsGrid.classList.remove('edit-mode', 'editing', 'drag-over');
  panelsGrid.style.position = panelsGrid.style.position || '';

  const trends = document.querySelector('[data-panel-id="panel-trends"]');
  const topUsers = document.querySelector('[data-panel-id="panel-top-users"]');
  const topDomains = document.querySelector('[data-panel-id="panel-top-domains"]');

  // Clear any leftover edit-mode controls or inline absolute positioning
  panelsGrid.querySelectorAll('.panel-edit-controls, .panel-resizer').forEach(el => el.remove());
  panelsGrid.querySelectorAll('.analytics-panel').forEach(p => {
    p.removeAttribute('draggable');
    p.style.position = '';
    p.style.left = '';
    p.style.top = '';
    p.style.width = '';
    p.style.height = '';
    p.style.zIndex = '';
    p.style.pointerEvents = '';
    p.style.gridColumn = '';
    p.style.gridRow = '';
    p.dataset.colSpan = '';
    p.dataset.rowSpan = '';
    p.dataset.rowStart = '';
    p.dataset.startCol = '';
  });

  // Apply explicit grid placements
  if (trends) {
    trends.style.gridColumn = '1 / span 2';
    trends.style.gridRow = '1 / span 2';
  }
  if (topUsers) {
    topUsers.style.gridColumn = '3 / span 1';
    topUsers.style.gridRow = '1 / span 1';
  }
  if (topDomains) {
    topDomains.style.gridColumn = '3 / span 1';
    topDomains.style.gridRow = '2 / span 1';
  }

  // Place the single user-specific panel below the main panels (spans full width)
  const userPanel = document.querySelector('[data-panel-id="panel-user-specific"]');
  if (userPanel) {
    userPanel.style.gridColumn = '1 / span 3';
    userPanel.style.gridRow = '3 / span 3';
  }

  // Expose simple placement info for debugging
  try {
    window.__lastPlacements = {
      'panel-trends': { rowStart: 1, colStart: 1, colSpan: 2, rowSpan: 2 },
      'panel-top-users': { rowStart: 1, colStart: 3, colSpan: 1, rowSpan: 1 },
      'panel-top-domains': { rowStart: 2, colStart: 3, colSpan: 1, rowSpan: 1 },
      'panel-user-specific': { rowStart: 3, colStart: 1, colSpan: 3, rowSpan: 3 },
    };
    window.__lastLayout = { order: [
      'panel-trends', 'panel-top-users', 'panel-top-domains', 'panel-user-specific'
    ] };
    console.log('Applied static analytics layout', window.__lastPlacements);
  } catch (e) { /* ignore */ }

  try { if (window.__analyticsDebugEnabled) updateDebugOverlay(window.__lastLayout); } catch (e) {}
}

// Debug overlay utilities (non-invasive). Toggle was removed from UI; keep overlay disabled by default.
  window.__analyticsDebugEnabled = false;
  let __analyticsDebugOverlay = null;
  function createDebugOverlay() {
    if (!panelsGrid || __analyticsDebugOverlay) return;
    __analyticsDebugOverlay = document.createElement('div');
    __analyticsDebugOverlay.className = 'analytics-debug-overlay';
    __analyticsDebugOverlay.style.position = 'absolute';
    __analyticsDebugOverlay.style.left = '0';
    __analyticsDebugOverlay.style.top = '0';
    __analyticsDebugOverlay.style.width = '100%';
    __analyticsDebugOverlay.style.height = '100%';
    __analyticsDebugOverlay.style.pointerEvents = 'none';
    __analyticsDebugOverlay.style.zIndex = 9999;
    panelsGrid.appendChild(__analyticsDebugOverlay);
  }

  function removeDebugOverlay() {
    if (!__analyticsDebugOverlay) return;
    try { __analyticsDebugOverlay.remove(); } catch (e) {}
    __analyticsDebugOverlay = null;
  }

  function updateDebugOverlay(layout) {
    if (!window.__analyticsDebugEnabled) { removeDebugOverlay(); return; }
    if (!panelsGrid) return;
    createDebugOverlay();
    __analyticsDebugOverlay.innerHTML = '';
    const pgRect = panelsGrid.getBoundingClientRect();

    // show per-row boxes
    panelsGrid.querySelectorAll('.analytics-row').forEach((rowEl, idx) => {
      const r = rowEl.getBoundingClientRect();
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.left = `${Math.round(r.left - pgRect.left)}px`;
      box.style.top = `${Math.round(r.top - pgRect.top)}px`;
      box.style.width = `${Math.round(r.width)}px`;
      box.style.height = `${Math.round(r.height)}px`;
      box.style.border = '2px dashed rgba(255,128,0,0.9)';
      box.style.boxSizing = 'border-box';
      __analyticsDebugOverlay.appendChild(box);

      const label = document.createElement('div');
      label.style.position = 'absolute';
      label.style.left = `${Math.round(r.left - pgRect.left) + 6}px`;
      label.style.top = `${Math.round(r.top - pgRect.top) + 6}px`;
      label.style.background = 'rgba(0,0,0,0.6)';
      label.style.color = '#fff';
      label.style.padding = '2px 6px';
      label.style.fontSize = '12px';
      label.style.borderRadius = '4px';
      const cols = getComputedStyle(rowEl).getPropertyValue('--cols') || 'auto';
      label.textContent = `row ${idx + 1} • cols=${cols}`;
      __analyticsDebugOverlay.appendChild(label);
    });

    // show global 3-column grid guides
    const panelsStyle = getComputedStyle(panelsGrid);
    const gap = parseFloat(panelsStyle.columnGap || panelsStyle.gridColumnGap || '0') || 0;
    const cols = 3;
    const colW = Math.max(0, (pgRect.width - Math.max(0, (cols - 1) * gap)) / cols);
    for (let i = 0; i < cols; i++) {
      const g = document.createElement('div');
      g.style.position = 'absolute';
      g.style.left = `${Math.round(i * (colW + gap))}px`;
      g.style.top = '0';
      g.style.width = `${Math.round(colW)}px`;
      g.style.height = '100%';
      g.style.borderLeft = '1px solid rgba(0,200,150,0.12)';
      g.style.boxSizing = 'border-box';
      __analyticsDebugOverlay.appendChild(g);
    }
  }

  function setAnalyticsDebug(enabled) {
    window.__analyticsDebugEnabled = Boolean(enabled);
    localStorage.setItem('analytics_debug', window.__analyticsDebugEnabled ? '1' : '0');
    const btn = document.getElementById('analytics-debug-toggle-btn');
    if (btn) btn.classList.toggle('active', window.__analyticsDebugEnabled);
    if (!window.__analyticsDebugEnabled) removeDebugOverlay();
  }

  // Debounced relayout helper: when content or size changes (charts render, window resize),
  // re-run applyLayout to reposition any spanning panels. This prevents visual oscillation
  // caused by asynchronous content sizing.
let __relayoutTimer = null;
function scheduleRelayout(delay = 100) {
  if (__relayoutTimer) clearTimeout(__relayoutTimer);
  __relayoutTimer = setTimeout(() => {
    try {
      const next = loadLayout();
      applyLayout(next);
    } catch (err) {
      console.error('Relayout failed', err);
    } finally {
      __relayoutTimer = null;
    }
  }, delay);
}

// --- Admin custom-select enhancer (lightweight copy of app.js's enhancer) ---
const adminCustomSelectControllers = new Map();

function closeAllAdminCustomSelects(exceptId = '') {
  adminCustomSelectControllers.forEach((controller, id) => {
    if (exceptId && id === exceptId) return;
    try { controller.close(); } catch (e) {}
  });
}

function enhanceAdminSelect(selectEl) {
  if (!selectEl || adminCustomSelectControllers.has(selectEl.id)) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  wrapper.dataset.selectId = selectEl.id || '';

  // Autosize analytics selects (keep trigger/menu as wide as their widest option)
  const AUTOSIZE_IDS = new Set(['analytics-timespan-select', 'analytics-user-select', 'analytics-user-timespan-select']);
  if (AUTOSIZE_IDS.has(selectEl.id)) wrapper.classList.add('autosize');

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
      if (idx === activeIndex) optionBtn.classList.add('active');
      menu.appendChild(optionBtn);
    });
  };
  // Defer to a centralized measurement routine for autosize selects.
  if (wrapper.classList.contains('autosize')) {
    try { measureAndApplySelectWidth(selectEl.id); } catch (e) { /* ignore */ }
  }

  const close = () => {
    wrapper.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  };

  const open = () => {
    closeAllAdminCustomSelects(selectEl.id);
    renderMenu();
    wrapper.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    // Do not re-measure on open to avoid flicker/animations; width is
    // measured on init and when options change via `syncAdminCustomSelect`.
  };

  const syncVisibility = () => {
    const hidden = selectEl.style.display === 'none';
    wrapper.style.display = hidden ? 'none' : '';
    if (hidden) close();
  };

  const syncFromNative = () => {
    syncLabel();
    syncVisibility();
    if (wrapper.classList.contains('open')) renderMenu();
  };

  const commitValue = (value) => {
    if (selectEl.value === value) { close(); return; }
    selectEl.value = value;
    syncFromNative();
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };

  trigger.addEventListener('click', () => {
    if (wrapper.classList.contains('open')) { close(); return; }
    open();
  });

  trigger.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!wrapper.classList.contains('open')) { open(); }
      if (!options.length) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + options.length) % options.length;
      renderMenu();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!wrapper.classList.contains('open')) { open(); return; }
      if (activeIndex >= 0 && options[activeIndex]) commitValue(options[activeIndex].value);
    }
  });

  menu.addEventListener('mousedown', e => { e.preventDefault(); });
  menu.addEventListener('click', e => {
    const optionBtn = e.target.closest('.custom-select-option');
    if (!optionBtn) return;
    commitValue(optionBtn.dataset.value || '');
  });

  selectEl.addEventListener('change', syncFromNative);
  adminCustomSelectControllers.set(selectEl.id, { close, open, syncFromNative });
  syncFromNative();
}

// Measure longest option text for a select and apply a fixed width to its
// custom wrapper/menu when in `autosize` mode. Uses canvas text metrics
// so it works even when the menu isn't rendered in the DOM.
function measureAndApplySelectWidth(selectId) {
  try {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const wrapper = sel.nextElementSibling;
    if (!wrapper || !wrapper.classList || !wrapper.classList.contains('custom-select') || !wrapper.classList.contains('autosize')) return;
    const trigger = wrapper.querySelector('.custom-select-trigger');
    const menu = wrapper.querySelector('.custom-select-menu');
    if (!trigger) return;

    const comp = getComputedStyle(trigger);
    const font = `${comp.fontWeight} ${comp.fontSize} ${comp.fontFamily}`;
    const canvas = measureAndApplySelectWidth._canvas || (measureAndApplySelectWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = font;

    let maxTextWidth = 0;
    const opts = Array.from(sel.options || []);
    opts.forEach(o => {
      const text = String(o.textContent || '');
      const w = ctx.measureText(text).width || 0;
      if (w > maxTextWidth) maxTextWidth = w;
    });

    // compute paddings and arrow area
    const padLeft = parseFloat(comp.paddingLeft) || 0;
    const padRight = parseFloat(comp.paddingRight) || 0;
    const arrowEl = trigger.querySelector('.custom-select-arrow');
    const arrowW = arrowEl ? Math.ceil(arrowEl.getBoundingClientRect().width) : 16;
    const buffer = 12; // breathing room

    const final = Math.ceil(maxTextWidth + padLeft + padRight + arrowW + buffer);
    const maxAllowed = Math.max(80, document.documentElement.clientWidth - 32);
    const width = Math.min(final || 0, maxAllowed);
    if (width > 0) {
      wrapper.style.width = `${width}px`;
      if (menu) menu.style.minWidth = `${width}px`;
    }
  } catch (e) { /* ignore measurement errors */ }
}

function syncAdminCustomSelect(selectId) {
  try {
    adminCustomSelectControllers.get(selectId)?.syncFromNative();
  } catch (e) {}
  // Re-measure width in case option set changed after initial render.
  try { measureAndApplySelectWidth(selectId); } catch (e) {}
}

function initAdminCustomSelects() {
  ['analytics-timespan-select', 'analytics-user-select', 'analytics-user-timespan-select'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) enhanceAdminSelect(sel);
  });
  document.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof Element)) { closeAllAdminCustomSelects(); return; }
    const insideCustomSelect = target.closest('.custom-select');
    if (!insideCustomSelect) closeAllAdminCustomSelects();
  });
}

// initialize admin custom selects immediately (admin.html places script at end of body)
try { initAdminCustomSelects(); } catch (e) {}

// Observe size changes on the panels grid and rerun layout when it changes.
try {
  if (typeof ResizeObserver !== 'undefined' && panelsGrid) {
    const ro = new ResizeObserver(() => scheduleRelayout(80));
    ro.observe(panelsGrid);
  }
} catch (e) {
  // ignore if ResizeObserver not available
}

function makePanelEditable(panelEl, layout) {
  if (!panelEl) return;
  // idempotent: add controls if not present, and add resizers
  let controls = panelEl.querySelector('.panel-edit-controls');
  let colBadge = panelEl.querySelector('.panel-edit-badge[data-type="col"]');
  let rowBadge = panelEl.querySelector('.panel-edit-badge[data-type="row"]');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'panel-edit-controls';

    const drag = document.createElement('button');
    drag.className = 'panel-drag-handle';
    drag.title = 'Drag to reorder';
    drag.textContent = '☰';
    controls.appendChild(drag);

    const colDec = document.createElement('button'); colDec.title = 'Decrease column span'; colDec.textContent = '◀';
    colBadge = document.createElement('span'); colBadge.className = 'panel-edit-badge'; colBadge.setAttribute('data-type', 'col');
    const colInc = document.createElement('button'); colInc.title = 'Increase column span'; colInc.textContent = '▶';
    controls.appendChild(colDec); controls.appendChild(colBadge); controls.appendChild(colInc);

    const rowDec = document.createElement('button'); rowDec.title = 'Decrease row span'; rowDec.textContent = '▲';
    rowBadge = document.createElement('span'); rowBadge.className = 'panel-edit-badge'; rowBadge.setAttribute('data-type', 'row');
    const rowInc = document.createElement('button'); rowInc.title = 'Increase row span'; rowInc.textContent = '▼';
    controls.appendChild(rowDec); controls.appendChild(rowBadge); controls.appendChild(rowInc);

    panelEl.appendChild(controls);

    // span handlers
    function updateSpan(deltaCol, deltaRow) {
      const id = panelEl.dataset.panelId;
      const layoutObj = loadLayout();
      const spans = layoutObj.spans[id] || { col: 1, row: 1 };
      spans.col = Math.max(1, Math.min(3, Number(spans.col) + (deltaCol || 0)));
      spans.row = Math.max(1, Math.min(MAX_PANEL_ROW_SPAN, Number(spans.row) + (deltaRow || 0)));
      layoutObj.spans[id] = spans;
      saveLayout(layoutObj);
      applyLayout(layoutObj);
      // update badges
      const cb = panelEl.querySelector('.panel-edit-badge[data-type="col"]');
      const rb = panelEl.querySelector('.panel-edit-badge[data-type="row"]');
      if (cb) cb.textContent = String(spans.col);
      if (rb) rb.textContent = String(spans.row);
    }

    colDec.addEventListener('click', () => updateSpan(-1, 0));
    colInc.addEventListener('click', () => updateSpan(1, 0));
    rowDec.addEventListener('click', () => updateSpan(0, -1));
    rowInc.addEventListener('click', () => updateSpan(0, 1));
  }

  // update badges (in case colSpan/rowSpan were changed)
  if (colBadge) colBadge.textContent = panelEl.dataset.colSpan || '1';
  if (rowBadge) rowBadge.textContent = panelEl.dataset.rowSpan || '1';

  // create resizer handles if missing
  function ensureResizer(dir) {
    if (panelEl.querySelector(`.panel-resizer--${dir}`)) return;
    const r = document.createElement('div');
    r.className = `panel-resizer panel-resizer--${dir}`;
    panelEl.appendChild(r);

    function startResize(e) {
      e.preventDefault();
      e.stopPropagation();
      const panel = panelEl;
      if (!panelsGrid) return;

      // Determine the row context for this panel so column sizing uses the correct grid
      let rowEl = panel.closest('.analytics-row');
      if (!rowEl) {
        const rowStart = Number(panel.dataset.rowStart || 1);
        const rows = panelsGrid.querySelectorAll('.analytics-row');
        rowEl = rows[rowStart - 1] || panelsGrid;
      }

      const columnsPerRow = 3;
      const rowCols = Math.max(1, Number(getComputedStyle(rowEl).getPropertyValue('--cols')) || columnsPerRow);
      const rowRect = rowEl.getBoundingClientRect();
      const rowStyle = getComputedStyle(rowEl);
      const gapX = parseFloat(rowStyle.columnGap || rowStyle.gap || '0') || 0;
      const columnWidth = (rowRect.width - Math.max(0, (rowCols - 1) * gapX)) / Math.max(1, rowCols);
      const initialSpan = Math.max(1, Math.min(rowCols, Number(panel.dataset.colSpan || 1)));
      const startX = e.clientX;
      const startY = e.clientY;
      const initialWidth = panel.getBoundingClientRect().width;
      const initialHeight = panel.getBoundingClientRect().height;

      function onMove(ev) {
        ev.preventDefault();
        if (dir === 'left' || dir === 'right') {
          const dx = (dir === 'left') ? (startX - ev.clientX) : (ev.clientX - startX);
          const dCol = Math.round(dx / Math.max(1, columnWidth));
          let newSpan = Math.max(1, Math.min(rowCols, initialSpan + dCol));

          panel.dataset.colSpan = String(newSpan);
          // If the panel is inside a row grid, update its grid column. Otherwise it's an absolute spanning panel.
          const startCol = Number(panel.dataset.startCol || 1);
          if (panel.closest('.analytics-row')) {
            panel.style.gridColumn = `${startCol} / span ${newSpan}`;
            panel.style.minWidth = `${Math.round(newSpan * columnWidth + Math.max(0, (newSpan - 1) * gapX))}px`;
          } else {
            const panelsRect = panelsGrid.getBoundingClientRect();
            const left = (rowRect.left - panelsRect.left) + (startCol - 1) * (columnWidth + gapX);
            const width = Math.max(0, newSpan * columnWidth + Math.max(0, (newSpan - 1) * gapX));
            panel.style.left = `${Math.round(left)}px`;
            panel.style.width = `${Math.round(width)}px`;
          }
          panel.style.zIndex = 20;
        } else {
          // vertical resize: snap height to exact row multiples and store row span
          const dy = (dir === 'top') ? (startY - ev.clientY) : (ev.clientY - startY);
          const rawHeight = Math.max(80, Math.round(initialHeight + dy));
          const approxRowSpan = Math.max(1, Math.min(MAX_PANEL_ROW_SPAN, Math.round(rawHeight / BASE_ROW_HEIGHT)));
          const snappedHeight = approxRowSpan * BASE_ROW_HEIGHT;
          panel.style.minHeight = `${snappedHeight}px`;
          panel.dataset.rowSpan = String(approxRowSpan);
          const rb = panel.querySelector('.panel-edit-badge[data-type="row"]'); if (rb) rb.textContent = String(approxRowSpan);
        }
      }

      function onUp(ev) {
        ev.preventDefault();
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        // persist change
        try {
          const layoutObj = loadLayout();
          const id = panel.dataset.panelId;
          layoutObj.spans = layoutObj.spans || {};
          layoutObj.spans[id] = layoutObj.spans[id] || {};
          layoutObj.spans[id].col = Number(panel.dataset.colSpan || 1);
          layoutObj.spans[id].row = Number(panel.dataset.rowSpan || 1);
          saveLayout(layoutObj);
          applyLayout(layoutObj);
        } catch (err) {
          console.error('Failed to persist panel resize', err);
        } finally {
          // clear any temporary inline sizing so applyLayout can reflow cleanly
          panel.style.zIndex = '';
          panel.style.minHeight = '';
          panel.style.minWidth = '';
        }
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);

      // store cleanup in case edit mode is disabled mid-resize
      r.__cleanup = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
    }

    r.addEventListener('pointerdown', startResize);
  }

  ensureResizer('left');
  ensureResizer('right');
  ensureResizer('top');
  ensureResizer('bottom');

  // drag behavior: make the panel draggable (click+drag anywhere to move)
  if (!panelEl.hasAttribute('draggable')) panelEl.setAttribute('draggable', 'true');
  if (!panelEl.__dragInitialized) {
    panelEl.addEventListener('dragstart', (e) => {
      try {
        e.dataTransfer.setData('text/panel-id', panelEl.dataset.panelId || '');
      } catch (err) {
        console.error('dragstart setData failed', err);
      }
      panelEl.classList.add('dragging');
    });
    panelEl.addEventListener('dragend', () => panelEl.classList.remove('dragging'));
    panelEl.__dragInitialized = true;
  }
}

function enableEditMode() {
  if (!panelsGrid) return;
  panelsGrid.classList.add('edit-mode');
  panelsGrid.classList.add('editing');
  editLayoutBtn?.setAttribute('aria-pressed', 'true');
  // attach controls to each panel
  const layout = loadLayout();
  applyLayout(layout);
  panelsGrid.querySelectorAll('.analytics-panel').forEach(panel => makePanelEditable(panel, layout));

  // attach coarse drop handlers to panelsGrid (inserts by pointer X position)
  (function attachGridDropHandlers() {
    const onDragOver = function (e) { e.preventDefault(); panelsGrid.classList.add('drag-over'); };
    const onDragLeave = function () { panelsGrid.classList.remove('drag-over'); };
    const onDrop = function (e) {
      e.preventDefault();
      panelsGrid.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/panel-id');
      if (!draggedId) return;
      const layoutObj = loadLayout();
      const oldIndex = layoutObj.order.indexOf(draggedId);
      if (oldIndex !== -1) layoutObj.order.splice(oldIndex, 1);
      const rect = panelsGrid.getBoundingClientRect();
      const insertIndex = Math.max(0, Math.min(layoutObj.order.length, Math.floor(((e.clientX - rect.left) / rect.width) * (layoutObj.order.length + 1))));
      layoutObj.order.splice(insertIndex, 0, draggedId);
      saveLayout(layoutObj);
      applyLayout(layoutObj);
    };

    panelsGrid.addEventListener('dragover', onDragOver);
    panelsGrid.addEventListener('dragleave', onDragLeave);
    panelsGrid.addEventListener('drop', onDrop);
    panelsGrid.__gridDragHandlers = { onDragOver, onDragLeave, onDrop };
  })();
}

function disableEditMode() {
  if (!panelsGrid) return;
  panelsGrid.classList.remove('edit-mode');
  panelsGrid.classList.remove('editing');
  editLayoutBtn?.setAttribute('aria-pressed', 'false');
  // remove controls and draggable attr
  panelsGrid.querySelectorAll('.panel-edit-controls').forEach(c => c.remove());
  // remove resizer handles and cleanup any active handlers
  panelsGrid.querySelectorAll('.panel-resizer').forEach(r => {
    try {
      if (typeof r.__cleanup === 'function') r.__cleanup();
    } catch (e) {}
    r.remove();
  });
  panelsGrid.querySelectorAll('.analytics-panel').forEach(p => {
    p.removeAttribute('draggable');
    p.classList.remove('dragging');
    // clear any temporary resize height set in edit mode
    p.style.minHeight = '';
  });
  // remove panelsGrid drag handlers
  if (panelsGrid && panelsGrid.__gridDragHandlers) {
    panelsGrid.removeEventListener('dragover', panelsGrid.__gridDragHandlers.onDragOver);
    panelsGrid.removeEventListener('dragleave', panelsGrid.__gridDragHandlers.onDragLeave);
    panelsGrid.removeEventListener('drop', panelsGrid.__gridDragHandlers.onDrop);
    delete panelsGrid.__gridDragHandlers;
  }
  if (panelsGrid) panelsGrid.classList.remove('drag-over');
}

if (editLayoutBtn) {
  editLayoutBtn.addEventListener('click', () => {
    const isEditing = panelsGrid?.classList.contains('edit-mode');
    if (isEditing) disableEditMode(); else enableEditMode();
  });
}

// Initialize from saved layout
try {
  const initial = loadLayout();
  // apply initial layout on load (no edit mode)
  applyLayout(initial);
} catch (err) {
  console.error('Failed to init analytics layout', err);
}

dateFormatInput?.addEventListener('change', e => {
  setDateFormatPattern(e.target?.value || '');
});

dateFormatInput?.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  setDateFormatPattern(e.currentTarget?.value || '');
  e.currentTarget.blur();
});

dateFormatResetBtn?.addEventListener('click', () => {
  setDateFormatPattern(DEFAULT_DATE_FORMAT_PATTERN);
});

dateFormatPreset?.addEventListener('change', e => {
  const presetId = String(e.target?.value || '').trim();
  if (presetId === 'custom') {
    dateFormatInput?.focus();
    return;
  }

  const presetPattern = DATE_FORMAT_PRESETS[presetId];
  if (presetPattern) setDateFormatPattern(presetPattern);
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

settingsBtn?.addEventListener('click', () => {
  openSettingsOverlay();
});

settingsCloseBtn?.addEventListener('click', () => {
  closeSettingsOverlay();
});

settingsOverlay?.addEventListener('click', e => {
  if (e.target === settingsOverlay) closeSettingsOverlay();
});

togglePasswordFormBtn?.addEventListener('click', () => {
  const isHidden = changePasswordForm?.classList.contains('is-hidden');
  setPasswordFormVisible(isHidden);
  if (isHidden) currentPasswordInput?.focus();
});

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
    await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });

    setPasswordChangeStatus('✓ Password updated successfully');
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

adminLoginBtn?.addEventListener('click', () => {
  void logoutCurrentUser(adminLoginBtn);
});

applyDateFormatMode();

void bootstrapAdminSession().catch(err => {
  setAdminStatus(`Authentication failed: ${err.message}`);
});

// Wire debug toggle button (non-invasive)
const debugToggleBtn = document.getElementById('analytics-debug-toggle-btn');
if (debugToggleBtn) {
  debugToggleBtn.addEventListener('click', () => {
    setAnalyticsDebug(!window.__analyticsDebugEnabled);
    try { scheduleRelayout(40); } catch (e) {}
  });
  // reflect stored state
  if (window.__analyticsDebugEnabled) setAnalyticsDebug(true);
}
