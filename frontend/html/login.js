const API = '/api';

const THEME_MODES = ['light', 'dark', 'oled'];

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

function setAuthStorage(token, username, isAdmin) {
  localStorage.setItem('authToken', token);
  localStorage.setItem('authUsername', username || '');
  localStorage.setItem('authIsAdmin', isAdmin ? 'true' : 'false');
}

function clearAuthStorage() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUsername');
  localStorage.removeItem('authIsAdmin');
}

function redirectToHome(isAdmin) {
  window.location.href = isAdmin ? 'admin.html' : 'index.html';
}

async function fetchAuthMe(token) {
  const response = await fetch(`${API}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to load profile (${response.status})`);
  }

  return response.json();
}

async function resolveAndRedirectWithToken(token) {
  const me = await fetchAuthMe(token);
  const isAdmin = Boolean(me.is_admin);
  const username = String(me.username || '').trim();
  const forcePasswordChange = Boolean(me.force_password_change);
  
  setAuthStorage(token, username, isAdmin);
  
  if (forcePasswordChange) {
    showForcedPasswordChangeModal(token);
  } else {
    redirectToHome(isAdmin);
  }
}

async function showForcedPasswordChangeModal(token) {
  const modal = document.getElementById('force-password-change-modal');
  const form = document.getElementById('force-password-change-form');
  const passwordInput = document.getElementById('force-new-password');
  const confirmInput = document.getElementById('force-confirm-password');
  const status = document.getElementById('force-password-status');
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!modal || !form) return;

  modal.classList.remove('hidden');

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const newPassword = String(passwordInput.value || '');
    const confirmPassword = String(confirmInput.value || '');

    if (!newPassword || newPassword.length < 8) {
      status.innerHTML = '<span class="error">x New password must be at least 8 characters</span>';
      return;
    }

    if (newPassword !== confirmPassword) {
      status.innerHTML = '<span class="error">x New passwords do not match</span>';
      return;
    }

    try {
      status.innerHTML = '<span class="loading">Updating password...</span>';
      submitBtn.disabled = true;

      // Fetch salt & iterations and derive new password locally
      const paramsResp = await fetch(`${API}/auth/password-params`, { headers: { Authorization: `******` } });
      if (!paramsResp.ok) throw new Error('Failed to get password parameters');
      const params = await paramsResp.json();
      const iterations = Number(params?.iterations || 240000);
      const enc = new TextEncoder();
      const pwBuf = enc.encode(newPassword);
      const newSalt = new Uint8Array(16);
      crypto.getRandomValues(newSalt);
      const newSaltHex = Array.from(newSalt).map(b => b.toString(16).padStart(2, '0')).join('');
      const key = await crypto.subtle.importKey('raw', pwBuf, { name: 'PBKDF2' }, false, ['deriveBits']);
      const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: newSalt, iterations }, key, 256);
      const arr = new Uint8Array(derivedBits);
      const newDerivedHex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');

      const response = await fetch(`${API}/auth/enforce-password-change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ new_password_salt: newSaltHex, new_password_derived: newDerivedHex }),
      });

      if (!response.ok) {
        const errorMessage = await response.text();
        status.innerHTML = `<span class="error">x ${errorMessage || 'Failed to change password'}</span>`;
        submitBtn.disabled = false;
        return;
      }

      status.innerHTML = '<span class="success">Password updated successfully</span>';
      modal.classList.add('hidden');
      const isAdmin = localStorage.getItem('authIsAdmin') === 'true';
      redirectToHome(isAdmin);
    } catch (error) {
      status.innerHTML = `<span class="error">x ${error.message}</span>`;
      submitBtn.disabled = false;
    }
  });
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

const authModeLoginBtn = document.getElementById('auth-mode-login-btn');
const authModeRegisterBtn = document.getElementById('auth-mode-register-btn');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authFootnote = document.getElementById('auth-footnote');
const authPasswordHint = document.getElementById('auth-password-hint');
const authConfirmWrap = document.getElementById('auth-confirm-wrap');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authPasswordConfirm = document.getElementById('auth-password-confirm');
const authStatus = document.getElementById('auth-status');
const submitBtn = authForm.querySelector('button[type="submit"]');

let authMode = 'login';

function applyAuthMode() {
  const isLogin = authMode === 'login';
  authTitle.textContent = isLogin ? 'Sign In' : 'Create Account';
  authSubtitle.textContent = isLogin
    ? 'Use your account to access your own saves.'
    : 'Create an account to keep your saves private.';
  submitBtn.textContent = isLogin ? 'Sign In' : 'Register';
  authFootnote.textContent = isLogin
    ? 'New here? Switch to Register above to create your account.'
    : 'Already have an account? Switch to Sign In above.';
  authPassword.autocomplete = isLogin ? 'current-password' : 'new-password';
  authPassword.placeholder = 'Password';
  authPasswordHint.style.display = isLogin ? 'none' : 'block';
  authConfirmWrap.style.display = isLogin ? 'none' : 'flex';
  authPasswordConfirm.required = !isLogin;
  authPasswordConfirm.autocomplete = 'new-password';
  if (isLogin) authPasswordConfirm.value = '';
  authModeLoginBtn.classList.toggle('active', isLogin);
  authModeLoginBtn.setAttribute('aria-selected', isLogin ? 'true' : 'false');
  authModeRegisterBtn.classList.toggle('active', !isLogin);
  authModeRegisterBtn.setAttribute('aria-selected', isLogin ? 'false' : 'true');
}

authModeLoginBtn.addEventListener('click', () => {
  authMode = 'login';
  authStatus.textContent = '';
  applyAuthMode();
});

authModeRegisterBtn.addEventListener('click', () => {
  authMode = 'register';
  authStatus.textContent = '';
  applyAuthMode();
});

authForm.addEventListener('submit', async e => {
  e.preventDefault();

  const username = authUsername.value.trim();
  const password = authPassword.value;

  if (!username || username.length < 3) {
    authStatus.innerHTML = '<span class="error">x Username must be at least 3 characters</span>';
    return;
  }

  if (!password || password.length < 8) {
    authStatus.innerHTML = '<span class="error">x Password must be at least 8 characters</span>';
    return;
  }

  if (authMode === 'register' && password !== authPasswordConfirm.value) {
    authStatus.innerHTML = '<span class="error">x Passwords do not match</span>';
    return;
  }

  try {
    authStatus.innerHTML = authMode === 'login'
      ? '<span class="loading">Signing in...</span>'
      : '<span class="loading">Creating account...</span>';

    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
    const response = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const errorMessage = await response.text();
      authStatus.innerHTML = `<span class="error">x ${errorMessage || 'Authentication failed'}</span>`;
      return;
    }

    const data = await response.json();
    if (!data.token) {
      authStatus.innerHTML = '<span class="error">x Server did not return authentication token</span>';
      return;
    }

    await resolveAndRedirectWithToken(data.token);
  } catch (error) {
    clearAuthStorage();
    authStatus.innerHTML = `<span class="error">x ${error.message}</span>`;
  }
});

localStorage.removeItem('token');
const existingToken = localStorage.getItem('authToken');
if (existingToken) {
  authStatus.innerHTML = '<span class="loading">Checking session...</span>';
  void resolveAndRedirectWithToken(existingToken).catch(() => {
    clearAuthStorage();
    authStatus.textContent = '';
  });
}
