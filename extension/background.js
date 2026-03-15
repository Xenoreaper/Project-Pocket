const DEFAULT_SERVER = 'http://localhost:3000';
const SAVE_MENU_ID = 'project-pocket-save-page';
const actionApi = chrome.action || chrome.browserAction;

function getServerUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl'], result => {
      resolve((result.serverUrl || DEFAULT_SERVER).trim().replace(/\/$/, ''));
    });
  });
}

function getPlatformName() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown OS';
}

function getBrowserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Browser';
}

function getDeviceLabel() {
  return `${getBrowserName()} extension on ${getPlatformName()}`;
}

function isMusicUrl(rawUrl) {
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
    return exactHosts.has(host) || suffixHosts.some(suffix => host.endsWith(suffix));
  } catch {
    return false;
  }
}

function setBadge(text, color) {
  if (!actionApi) return;
  actionApi.setBadgeBackgroundColor({ color });
  actionApi.setBadgeText({ text });
}

function clearBadgeAfter(ms) {
  if (!actionApi) return;
  setTimeout(() => actionApi.setBadgeText({ text: '' }), ms);
}

async function savePageToPocket(url, title = '') {
  const serverUrl = await getServerUrl();
  const response = await fetch(`${serverUrl}/api/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      title: title || '',
      is_music: isMusicUrl(url),
      device: getDeviceLabel(),
      saved_via: 'extension',
    }),
  });

  if (!response.ok) {
    throw new Error(`Server error ${response.status}`);
  }
}

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SAVE_MENU_ID,
      title: 'Save to Project Pocket',
      contexts: ['page'],
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup.addListener(ensureContextMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== SAVE_MENU_ID) return;

  const url = info.pageUrl || tab?.url || '';
  const title = tab?.title || '';

  if (!/^https?:\/\//i.test(url)) {
    setBadge('!', '#c53d4f');
    return;
  }

  try {
    await savePageToPocket(url, title);
    setBadge('✓', '#2f8f5b');
    clearBadgeAfter(1800);
  } catch {
    setBadge('!', '#c53d4f');
    clearBadgeAfter(2200);
  }
});
