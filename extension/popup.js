const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const swatchDetected = document.getElementById('swatchDetected');
const swatchFinal = document.getElementById('swatchFinal');

const hueSlider = document.getElementById('hue');
const satSlider = document.getElementById('saturation');
const brightSlider = document.getElementById('brightness');
const hueValue = document.getElementById('hueValue');
const satValue = document.getElementById('satValue');
const brightValue = document.getElementById('brightValue');
const resetBtn = document.getElementById('resetAdjust');
const clearSiteBtn = document.getElementById('clearSiteOverride');

const modeGlobalTab = document.getElementById('modeGlobal');
const modeSiteTab = document.getElementById('modeSite');
const siteNameEl = document.getElementById('siteName');
const overrideBadge = document.getElementById('overrideBadge');

const browserSelect = document.getElementById('browserSelect');
const browserStatus = document.getElementById('browserStatus');

const BROWSER_LABELS = { brave: 'Brave', chrome: 'Chrome', edge: 'Edge' };

const DEFAULT_ADJUSTMENTS = { hue: 0, saturation: 0, brightness: 0 };

let currentHostname = null;
let mode = 'global';

function rgbCss(c) {
  return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : '#ccc';
}

function render(enabled) {
  toggle.checked = enabled;
  status.textContent = enabled
    ? 'Active -- recoloring the toolbar per tab.'
    : 'Off -- theme reverted to default.';
}

function renderSliders(adjustments) {
  hueSlider.value = adjustments.hue;
  satSlider.value = adjustments.saturation;
  brightSlider.value = adjustments.brightness;
  hueValue.textContent = `${adjustments.hue}°`;
  satValue.textContent = adjustments.saturation;
  brightValue.textContent = adjustments.brightness;
}

function renderSwatches(detected, adjusted) {
  swatchDetected.style.background = rgbCss(detected);
  swatchFinal.style.background = rgbCss(adjusted);
}

function renderMode(hasSiteOverride) {
  modeGlobalTab.classList.toggle('active', mode === 'global');
  modeSiteTab.classList.toggle('active', mode === 'site');
  siteNameEl.textContent = currentHostname || '';
  overrideBadge.textContent = hasSiteOverride ? 'Site override active' : '';
  clearSiteBtn.style.display = mode === 'site' && hasSiteOverride ? 'block' : 'none';
}

function getSlidersAsAdjustments() {
  return {
    hue: parseInt(hueSlider.value, 10),
    saturation: parseInt(satSlider.value, 10),
    brightness: parseInt(brightSlider.value, 10),
  };
}

async function getStorage() {
  return chrome.storage.local.get({
    enabled: true,
    adjustments: DEFAULT_ADJUSTMENTS,
    siteAdjustments: {},
  });
}

async function loadAndRenderForMode() {
  const { adjustments, siteAdjustments } = await getStorage();
  const hasSiteOverride = !!(currentHostname && siteAdjustments[currentHostname]);

  if (mode === 'site' && hasSiteOverride) {
    renderSliders(siteAdjustments[currentHostname]);
  } else if (mode === 'site') {
    renderSliders(adjustments);
  } else {
    renderSliders(adjustments);
  }
  renderMode(hasSiteOverride);
}

function refreshSwatches() {
  chrome.runtime.sendMessage({ type: 'GET_CURRENT_COLOR' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    renderSwatches(response.detected, response.adjusted);
  });
}

async function saveCurrentSliders() {
  const values = getSlidersAsAdjustments();
  if (mode === 'global') {
    await chrome.storage.local.set({ adjustments: values });
  } else if (mode === 'site' && currentHostname) {
    const { siteAdjustments } = await getStorage();
    siteAdjustments[currentHostname] = values;
    await chrome.storage.local.set({ siteAdjustments });
  }
  chrome.runtime.sendMessage({ type: 'ADJUSTMENTS_CHANGED' });
  refreshSwatches();
  const { siteAdjustments } = await getStorage();
  renderMode(!!(currentHostname && siteAdjustments[currentHostname]));
}

function renderBrowserInfo(override) {
  browserSelect.value = override || '';
  if (override) {
    browserStatus.textContent = `Using: ${BROWSER_LABELS[override] || override}`;
    browserStatus.classList.remove('warning');
  } else {
    browserStatus.textContent = 'Browser not selected';
    browserStatus.classList.add('warning');
  }
}

function refreshBrowserInfo() {
  chrome.runtime.sendMessage({ type: 'GET_BROWSER_INFO' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    renderBrowserInfo(response.override);
  });
}

browserSelect.addEventListener('change', () => {
  const override = browserSelect.value;
  chrome.runtime.sendMessage({ type: 'SET_BROWSER_OVERRIDE', override }, () => {
    refreshBrowserInfo();
    refreshSwatches();
  });
});

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url) {
      try { currentHostname = new URL(tab.url).hostname; } catch { currentHostname = null; }
    }

    const { enabled, siteAdjustments } = await getStorage();
    render(enabled);

    if (currentHostname && siteAdjustments[currentHostname]) {
      mode = 'site';
    }

    await loadAndRenderForMode();
    refreshSwatches();
    refreshBrowserInfo();
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
})();

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ enabled }, () => {
    render(enabled);
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled });
    refreshSwatches();
  });
});

modeGlobalTab.addEventListener('click', async () => {
  mode = 'global';
  await loadAndRenderForMode();
});
modeSiteTab.addEventListener('click', async () => {
  mode = 'site';
  await loadAndRenderForMode();
});

[hueSlider, satSlider, brightSlider].forEach((el) =>
  el.addEventListener('input', () => {
    hueValue.textContent = `${hueSlider.value}°`;
    satValue.textContent = satSlider.value;
    brightValue.textContent = brightSlider.value;
    saveCurrentSliders();
  })
);

resetBtn.addEventListener('click', async () => {
  renderSliders(DEFAULT_ADJUSTMENTS);
  if (mode === 'global') {
    await chrome.storage.local.set({ adjustments: DEFAULT_ADJUSTMENTS });
  } else if (currentHostname) {
    const { siteAdjustments } = await getStorage();
    delete siteAdjustments[currentHostname];
    await chrome.storage.local.set({ siteAdjustments });
  }
  chrome.runtime.sendMessage({ type: 'ADJUSTMENTS_CHANGED' });
  refreshSwatches();
  renderMode(false);
});

clearSiteBtn.addEventListener('click', async () => {
  if (!currentHostname) return;
  const { siteAdjustments } = await getStorage();
  delete siteAdjustments[currentHostname];
  await chrome.storage.local.set({ siteAdjustments });
  await loadAndRenderForMode();
  chrome.runtime.sendMessage({ type: 'ADJUSTMENTS_CHANGED' });
  refreshSwatches();
});
