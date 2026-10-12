// GPS/地理编码组 — DMS/geohash/Plus Code(OLC)/Maidenhead/UTM 双向互转
//
// 红线：算法照公开规范实现未编造：
// - geohash: geohash.org 公开算法（base32 表 "0123456789bcdefghjkmnpqrstuvwxyz"，去 a/i/l/o）
// - Plus Code (OLC): Google Open Location Code 规范（字母表 "23456789CFGHJMPQRVWX"，20 字符）
// - Maidenhead: IARU Region 1 VHF Handbook（field 18°/格×20格经度、9°/格×10格纬度 → 但实际为经度20°×18格、纬度10°×18格字母A-R；square 2°/1° 数字0-9；subsquare 5'/2.5' 字母a-x）
// - UTM: WGS84 椭球 + 标准 Snyder 公式（USGS "Map Projections - A Working Manual"）
// 注册契约：见 T2 回执。cat:'radix'，每 op encode+decode 双向。
// i18n key（请 M 并入 zh.js/en.js 防抢）：
// op.geoDms.name / op.geoHash.name / op.geoPlusCode.name / op.geoMaidenhead.name / op.geoUtm.name

import { register } from "./registry.js";

// ============ 通用：解析 "lat, lon" 输入 ============
function parseLatLon(text) {
  const s = String(text).trim();
 // 支持 "lat,lon" / "lat, lon" / "lat lon"（空格分隔）
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`非法坐标格式，需 "lat,lon"（如 57.649,10.407），得到: ${text}`);
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (lat < -90 || lat > 90) throw new Error(`纬度超出 [-90, 90]: ${lat}`);
  if (lon < -180 || lon > 180) throw new Error(`经度超出 [-180, 180]: ${lon}`);
  return { lat, lon };
}

function formatLatLon(lat, lon, precision = 6) {
  return `${Number(lat.toFixed(precision))},${Number(lon.toFixed(precision))}`;
}

// ============================================================
// 1. 度分秒（DMS）↔ 十进制度（DD）
// ============================================================
// DD = degrees + minutes/60 + seconds/3600
// DMS 格式：ddd°mm'ss.s"H（H = N/S/E/W）
// encode: "lat,lon"（DD）→ "latDMS, lonDMS"
// decode: DMS 字符串 → "lat,lon"（DD）
// ============================================================

function ddToDms(dd, isLat) {
  const hemi = isLat ? (dd >= 0 ? "N" : "S") : (dd >= 0 ? "E" : "W");
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = (minFull - min) * 60;
 // 秒保留 3 位小数
  const secStr = sec.toFixed(3).replace(/\.?0+$/, "");
  return `${deg}°${min}'${secStr}"${hemi}`;
}

