const ACCENT = "#8f3d33";

function fallbackTheme() {
  let dark = true;
  try { dark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch {}
  return {
    mode: dark ? "dark" : "light",
    background: dark ? "#141110" : "#fff8f5",
    text: dark ? "#f2e6e2" : "#241a17",
    accent: ACCENT,
    border: dark ? "#59443f" : "#e0c9c2",
    locale: "zh-CN",
    reducedMotion: false,
    viewport: { width: 0, height: 0 },
  };
}

let createMockSdk = null;

if (__MAPP_DEV__) {
  createMockSdk = () => {
    const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listeners = new Set();
    const mem = new Map();
    const readNative = (k) => {
      try { return window.localStorage.getItem(k); } catch { return mem.has(k) ? mem.get(k) : null; }
    };
    const writeNative = (k, v) => {
      try { window.localStorage.setItem(k, v); } catch { mem.set(k, v); }
    };
    const removeNative = (k) => {
      try { window.localStorage.removeItem(k); } catch { mem.delete(k); }
    };
    const theme = () => ({
      mode: themeQuery.matches ? "dark" : "light",
      background: themeQuery.matches ? "#141110" : "#fff8f5",
      text: themeQuery.matches ? "#f2e6e2" : "#241a17",
      accent: ACCENT,
      border: themeQuery.matches ? "#59443f" : "#e0c9c2",
      locale: "zh-CN",
      reducedMotion: motionQuery.matches,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    const emit = () => {
      const t = theme();
      for (const fn of listeners) { try { fn(t); } catch {} }
    };
    themeQuery.addEventListener("change", emit);
    motionQuery.addEventListener("change", emit);
    window.addEventListener("resize", emit);
    return {
      __mock: true,
      ready: Promise.resolve(),
      permissions: { has: () => true, list: () => [] },
      lifecycle: { ready: async () => {} },
      theme: { get: async () => theme(), onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
      localStorage: {
        getItem: async (k) => readNative(k),
        setItem: async (k, v) => writeNative(k, String(v)),
        removeItem: async (k) => removeNative(k),
        clear: async () => { try { window.localStorage.clear(); } catch { mem.clear(); } },
      },
      clipboard: {
        readText: async () => {
          if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error("当前环境不支持读取剪贴板");
          return navigator.clipboard.readText();
        },
        writeText: async (t) => {
          if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("当前环境不支持写入剪贴板");
          return navigator.clipboard.writeText(t);
        },
      },
    };
  };
}

let sdk = null;
let real = false;

export async function initSdk() {
  const injected = globalThis.miniApp && typeof globalThis.miniApp === "object" ? globalThis.miniApp : null;
  if (injected) {
    sdk = injected;
    real = true;
    try { await Promise.race([sdk.ready, new Promise((r) => setTimeout(r, 4000))]); } catch {}
  } else if (createMockSdk) {
    sdk = createMockSdk();
    real = false;
    try { await sdk.ready; } catch {}
  } else {
    throw new Error("请从 Linux.do 微应用入口打开");
  }
  return sdk;
}

export function getSdk() {
  return sdk;
}

export function isRealSdk() {
  return real;
}

export async function getTheme() {
  try {
    if (sdk && sdk.theme) return await sdk.theme.get();
  } catch {}
  return fallbackTheme();
}

export function onThemeChange(fn) {
  try {
    if (sdk && sdk.theme && sdk.theme.onChange) return sdk.theme.onChange(fn);
  } catch {}
  return () => {};
}

export async function lifecycleReady() {
  try {
    if (sdk && sdk.lifecycle && sdk.lifecycle.ready) await sdk.lifecycle.ready();
  } catch {}
}

export async function loadAssetUrl(path, mime = "image/png") {
  try {
    const bytes = await sdk.assets.readBytes(path);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}
