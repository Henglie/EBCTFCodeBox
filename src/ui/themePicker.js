export const THEME_VARIANTS = [
  { id: "google-blue", zh: "谷歌蓝", en: "Google Blue", dark: true, series: "m3", swatch: ["#a8c7fa", "#10141b"] },
  { id: "evergreen", zh: "常青", en: "Evergreen", dark: true, series: "m3", swatch: ["#9cd9a3", "#0d130e"] },
  { id: "lavender", zh: "薰衣草", en: "Lavender", dark: false, series: "m3", swatch: ["#6750a4", "#fef7ff"] },
  { id: "sunny", zh: "暖阳", en: "Sunny", dark: false, series: "m3", swatch: ["#745b00", "#fff8f1"] },
  { id: "graphite", zh: "石墨", en: "Graphite", dark: true, series: "m3", swatch: ["#c3c7cf", "#101214"] },
  { id: "obsidian-gold", zh: "曜金 VIP", en: "Obsidian Gold", dark: true, series: "cn", swatch: ["#e6cb8f", "#121009"] },
  { id: "celadon-night", zh: "夜青瓷", en: "Celadon Night", dark: true, series: "cn", swatch: ["#b3e4d9", "#0d1515"] },
  { id: "imperial-violet", zh: "紫檀", en: "Imperial Violet", dark: true, series: "cn", swatch: ["#dccbf7", "#14101a"] },
  { id: "pine-ink", zh: "松烟", en: "Pine Ink", dark: true, series: "cn", swatch: ["#badbb4", "#0f140f"] },
  { id: "rice-paper", zh: "宣纸", en: "Rice Paper", dark: false, series: "cn", swatch: ["#f7f1e5", "#7c4a21"] },
];
export function themeVariant(id) { return THEME_VARIANTS.find(theme => theme.id === id); }