function dmsToDd(dms) {
 // 支持 "ddd°mm'ss.s"H / "ddd mm ss.s H" / "ddd°mm.mmmm'H" / "ddd.ddd H"
  const s = String(dms).trim();
 // 提取半球
  const hemiMatch = s.match(/[NSEWnsew]$/);
  if (!hemiMatch) throw new Error(`DMS 缺半球标识 N/S/E/W: ${dms}`);
  const hemi = hemiMatch[0].toUpperCase();
  const body = s.slice(0, -1).trim().replace(/[°′'"\u2032\u2033]/g, " ").replace(/\s+/g, " ").trim();
  const parts = body.split(" ").filter(Boolean);
  if (parts.length === 0 || parts.length > 3) throw new Error(`DMS 字段数非法（1-3）: ${dms}`);
  let dd = 0;
  for (let i = 0; i < parts.length; i++) {
    dd += parseFloat(parts[i]) / Math.pow(60, i);
  }
  if (isNaN(dd)) throw new Error(`DMS 数值解析失败: ${dms}`);
  if (hemi === "S" || hemi === "W") dd = -dd;
  return dd;
}

function geoDmsEncode(text) {
  const { lat, lon } = parseLatLon(text);
  return `${ddToDms(lat, true)}, ${ddToDms(lon, false)}`;
}

function geoDmsDecode(text) {
  const s = String(text).trim();
 // 拆分纬度/经度两部分（逗号或多个空格分隔）
  const parts = s.split(/[,，]|\s{2,}/).map((x) => x.trim()).filter(Boolean);
  if (parts.length !== 2) throw new Error(`DMS 输入需 "latDMS, lonDMS" 两段，得到 ${parts.length} 段`);
  const lat = dmsToDd(parts[0]);
  const lon = dmsToDd(parts[1]);
  if (lat < -90 || lat > 90) throw new Error(`纬度 DMS 越界: ${lat}`);
  if (lon < -180 || lon > 180) throw new Error(`经度 DMS 越界: ${lon}`);
  return formatLatLon(lat, lon);
}

// ============================================================
// 2. geohash
// ============================================================
// 规范：geohash.org 算法。base32 表去掉 a/i/l/o。
// 交替编码：第一位经度（even=true），第二位纬度，...
// 每位 5 bits，二分区间。
// encode: "lat,lon" → geohash（默认 11 位）
// decode: geohash → "lat,lon"（中心点）
// ============================================================

const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

function geohashEncode(lat, lon, precision = 11) {
  if (precision < 1) precision = 1;
  if (precision > 12) precision = 12;
  let minLat = -90, maxLat = 90;
  let minLon = -180, maxLon = 180;
  let out = "";
  let bit = 0, ch = 0;
  let even = true; // true = 经度
  while (out.length < precision) {
    if (even) {
      const mid = (minLon + maxLon) / 2;
      if (lon >= mid) { ch |= (1 << (4 - bit)); minLon = mid; }
      else maxLon = mid;
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { ch |= (1 << (4 - bit)); minLat = mid; }
      else maxLat = mid;
    }
    even = !even;
    bit++;
    if (bit === 5) {
      out += GEOHASH_BASE32[ch];
      bit = 0; ch = 0;
    }
  }
  return out;
}

function geohashDecode(hash) {
  hash = String(hash).trim().toLowerCase();
  if (!/^[0-9b-hj-km-np-z]+$/.test(hash)) {
    throw new Error(`非法 geohash 字符（不允许 a/i/l/o，仅 base32 表内字符）: ${hash}`);
  }
  let minLat = -90, maxLat = 90;
  let minLon = -180, maxLon = 180;
  let even = true;
  for (const c of hash) {
    const cd = GEOHASH_BASE32.indexOf(c);
    if (cd < 0) throw new Error(`非法 geohash 字符: ${c}`);
    for (let bit = 4; bit >= 0; bit--) {
      const b = (cd >> bit) & 1;
      if (even) {
        const mid = (minLon + maxLon) / 2;
        if (b) minLon = mid; else maxLon = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (b) minLat = mid; else maxLat = mid;
      }
      even = !even;
    }
  }
  const lat = (minLat + maxLat) / 2;
  const lon = (minLon + maxLon) / 2;
  return { lat, lon, latMin: minLat, latMax: maxLat, lonMin: minLon, lonMax: maxLon };
}

// ============================================================
// 3. Plus Code / OLC（Open Location Code）
// ============================================================
// 规范：Google Open Location Code。
// 字母表 "23456789CFGHJMPQRVWX"（20 字符，去 a/i/l/o/0/1/b/s/t/u/v 等）
// 前 10 字符 5 对，每对纬度+经度。
// 网格大小：[20°, 1°, 0.05°, 0.0025°, 0.000125°]
// 第 8 字符后插 "+" 分隔符。
// encode: "lat,lon" → Plus Code（默认 11 字符含 +）
// decode: Plus Code → "lat,lon"（中心点）
// ============================================================

const OLC_ALPHABET = "23456789CFGHJMPQRVWX";
const OLC_SEPARATOR = "+";
const OLC_PADDING = "0";
const OLC_PAIR_CODE_LENGTH = 10;    // 成对段最大显著位数
const OLC_MAX_DIGIT_COUNT = 15;     // 显著位数上限（超出按规范截断到 15）
const OLC_SEPARATOR_POSITION = 8;   // "+" 固定在显著位第 8 位
const OLC_GRID_ROWS = 5;
const OLC_GRID_COLUMNS = 4;
const OLC_PAIR_PRECISION = 8000;          // 20^3：成对段整数标度
const OLC_FINAL_LAT_PRECISION = 25000000; // 20^3 * 5^5：纬度整格标度
const OLC_FINAL_LNG_PRECISION = 8192000;  // 20^3 * 4^5：经度整格标度
// 成对段分辨率（保留导出，兼容既有引用；编码/解码改用规范整数标度）
const OLC_GRID_SIZE = [20.0, 1.0, 0.05, 0.0025, 0.000125];

// 规范有效性（google/open-location-code 官方 isValid 口径）：
// 至多一个 "+"；"+" 在偶数位且 ≤8；"0" 只能作填充（成对偶数个、紧邻 "+" 前、且 "+" 为末字符）。
function olcIsValid(code) {
  const c = String(code);
  if (c.length < 2) return false;
  if (c.split(OLC_SEPARATOR).length > 2) return false;
  const sep = c.indexOf(OLC_SEPARATOR);
  if (sep === -1 || sep > OLC_SEPARATOR_POSITION || sep % 2 === 1) return false;
  const pad = c.indexOf(OLC_PADDING);
  if (pad !== -1) {
    if (sep < OLC_SEPARATOR_POSITION) return false;
    if (pad === 0) return false;
    const pads = c.slice(pad, c.lastIndexOf(OLC_PADDING) + 1);
    if (pads.length % 2 === 1) return false;
    for (const ch of pads) if (ch !== OLC_PADDING) return false;
    if (!c.endsWith(OLC_SEPARATOR)) return false;
  }
  if (c.length - sep - 1 === 1) return false;
  for (const ch of c) {
    const u = ch.toUpperCase();
    if (OLC_ALPHABET.indexOf(u) < 0 && u !== OLC_SEPARATOR && u !== OLC_PADDING) return false;
  }
  return true;
}

// 规范全码判定（官方 isFull 口径）：短码（"+" 位 <8）需参考点，本 op 无参考点故拒收；
// 首字符须保证解码纬度 <90，第二字符须保证经度 <180。
function olcIsFull(code) {
  if (!olcIsValid(code)) return false;
  const c = String(code);
  const sep = c.indexOf(OLC_SEPARATOR);
  if (sep >= 0 && sep < OLC_SEPARATOR_POSITION) return false;
  const latIdx = OLC_ALPHABET.indexOf(c[0].toUpperCase());
  if (latIdx < 0 || latIdx >= 9) return false;
  if (c.length > 1) {
    const lngIdx = OLC_ALPHABET.indexOf(c[1].toUpperCase());
    if (lngIdx < 0 || lngIdx >= 18) return false;
  }
  return true;
}

// 标准 OLC 编码（支持 8 短码 / 11 全码）
// 标准 OLC 编码。codeLength = 显著位数（不含 "+"），规范允许 2/4/6/8/10 及 11~15。
// 码长 >10 时在成对段之后追加 4×5 网格细分；<8 时用 "0" 填充到 8 位再放 "+"。
// 纬度按规范 clip 到 [-90,90]（lat=90 取上边界格，不环绕）；经度按规范归一化到 [-180,180)。
function olcEncodeStd(lat, lon, codeLength = 10) {
  let len = codeLength;
  if (len < 2 || (len < OLC_PAIR_CODE_LENGTH && len % 2 === 1)) {
    throw new Error(`非法 OLC 码长（须 ≥2，且 <10 时为偶数）: ${codeLength}`);
  }
  if (len > OLC_MAX_DIGIT_COUNT) len = OLC_MAX_DIGIT_COUNT;

  const latClamped = lat > 90 ? 90 : (lat < -90 ? -90 : lat);
  let lonNorm = lon;
  while (lonNorm >= 180) lonNorm -= 360;
  while (lonNorm < -180) lonNorm += 360;

  let latVal = Math.floor(latClamped * OLC_FINAL_LAT_PRECISION) + 90 * OLC_FINAL_LAT_PRECISION;
  const latMax = 2 * 90 * OLC_FINAL_LAT_PRECISION;
  if (latVal < 0) latVal = 0;
  else if (latVal >= latMax) latVal = latMax - 1; // 极点：lat=90 恰在上边界 → 取最大格
  const lngRange = 2 * 180 * OLC_FINAL_LNG_PRECISION;
  let lngVal = Math.floor(lonNorm * OLC_FINAL_LNG_PRECISION) + 180 * OLC_FINAL_LNG_PRECISION;
  lngVal = ((lngVal % lngRange) + lngRange) % lngRange;

  const digits = [];
  if (len > OLC_PAIR_CODE_LENGTH) {
    for (let i = 0; i < OLC_MAX_DIGIT_COUNT - OLC_PAIR_CODE_LENGTH; i++) {
      const latDigit = latVal % OLC_GRID_ROWS;
      const lngDigit = lngVal % OLC_GRID_COLUMNS;
      digits.push(OLC_ALPHABET[latDigit * OLC_GRID_COLUMNS + lngDigit]);
      latVal = Math.floor(latVal / OLC_GRID_ROWS);
      lngVal = Math.floor(lngVal / OLC_GRID_COLUMNS);
    }
  } else {
    latVal = Math.floor(latVal / Math.pow(OLC_GRID_ROWS, OLC_MAX_DIGIT_COUNT - OLC_PAIR_CODE_LENGTH));
    lngVal = Math.floor(lngVal / Math.pow(OLC_GRID_COLUMNS, OLC_MAX_DIGIT_COUNT - OLC_PAIR_CODE_LENGTH));
  }
  for (let i = 0; i < OLC_PAIR_CODE_LENGTH / 2; i++) {
    digits.push(OLC_ALPHABET[lngVal % 20]);
    digits.push(OLC_ALPHABET[latVal % 20]);
    latVal = Math.floor(latVal / 20);
    lngVal = Math.floor(lngVal / 20);
  }
  let code = digits.reverse().join("");
  code = code.slice(0, OLC_SEPARATOR_POSITION) + OLC_SEPARATOR + code.slice(OLC_SEPARATOR_POSITION);
  if (len >= OLC_SEPARATOR_POSITION) return code.slice(0, len + 1);
  return code.slice(0, len) + OLC_PADDING.repeat(OLC_SEPARATOR_POSITION - len) + OLC_SEPARATOR;
}

// 标准 OLC 解码（仅全码）。按规范整数标度取格，并还原官方 CodeArea 的中心点。
function olcDecode(code) {
  const raw = String(code).trim();
  if (!olcIsFull(raw)) {
    throw new Error(`非法 OLC 全码（须含 "+" 于第 8 位、长度合法、字符在字母表内；短码需参考点）: ${code}`);
  }
  const c = raw.toUpperCase().replace(/[+0]/g, "").slice(0, OLC_MAX_DIGIT_COUNT);
  let normalLat = -90 * OLC_PAIR_PRECISION;
  let normalLng = -180 * OLC_PAIR_PRECISION;
  let gridLat = 0;
  let gridLng = 0;
  const pairDigits = Math.min(c.length, OLC_PAIR_CODE_LENGTH);
  let pv = Math.pow(20, OLC_PAIR_CODE_LENGTH / 2 - 1); // 20^4 = 160000
  for (let i = 0; i < pairDigits; i += 2) {
    normalLat += OLC_ALPHABET.indexOf(c[i]) * pv;
    normalLng += OLC_ALPHABET.indexOf(c[i + 1]) * pv;
    if (i < pairDigits - 2) pv = Math.floor(pv / 20);
  }
  let latPrecision = pv / OLC_PAIR_PRECISION;
  let lngPrecision = pv / OLC_PAIR_PRECISION;
  if (c.length > OLC_PAIR_CODE_LENGTH) {
    let rowpv = Math.pow(OLC_GRID_ROWS, OLC_MAX_DIGIT_COUNT - OLC_PAIR_CODE_LENGTH - 1); // 5^4
    let colpv = Math.pow(OLC_GRID_COLUMNS, OLC_MAX_DIGIT_COUNT - OLC_PAIR_CODE_LENGTH - 1); // 4^4
    const gridDigits = Math.min(c.length, OLC_MAX_DIGIT_COUNT);
    for (let i = OLC_PAIR_CODE_LENGTH; i < gridDigits; i++) {
      const dv = OLC_ALPHABET.indexOf(c[i]);
      gridLat += Math.floor(dv / OLC_GRID_COLUMNS) * rowpv;
      gridLng += (dv % OLC_GRID_COLUMNS) * colpv;
      if (i < gridDigits - 1) {
        rowpv = Math.floor(rowpv / OLC_GRID_ROWS);
        colpv = Math.floor(colpv / OLC_GRID_COLUMNS);
      }
    }
    latPrecision = rowpv / OLC_FINAL_LAT_PRECISION;
    lngPrecision = colpv / OLC_FINAL_LNG_PRECISION;
  }
  const latF = normalLat / OLC_PAIR_PRECISION + gridLat / OLC_FINAL_LAT_PRECISION;
  const lonF = normalLng / OLC_PAIR_PRECISION + gridLng / OLC_FINAL_LNG_PRECISION;
  const latLo = Math.round(latF * 1e14) / 1e14;
  const lonLo = Math.round(lonF * 1e14) / 1e14;
  const latHi = Math.round((latF + latPrecision) * 1e14) / 1e14;
  const lonHi = Math.round((lonF + lngPrecision) * 1e14) / 1e14;
  const lat = Math.min(latLo + (latHi - latLo) / 2, 90);
  const lon = Math.min(lonLo + (lonHi - lonLo) / 2, 180);
  return { lat, lon };
}

// ============================================================
// 4. Maidenhead 网格定位
// ============================================================
// 规范：IARU Region 1 VHF Handbook。
// 字段1（2字母）：经度 20°×18格 A-R，纬度 10°×18格 A-R
// 字段2（2数字）：经度 2°×10格 0-9，纬度 1°×10格 0-9
// 字段3（2字母）：经度 5'(=1/12°)×24格 a-x，纬度 2.5'(=1/24°)×24格 a-x
// 可扩展更多对（每对再 1/24 细分）
// encode: "lat,lon" → Maidenhead 网格（默认 6 字符 = 3 对）
// decode: Maidenhead 网格 → "lat,lon"（中心点）
// ============================================================

function maidenheadEncode(lat, lon, pairs = 3) {
  if (pairs < 2 || pairs > 4) pairs = 3;
  let adjLon = lon + 180;
  let adjLat = lat + 90;
  let out = "";
 // 字段1（2字母）
  const fieldLon = Math.floor(adjLon / 20);
  const fieldLat = Math.floor(adjLat / 10);
  out += String.fromCharCode(65 + fieldLon) + String.fromCharCode(65 + fieldLat);
  adjLon -= fieldLon * 20;
  adjLat -= fieldLat * 10;
 // 字段2（2数字）
  const sqLon = Math.floor(adjLon / 2);
  const sqLat = Math.floor(adjLat / 1);
  out += sqLon + "" + sqLat;
  adjLon -= sqLon * 2;
  adjLat -= sqLat * 1;
 // 字段3（2字母，subsquare）
  if (pairs >= 3) {
    const subLon = Math.floor(adjLon * 12);
    const subLat = Math.floor(adjLat * 24);
    out += String.fromCharCode(97 + subLon) + String.fromCharCode(97 + subLat);
    adjLon -= subLon / 12;
    adjLat -= subLat / 24;
  }
 // 字段4（扩展对，2字母）
  if (pairs >= 4) {
    const extLon = Math.floor(adjLon * 12 * 24);
    const extLat = Math.floor(adjLat * 24 * 24);
    out += String.fromCharCode(97 + extLon) + String.fromCharCode(97 + extLat);
  }
  return out;
}

function maidenheadDecode(grid) {
  grid = String(grid).trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?([A-X]{2})?$/.test(grid)) {
    throw new Error(`非法 Maidenhead 网格格式，需如 "FN20XR" 或 "FN20" 或 "FN20XRAB": ${grid}`);
  }
  let i = 0;
 // 字段1
  const fieldLon = grid.charCodeAt(0) - 65;
  const fieldLat = grid.charCodeAt(1) - 65;
  let lonVal = fieldLon * 20;
  let latVal = fieldLat * 10;
 // 字段2
  const sqLon = parseInt(grid[2], 10);
  const sqLat = parseInt(grid[3], 10);
  lonVal += sqLon * 2;
  latVal += sqLat * 1;
  let lonRes = 2.0;
  let latRes = 1.0;
 // 字段3
  if (grid.length >= 6) {
    const subLon = grid.charCodeAt(4) - 65;
    const subLat = grid.charCodeAt(5) - 65;
    lonVal += subLon / 12;
    latVal += subLat / 24;
    lonRes = 1 / 12;
    latRes = 1 / 24;
  }
 // 字段4
  if (grid.length >= 8) {
    const extLon = grid.charCodeAt(6) - 65;
    const extLat = grid.charCodeAt(7) - 65;
    lonVal += extLon / (12 * 24);
    latVal += extLat / (24 * 24);
    lonRes = 1 / (12 * 24);
    latRes = 1 / (24 * 24);
  }
 // 中心点
  const lon = lonVal + lonRes / 2 - 180;
  const lat = latVal + latRes / 2 - 90;
  return { lat, lon };
}

// ============================================================
// 5. UTM（Universal Transverse Mercator）
// ============================================================
// 规范：WGS84 椭球 + Snyder USGS 公式。
// a = 6378137.0, f = 1/298.257223563, k0 = 0.9996
// false easting = 500000, false northing (南半球) = 10000000
// zone = floor((lon + 180) / 6) + 1（1-60）
// 字母带：C-X（跳过 I/O），每 8° 一带，覆盖 [-80, 84]
// encode: "lat,lon" → "ZoneLetter Easting Northing"（如 "31U 448251 5411937"）
// decode: "31U 448251 5411937" → "lat,lon"
// ============================================================

const UTM_A = 6378137.0;
const UTM_F = 1 / 298.257223563;
const UTM_K0 = 0.9996;
const UTM_FALSE_E = 500000;
const UTM_FALSE_N_SOUTH = 10000000;
const UTM_LETTER_BANDS = "CDEFGHJKLMNPQRSTUVWX";

function utmZone(lon) {
  return Math.floor((lon + 180) / 6) + 1;
}

function utmLetter(lat) {
  if (lat < -80 || lat > 84) throw new Error(`纬度超出 UTM 覆盖范围 [-80, 84]: ${lat}`);
  let idx = Math.floor((lat + 80) / 8);
 // X 带特殊：72-84N（12°而非 8°）
  if (idx >= UTM_LETTER_BANDS.length) idx = UTM_LETTER_BANDS.length - 1;
  return UTM_LETTER_BANDS[idx];
}

function utmLetterToLatBand(letter) {
  const idx = UTM_LETTER_BANDS.indexOf(letter.toUpperCase());
  if (idx < 0) throw new Error(`非法 UTM 字母带（C-X 跳过 I/O）: ${letter}`);
  return idx;
}

function utmEncode(lat, lon) {
  if (lat < -80 || lat > 84) throw new Error(`纬度超出 UTM 覆盖范围 [-80, 84]: ${lat}`);
  const zone = utmZone(lon);
  const letter = utmLetter(lat);
  const lon0 = (zone - 1) * 6 - 180 + 3; // 中央经线（度）
  const isNorth = lat >= 0;

  const e2 = 2 * UTM_F - UTM_F * UTM_F;
  const ep2 = e2 / (1 - e2);
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const lon0Rad = lon0 * Math.PI / 180;

  const N = UTM_A / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ep2 * Math.cos(latRad) ** 2;
  const A = (lonRad - lon0Rad) * Math.cos(latRad);

  const M = UTM_A * (
    (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * latRad
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * latRad)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * latRad)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * latRad)
  );

  const x = UTM_K0 * N * (
    A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120
  ) + UTM_FALSE_E;

  const y = UTM_K0 * (
    M + N * Math.tan(latRad) * (
      A ** 2 / 2
      + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720
    )
  ) + (isNorth ? 0 : UTM_FALSE_N_SOUTH);

  return `${zone}${letter} ${Math.round(x)} ${Math.round(y)}`;
}

