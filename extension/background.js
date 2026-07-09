const SERVICE_URL = 'http://127.0.0.1:8765/color';
const RESET_URL = 'http://127.0.0.1:8765/reset';
const STORAGE_KEY = 'tabColors';
const DEFAULT_ADJUSTMENTS = { hue: 0, saturation: 0, brightness: 0 };

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function applyBrightness(color, percentage) {
  const cent = percentage / 100;
  if (cent > 1) return { r: 255, g: 255, b: 255 };
  if (cent > 0) {
    return {
      r: cent * 255 + (1 - cent) * color.r,
      g: cent * 255 + (1 - cent) * color.g,
      b: cent * 255 + (1 - cent) * color.b,
    };
  }
  if (cent === 0) return color;
  if (cent >= -1) {
    return {
      r: (cent + 1) * color.r,
      g: (cent + 1) * color.g,
      b: (cent + 1) * color.b,
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function applyAdjustments(color, adjustments) {
  if (!color) return color;
  const { hue, saturation, brightness } = adjustments;

  let result = color;
  if (hue !== 0 || saturation !== 0) {
    const hsv = rgbToHsv(result.r, result.g, result.b);
    const newH = ((hsv.h + hue) % 360 + 360) % 360;
    const newS = Math.max(0, Math.min(1, hsv.s + saturation / 100));
    result = hsvToRgb(newH, newS, hsv.v);
  }
  if (brightness !== 0) {
    const adjusted = applyBrightness(result, brightness);
    result = {
      r: Math.round(adjusted.r),
      g: Math.round(adjusted.g),
      b: Math.round(adjusted.b),
    };
  }
  return result;
}

function hostnameFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function getSettings() {
  return chrome.storage.local.get({
    enabled: true,
    adjustments: DEFAULT_ADJUSTMENTS,
    siteAdjustments: {},
    browserOverride: '',
  });
}

function resolveAdjustments(settings, hostname) {
  if (hostname && settings.siteAdjustments[hostname]) {
    return settings.siteAdjustments[hostname];
  }
  return settings.adjustments;
}

function resolveBrowser(settings) {
  return settings.browserOverride || null;
}

async function sendColorToService(color, hostname, settings = null) {
  if (!color) return;
  const s = settings || (await getSettings());
  const browser = resolveBrowser(s);
  if (!browser) return;
  const adjustments = resolveAdjustments(s, hostname);
  const adjusted = applyAdjustments(color, adjustments);
  fetch(SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ r: adjusted.r, g: adjusted.g, b: adjusted.b, browser }),
  }).catch(() => {});
}

async function sendReset() {
  const s = await getSettings();
  const browser = resolveBrowser(s);
  if (!browser) return;
  return fetch(RESET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browser }),
  }).catch(() => {});
}

async function getTabColors() {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function setTabColor(tabId, color) {
  const colors = await getTabColors();
  colors[tabId] = color;
  await chrome.storage.session.set({ [STORAGE_KEY]: colors });
}

async function deleteTabColor(tabId) {
  const colors = await getTabColors();
  delete colors[tabId];
  await chrome.storage.session.set({ [STORAGE_KEY]: colors });
}

function canAccessTab(url) {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

function isNewTabPage(url) {
  if (!url) return false;
  return (
    url.startsWith('chrome://newtab') ||
    url.startsWith('chrome://new-tab-page') ||
    url.startsWith('brave://newtab') ||
    url.startsWith('brave://new-tab-page') ||
    url.startsWith('edge://newtab') ||
    url.startsWith('edge://new-tab-page')
  );
}

const ntpReloadedTabs = new Set();

let latestRequestId = 0;

async function applyTabColor(tab) {
  if (!tab) return;
  const requestId = ++latestRequestId;

  const settings = await getSettings();
  if (!settings.enabled) return;
  if (requestId !== latestRequestId) return;

  if (!canAccessTab(tab.url)) {
    await sendReset();
    if (requestId !== latestRequestId) return;

    if (isNewTabPage(tab.url) && !ntpReloadedTabs.has(tab.id)) {
      ntpReloadedTabs.add(tab.id);
      chrome.tabs.reload(tab.id).catch(() => {});
    }
    return;
  }

  ntpReloadedTabs.delete(tab.id);

  const colors = await getTabColors();
  if (requestId !== latestRequestId) return;

  const cached = colors[tab.id];
  if (cached) {
    sendColorToService(cached, hostnameFromUrl(tab.url), settings);
  } else {
    chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_COLOR' }).catch(() => {});
  }
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await applyTabColor(tab);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PAGE_COLOR' && sender.tab) {
    setTabColor(sender.tab.id, msg.color);
    getSettings().then((settings) => {
      if (!settings.enabled) return;
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([activeTab]) => {
        if (activeTab && activeTab.id === sender.tab.id) {
          sendColorToService(msg.color, hostnameFromUrl(sender.tab.url), settings);
        }
      });
    });
  } else if (msg.type === 'SET_ENABLED') {
    if (msg.enabled) {
      refreshActiveTab();
    } else {
      sendReset();
    }
  } else if (msg.type === 'ADJUSTMENTS_CHANGED') {
    refreshActiveTab();
  } else if (msg.type === 'GET_CURRENT_COLOR') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) return sendResponse({ detected: null, adjusted: null });
      const colors = await getTabColors();
      const detected = colors[tab.id] || null;
      const settings = await getSettings();
      const adjustments = resolveAdjustments(settings, hostnameFromUrl(tab.url));
      const adjusted = detected ? applyAdjustments(detected, adjustments) : null;
      sendResponse({ detected, adjusted });
    })();
    return true;
  } else if (msg.type === 'GET_BROWSER_INFO') {
    (async () => {
      const settings = await getSettings();
      sendResponse({ override: settings.browserOverride });
    })();
    return true;
  } else if (msg.type === 'SET_BROWSER_OVERRIDE') {
    chrome.storage.local.set({ browserOverride: msg.override || '' }).then(() => {
      refreshActiveTab();
    });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await applyTabColor(tab);
  } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.active) return;
  try {
    const win = await chrome.windows.get(tab.windowId);
    if (!win.focused) return;
  } catch {
    return;
  }
  await applyTabColor(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  deleteTabColor(tabId);
  ntpReloadedTabs.delete(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  refreshActiveTab();
});

chrome.runtime.onInstalled.addListener(refreshActiveTab);
chrome.runtime.onStartup.addListener(refreshActiveTab);

refreshActiveTab();
