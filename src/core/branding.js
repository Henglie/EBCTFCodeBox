export const APP_CODE = 'EBCrypto';
export const LOCAL_APP_NAME = '码小妹';
const LOCAL_BRAND_LOCALES = new Set(['zh', 'ja', 'ko', 'bo', 'ug', 'za-latn', 'mn-mong']);
const QUOTE_LOCALES = new Set(['zh', 'bo', 'ug', 'za-latn', 'mn-mong']);
const localeKey = value => String(value || 'zh').toLowerCase();
export function defaultAppName(locale) {
  const key = localeKey(locale);
  return LOCAL_BRAND_LOCALES.has(key) || /^(zh|ja|ko)-/.test(key) ? LOCAL_APP_NAME : APP_CODE;
}
export function displayAppName(locale, license) {
  return license?.verified && typeof license.appName === 'string' && license.appName.trim()
    ? license.appName.trim() : defaultAppName(locale);
}
export const LOCAL_QUOTE = Object.freeze({
  text: '往后看五年，甚至十年，未来我们中国的信安和网安的娃娃，买国产电脑，用国产系统，装国产工具，搞国产密码，打国产比赛.......我们这些基础工具更要努力了。',
  attribution: '——2026年11月EternalBlaze在社群发表重要讲话',
});
export function showLocalQuote(locale) { return QUOTE_LOCALES.has(localeKey(locale)); }
export function localizedManifest(manifest, locale, license, baseUrl) {
  const copy = { ...manifest, name: displayAppName(locale, license), short_name: displayAppName(locale, license), lang: locale,
    dir: ['ar', 'he', 'fa', 'ur', 'ug'].includes(localeKey(locale)) ? 'rtl' : 'ltr' };
  for (const key of ['start_url', 'scope', 'id']) if (copy[key]) copy[key] = new URL(copy[key], baseUrl).href;
  if (copy.icons) copy.icons = copy.icons.map(item => ({ ...item, src: new URL(item.src, baseUrl).href }));
  return copy;
}