function utmDecode(zone, letter, easting, northing) {
  const isNorth = utmLetterToLatBand(letter) >= utmLetterToLatBand("N");
  const lon0 = (zone - 1) * 6 - 180 + 3; // 中央经线（度）
  const lon0Rad = lon0 * Math.PI / 180;

  const e2 = 2 * UTM_F - UTM_F * UTM_F;
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const x = easting - UTM_FALSE_E;
  const y = isNorth ? northing : northing - UTM_FALSE_N_SOUTH;

  const M = y / UTM_K0;
  const mu = M / (UTM_A * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const latFootRad = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

  const N1 = UTM_A / Math.sqrt(1 - e2 * Math.sin(latFootRad) ** 2);
  const T1 = Math.tan(latFootRad) ** 2;
  const C1 = ep2 * Math.cos(latFootRad) ** 2;
  const R1 = UTM_A * (1 - e2) / Math.pow(1 - e2 * Math.sin(latFootRad) ** 2, 1.5);
  const D = x / (N1 * UTM_K0);

  const latRad = latFootRad - (N1 * Math.tan(latFootRad) / R1) * (
    D ** 2 / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720
  );

  const lonRad = lon0Rad + (
    D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
  ) / Math.cos(latFootRad);

  const lat = latRad * 180 / Math.PI;
  const lon = lonRad * 180 / Math.PI;
  return { lat, lon };
}

function utmParse(text) {
 // 支持 "31U 448251 5411937" / "31 U 448251 5411937" / "31U,448251,5411937"
  const s = String(text).trim().replace(/[,，]/g, " ").replace(/\s+/g, " ");
  const m = s.match(/^(\d{1,2})\s*([A-HJ-NP-Z])\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`非法 UTM 格式，需 "ZoneLetter Easting Northing"（如 "31U 448251 5411937"）: ${text}`);
  const zoneNum = parseInt(m[1], 10);
  if (zoneNum < 1 || zoneNum > 60) throw new Error(`UTM 分区须 1-60: ${m[1]}`);
  return {
    zone: zoneNum,
    letter: m[2].toUpperCase(),
    easting: parseFloat(m[3]),
    northing: parseFloat(m[4]),
  };
}

function geoUtmEncode(text) {
  const { lat, lon } = parseLatLon(text);
  return utmEncode(lat, lon);
}

function geoUtmDecode(text) {
  const { zone, letter, easting, northing } = utmParse(text);
  const { lat, lon } = utmDecode(zone, letter, easting, northing);
  return formatLatLon(lat, lon);
}

// ============================================================
// 注册（cat:'radix'）
// ============================================================

const geoHashPrecisionParam = {
  key: "precision",
  label: "精度（位数）",
  type: "select",
  default: "11",
  options: [
    { value: "6", label: "6 位（±0.6km）" },
    { value: "8", label: "8 位（±19m）" },
    { value: "10", label: "10 位（±0.6m）" },
    { value: "11", label: "11 位（±0.06m）" },
    { value: "12", label: "12 位（±0.0006m）" },
  ],
};

const olcLengthParam = {
  key: "codeLength",
  label: "码长（显著位数，不含 +）",
  type: "select",
  default: "10",
  options: [
    { value: "6", label: "6 位（约 5.5km）" },
    { value: "8", label: "8 位加号码（约 275m）" },
    { value: "10", label: "10 位全码（约 14m，默认）" },
    { value: "11", label: "11 位网格码（约 3m）" },
    { value: "12", label: "12 位网格码（约 0.6m）" },
  ],
};

const maidenheadPairsParam = {
  key: "pairs",
  label: "精度对数",
  type: "select",
  default: "3",
  options: [
    { value: "2", label: "4 字符（field+square）" },
    { value: "3", label: "6 字符（+subsquare）" },
    { value: "4", label: "8 字符（+extended）" },
  ],
};

register({
  id: "geoDms",
  cat: "radix",
  name: "度分秒 ↔ 十进制",
  desc: "DMS（度°分′秒″H，H=N/S/E/W）↔ DD（十进制度）。秒可带小数。",
  params: [],
  encode(text) {
    return geoDmsEncode(text);
  },
  decode(text) {
    return geoDmsDecode(text);
  },
});

register({
  id: "geoHash",
  cat: "radix",
  name: "Geohash 编码",
  desc: "geohash.org 算法。base32 表去 a/i/l/o，纬经度交替二分。CTF 地理坐标高频。",
  params: [geoHashPrecisionParam],
  encode(text, p) {
    const { lat, lon } = parseLatLon(text);
    return geohashEncode(lat, lon, parseInt(p.precision || "11", 10));
  },
  decode(text, p) {
    void p;
    const { lat, lon } = geohashDecode(text);
    return formatLatLon(lat, lon);
  },
});

register({
  id: "geoPlusCode",
  cat: "radix",
  name: "Plus Code / OLC",
  desc: "Google Open Location Code（OLC）。字母表 23456789CFGHJMPQRVWX。码长为显著位数（不含 +）：2/4/6/8/10 成对编码，11~15 追加 4×5 网格细分；<8 用 0 填充。默认 10 位（11 字符含 +）。",
  params: [olcLengthParam],
  encode(text, p) {
    const { lat, lon } = parseLatLon(text);
    return olcEncodeStd(lat, lon, parseInt(p.codeLength || "10", 10));
  },
  decode(text, p) {
    void p;
    const { lat, lon } = olcDecode(text);
    return formatLatLon(lat, lon);
  },
});

register({
  id: "geoMaidenhead",
  cat: "radix",
  name: "Maidenhead 网格",
  desc: "业余无线电网格定位。field(20°/10°)+square(2°/1°)+subsquare(5'/2.5')，可扩展。CTF Ham 常见。",
  params: [maidenheadPairsParam],
  encode(text, p) {
    const { lat, lon } = parseLatLon(text);
    return maidenheadEncode(lat, lon, parseInt(p.pairs || "3", 10));
  },
  decode(text, p) {
    void p;
    const { lat, lon } = maidenheadDecode(text);
    return formatLatLon(lat, lon);
  },
});

register({
  id: "geoUtm",
  cat: "radix",
  name: "UTM 坐标",
  desc: "WGS84 椭球 + Snyder USGS 公式。60 区 6°宽，字母带 C-X（跳 I/O）。输出 Zone+字母带+东距+北距（如 31U 448251 5411937）。",
  params: [],
  encode(text) {
    return geoUtmEncode(text);
  },
  decode(text) {
    return geoUtmDecode(text);
  },
});

// 导出纯函数供 workerPool / 单元测试复用
export {
  parseLatLon,
  formatLatLon,
  ddToDms,
  dmsToDd,
  geoDmsEncode,
  geoDmsDecode,
  geohashEncode,
  geohashDecode,
  GEOHASH_BASE32,
  olcEncodeStd,
  olcDecode,
  OLC_ALPHABET,
  OLC_GRID_SIZE,
  maidenheadEncode,
  maidenheadDecode,
  utmEncode,
  utmDecode,
  utmParse,
  utmZone,
  utmLetter,
  UTM_LETTER_BANDS,
};
