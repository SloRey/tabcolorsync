function parseRgbaString(str) {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  return {
    r: +m[1],
    g: +m[2],
    b: +m[3],
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

function compositeOver(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (top.a * top.r + bottom.a * (1 - top.a) * bottom.r) / a,
    g: (top.a * top.g + bottom.a * (1 - top.a) * bottom.g) / a,
    b: (top.a * top.b + bottom.a * (1 - top.a) * bottom.b) / a,
    a,
  };
}

const DEBUG = false;

function getPageColorViaCompositing() {
  const centerX = window.innerWidth / 2;
  const stack = document.elementsFromPoint(centerX, 3);

  const qualifying = stack.filter(
    (el) =>
      el instanceof HTMLElement &&
      el.offsetWidth >= window.innerWidth * 0.9 &&
      el.offsetHeight >= 20
  );

  let accumulated = { r: 0, g: 0, b: 0, a: 0 };
  let foundAny = false;

  const debugLayers = DEBUG ? [] : null;

  for (const el of [...qualifying, document.body, document.documentElement]) {
    const style = getComputedStyle(el);
    const bg = parseRgbaString(style.backgroundColor);
    let c = null;
    if (bg) {
      const cssOpacity = parseFloat(style.opacity);
      const elementOpacity = isNaN(cssOpacity) ? 1 : cssOpacity;
      const effectiveAlpha = bg.a * elementOpacity;
      if (effectiveAlpha !== 0) c = { r: bg.r, g: bg.g, b: bg.b, a: effectiveAlpha };
    }

    if (DEBUG) {
      debugLayers.push({
        tag: el.tagName,
        id: el.id || null,
        class: (el.className && typeof el.className === 'string') ? el.className.slice(0, 60) : null,
        rect: `${el.offsetWidth}x${el.offsetHeight}`,
        bg: style.backgroundColor,
        cssOpacity: style.opacity,
        contributedColor: c,
      });
    }

    if (!c) continue;
    foundAny = true;
    accumulated = compositeOver(accumulated, c);
    if (accumulated.a >= 0.999) break;
  }

  if (DEBUG) {
    console.log('[TabColorSync] layer stack at sample point:', debugLayers);
    console.log('[TabColorSync] composited result:', accumulated);
  }

  if (!foundAny || accumulated.a === 0) return null;
  return { r: Math.round(accumulated.r), g: Math.round(accumulated.g), b: Math.round(accumulated.b) };
}

function getThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta || !meta.content) return null;
  const hexMatch = meta.content.trim();
  if (/^#([0-9a-f]{3}){1,2}$/i.test(hexMatch)) {
    const hex = hexMatch.length === 4
      ? '#' + [...hexMatch.slice(1)].map(c => c + c).join('')
      : hexMatch;
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }
  const rgba = parseRgbaString(hexMatch);
  return rgba ? { r: rgba.r, g: rgba.g, b: rgba.b } : null;
}

function getPageColor() {
  const composited = getPageColorViaCompositing();
  if (composited) return composited;

  const theme = getThemeColor();
  if (theme) return theme;

  return null;
}

let lastReported = null;
let dispatchTimeout = null;
let lastSentAt = 0;
const THROTTLE_MS = 400;

function reportColorNow() {
  if (document.visibilityState !== 'visible') return;
  const color = getPageColor();
  if (
    color && lastReported &&
    color.r === lastReported.r && color.g === lastReported.g && color.b === lastReported.b
  ) {
    return;
  }
  lastReported = color;
  lastSentAt = Date.now();
  chrome.runtime.sendMessage({ type: 'PAGE_COLOR', color });
}

function reportColor() {
  clearTimeout(dispatchTimeout);
  const remaining = THROTTLE_MS + lastSentAt - Date.now();
  if (remaining <= 0) {
    reportColorNow();
  } else {
    dispatchTimeout = setTimeout(reportColorNow, remaining);
  }
}

function reportColorRequiresFocus() {
  if (document.hasFocus()) reportColor();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'REQUEST_COLOR') {
    lastReported = null;
    reportColorNow();
  }
});

['click', 'resize', 'scroll', 'visibilitychange'].forEach((event) =>
  document.addEventListener(event, reportColor, { passive: true })
);
['transitionend', 'transitioncancel', 'animationend', 'animationcancel'].forEach((event) =>
  document.addEventListener(event, reportColorRequiresFocus, { passive: true })
);

const metaThemeColorObserver = new MutationObserver(reportColor);
const metaTagObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLMetaElement && node.name === 'theme-color') {
        reportColor();
        metaThemeColorObserver.observe(node, { attributes: true });
      }
    });
  });
});

document.querySelectorAll('meta[name="theme-color"]').forEach((tag) =>
  metaThemeColorObserver.observe(tag, { attributes: true })
);
if (document.head) metaTagObserver.observe(document.head, { childList: true });

reportColorNow();
setTimeout(() => {
  lastReported = null;
  reportColorNow();
}, 1000);
