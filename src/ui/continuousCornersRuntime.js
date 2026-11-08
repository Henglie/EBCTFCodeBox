(function installContinuousCorners(global) {
'use strict';
if (global.__EBCTFContinuousCorners) return;
/**
 * Continuous corners, without clipping a host or adding children/pseudo-elements.
 *
 * Integration (after the theme, controls and refinement styles):
 *   <link rel="stylesheet" href="./src/ui/continuousCorners.css">
 *   import { setupContinuousCorners } from "./ui/continuousCorners.js";
 *   const corners = setupContinuousCorners(); // after shared controls bootstrap
 *   // corners.refresh(element) after CSSOM/adopted stylesheet changes, if any.
 *   // corners.dispose() restores authored paint and disconnects all observers.
 *   // corners.inspect(element)?.source exposes the original computed paint;
 *   // getComputedStyle sees transparent host paint once SVG takes ownership.
 *
 * Every engine uses the same measured UIKit continuous-corner profile, including
 * borders, focus outlines and shadows. Reference control-point measurements:
 * https://www.paintcodeapp.com/news/code-for-ios-7-rounded-rectangles (PixelCut).
 * The well-behaved, radius-limited profile avoids the historical UIKit overlap
 * glitches. It is a reproducible Apple-style profile, not a claim of pixel parity
 * with every modern OS version's private CALayer continuous implementation.
 *
 * Supported paint: solid colors, linear gradients (including repeated tiles),
 * independent solid borders, uniform dashed/dotted borders, outer/inset shadows.
 * Closed single-select shells are self-drawn; their text, options, popup and
 * keyboard interaction remain browser-owned. Authored padding plus the native
 * indicator gutter retain the original text area/intrinsic size. Unsupported
 * image sources and OS-owned popup contents retain authored rendering and are
 * reported by inspect()/stats(). Replaced media uses an explicit matching clip;
 * container hosts and their floating children are never clipped by this module.
 * M3 circles, capsules and range track/thumb retain authored circular arcs.
 * Generated SVGs contain paint/geometry only, never field text.
 */

const CORNER_PROFILE = 'apple-continuous-measured';
const APPLE_CORNER_EXTENT = 1.52866483;
// CSS may round an unclassed descendant (.menu > div), or an id-only panel.
// Discovery checks only computed radius (no layout); IO/RO and full paint reads
// are reserved for rounded boxes, not every text span or font glyph in a report.
const CANDIDATES = '*';
const CIRCLES = '.fav-btn, .stepper-btn, .mid-btn, .switch .knob, .about-capsule-avatar, .env-accent-swatch, .swatch-dot, .mt575-dot, .m3-ripple-dot, .rtoc-dot, .rtoc-rail-dot, .rtoc-close, .ds-close, .exp-close, .ci-modal-close, .nav-drawer-toggle, #btnRepo, #btnTheme, #btnMoreActions';
const ATTR = 'data-cc-rendered';
const MEASURE = 'data-cc-measure';
const PROPERTIES = ['--cc-image', '--cc-outset', '--cc-transition', '--cc-track', '--cc-thumb', '--cc-select-end', '--cc-select-height', '--cc-clip'];
const INSTANCES = new WeakMap();
const n = value => Number(Number(value).toFixed(10));
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const px = value => parseFloat(value) || 0;

// Split CSS lists without splitting color functions or quoted URLs.
function splitCSS(value, separator = ',') {
  const result = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) { if (c === quote && value[i - 1] !== '\\') quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth && c === separator) { result.push(value.slice(start, i).trim()); start = i + 1; }
  }
  result.push(value.slice(start).trim());
  return result;
}

function normalizeRadii(width, height, radii) {
  const r = radii.map(value => Array.isArray(value) ? value.map(v => Math.max(0, Number(v) || 0)) : [Math.max(0, value), Math.max(0, value)]);
  const ratios = [1, width / (r[0][0] + r[1][0] || 1), width / (r[2][0] + r[3][0] || 1),
    height / (r[0][1] + r[3][1] || 1), height / (r[1][1] + r[2][1] || 1)];
  const scale = Math.max(0, Math.min(...ratios));
  return r.map(pair => pair.map(v => v * scale));
}

/** Measured top-right quarter, normalized by its straight-edge extent. */
function cornerCubics() {
  const point = (right, top) => [1 - right / APPLE_CORNER_EXTENT, top / APPLE_CORNER_EXTENT];
  let previous = APPLE_CORNER_COMMANDS[0].start;
  const curves = [];
  for (const [op, ...values] of APPLE_CORNER_COMMANDS[0].commands) {
    if (op === 'C') curves.push([point(...previous), ...[0, 2, 4].map(i => point(values[i], values[i + 1]))]);
    previous = values.slice(-2);
  }
  return curves;
}

// PixelCut's published shape_1, transcribed corner by corner without mirroring
// or averaging its measured decimal values. C = controls then endpoint; L = endpoint.
const APPLE_CORNER_COMMANDS = Object.freeze([
  { corner: 'top-right', start: [1.52866471, 0.00000000], commands: [
    ['C', 1.08849323, 0.00000000, 0.86840689, 0.00000000, 0.66993427, 0.06549600],
    ['L', 0.63149399, 0.07491100],
    ['C', 0.37282392, 0.16905899, 0.16906013, 0.37282401, 0.07491176, 0.63149399],
    ['C', 0.00000000, 0.86840701, 0.00000000, 1.08849299, 0.00000000, 1.52866483],
  ] },
  { corner: 'bottom-right', start: [0.00000000, 1.52866471], commands: [
    ['C', 0.00000000, 1.08849323, 0.00000000, 0.86840689, 0.06549569, 0.66993493],
    ['L', 0.07491111, 0.63149399],
    ['C', 0.16905883, 0.37282392, 0.37282392, 0.16905883, 0.63149399, 0.07491111],
    ['C', 0.86840689, 0.00000000, 1.08849323, 0.00000000, 1.52866471, 0.00000000],
  ] },
  { corner: 'bottom-left', start: [1.52866483, 0.00000000], commands: [
    ['C', 1.08849299, 0.00000000, 0.86840701, 0.00000000, 0.66993397, 0.06549569],
    ['L', 0.63149399, 0.07491111],
    ['C', 0.37282401, 0.16905883, 0.16906001, 0.37282392, 0.07491100, 0.63149399],
    ['C', 0.00000000, 0.86840689, 0.00000000, 1.08849323, 0.00000000, 1.52866471],
  ] },
  { corner: 'top-left', start: [0.00000000, 1.52866483], commands: [
    ['C', 0.00000000, 1.08849299, 0.00000000, 0.86840701, 0.06549600, 0.66993397],
    ['L', 0.07491100, 0.63149399],
    ['C', 0.16906001, 0.37282401, 0.37282401, 0.16906001, 0.63149399, 0.07491100],
    ['C', 0.86840701, 0.00000000, 1.08849299, 0.00000000, 1.52866483, 0.00000000],
  ] },
]);
for (const corner of APPLE_CORNER_COMMANDS) {
  Object.freeze(corner.start); for (const command of corner.commands) Object.freeze(command);
  Object.freeze(corner.commands); Object.freeze(corner);
}
function continuousCornerPath(width, height, radii, x = 0, y = 0) {
  if (!(width > 0 && height > 0)) return '';
  const r = normalizeRadii(width, height, radii.map(value => (Array.isArray(value) ? value : [value, value]).map(v => v * APPLE_CORNER_EXTENT)));
  const point = (index, u, v) => {
    const [rx, ry] = r[index].map(value => value / APPLE_CORNER_EXTENT);
    return `${n(x + (index === 1 || index === 2 ? width - u * rx : u * rx))} ${n(y + (index >= 2 ? height - v * ry : v * ry))}`;
  };
  let path = `M${point(0, 1.52866483, 0.00000000)}`;
  for (const [position, index] of [1, 2, 3, 0].entries()) {
    const source = APPLE_CORNER_COMMANDS[position];
    path += `L${point(index, ...source.start)}`;
    for (const [op, ...values] of source.commands) {
      path += op;
      for (let i = 0; i < values.length; i += 2) path += `${i ? ' ' : ''}${point(index, values[i], values[i + 1])}`;
    }
  }
  return path + 'Z';
}

function insetBox(width, height, radii, edges) {
  const [t, r, b, l] = edges;
  const inner = radii.map(([rx, ry], i) => [Math.max(0, rx - (i === 0 || i === 3 ? l : r)), Math.max(0, ry - (i < 2 ? t : b))]);
  return continuousCornerPath(width - l - r, height - t - b, inner, l, t);
}

function parseShadows(value) {
  if (!value || value === 'none') return [];
  return splitCSS(value).map(part => {
    const inset = /\binset\b/.test(part);
    const lengths = [...part.matchAll(/(-?(?:\d*\.)?\d+)px\b/g)].map(m => Number(m[1]));
    if (lengths.length < 2 || lengths.length > 4) throw new Error('shadow');
    const color = part.replace(/\binset\b/g, '').replace(/-?(?:\d*\.)?\d+px\b/g, '').trim();
    return { inset, x: lengths[0], y: lengths[1], blur: Math.max(0, lengths[2] || 0), spread: lengths[3] || 0, color: color || 'black' };
  });
}

function gradient(source, id, width, height, origin) {
  if (source.startsWith('radial-gradient(') && source.endsWith(')')) {
    const parts = splitCSS(source.slice(16, -1));
    const geometry = /^(?:circle|ellipse|closest-|farthest-|at\b)/.test(parts[0]) ? parts.shift() : 'ellipse farthest-corner at 50% 50%';
    const [shape, position = '50% 50%'] = geometry.split(/\s+at\s+|^at\s+/);
    const coords = position.trim().split(/\s+/);
    const coordinate = (value, size) => ({ left: 0, top: 0, right: size, bottom: size, center: size / 2 })[value] ?? backgroundLength(value, size, size / 2);
    const cx = coordinate(coords[0] || '50%', width), cy = coordinate(coords[1] || '50%', height);
    const close = shape.includes('closest'), corner = !shape.includes('side');
    let rx = (close ? Math.min : Math.max)(cx, width - cx), ry = (close ? Math.min : Math.max)(cy, height - cy);
    if (shape.includes('circle')) {
      const distances = corner ? [Math.hypot(cx, cy), Math.hypot(width - cx, cy), Math.hypot(cx, height - cy), Math.hypot(width - cx, height - cy)] : [cx, cy, width - cx, height - cy];
      rx = ry = (close ? Math.min : Math.max)(...distances);
    } else if (corner) { rx *= Math.SQRT2; ry *= Math.SQRT2; }
    if (!(rx > 0 && ry > 0) || /\d(?:px|%)/.test(shape)) throw new Error('radial-gradient-geometry');
    const stops = gradient(`linear-gradient(to right, ${parts.join(', ')})`, `${id}-stops`, rx, 0, [0, 0]).match(/<stop\b.*(?=<\/linearGradient>)/)?.[0] || '';
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${n(origin[0] + cx)} ${n(origin[1] + cy)}) scale(${n(rx)} ${n(ry)})">${stops}</radialGradient>`;
  }
  if (!source.startsWith('linear-gradient(') || !source.endsWith(')')) throw new Error('background-image');
  const parts = splitCSS(source.slice(16, -1));
  let angle = 180;
  const direction = parts[0];
  if (/^-?[\d.]+(?:deg|turn|rad|grad)$/.test(direction)) {
    parts.shift(); angle = parseFloat(direction) * (direction.endsWith('turn') ? 360 : direction.endsWith('grad') ? .9 : direction.endsWith('rad') ? 180 / Math.PI : 1);
  } else if (direction.startsWith('to ')) {
    parts.shift();
    const dx = direction.includes('right') ? 1 : direction.includes('left') ? -1 : 0;
    const dy = direction.includes('bottom') ? 1 : direction.includes('top') ? -1 : 0;
    // CSS corner directions are perpendicular to the corresponding diagonal.
    angle = Math.atan2(dx * height, -dy * width) * 180 / Math.PI;
  }
  const radians = angle * Math.PI / 180, dx = Math.sin(radians), dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const stops = [];
  for (const part of parts) {
    const m = part.match(/^(.*?)(?:\s+(-?[\d.]+(?:%|px)))?(?:\s+(-?[\d.]+(?:%|px)))?$/);
    if (!m || !m[1] || /^in\s|\b(?:oklab|oklch)\b/.test(m[1])) throw new Error('gradient-interpolation');
    const position = value => value == null ? null : parseFloat(value) / (value.endsWith('%') ? 100 : length || 1);
    stops.push({ color: m[1], offset: position(m[2]) });
    if (m[3]) stops.push({ color: m[1], offset: position(m[3]) });
  }
  if (stops.length < 2) throw new Error('gradient-stops');
  stops[0].offset ??= 0; stops[stops.length - 1].offset ??= 1;
  let previous = stops[0].offset;
  for (const stop of stops) if (stop.offset != null) { stop.offset = Math.max(previous, stop.offset); previous = stop.offset; }
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i + 1].offset != null) continue;
    let j = i + 1; while (stops[j].offset == null) j++;
    for (let k = i + 1; k < j; k++) stops[k].offset = stops[i].offset + (stops[j].offset - stops[i].offset) * (k - i) / (j - i);
  }
  // Out-of-range stops require color interpolation at the SVG endpoint.
  if (stops.some(stop => stop.offset < 0 || stop.offset > 1)) throw new Error('gradient-stop-range');
  const cx = origin[0] + width / 2, cy = origin[1] + height / 2;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(cx - dx * length / 2)}" y1="${n(cy - dy * length / 2)}" x2="${n(cx + dx * length / 2)}" y2="${n(cy + dy * length / 2)}">` +
    stops.map(stop => `<stop offset="${n(stop.offset)}" stop-color="${xml(stop.color)}"/>`).join('') + '</linearGradient>';
}

function backgroundLength(text, available, fallback) {
  if (text == null || text === 'auto') return fallback;
  // Native-looking authored select arrows commonly use calc(100% - 16px).
  const linear = text.match(/^calc\(\s*(-?(?:\d*\.)?\d+)%\s*([+-])\s*((?:\d*\.)?\d+)px\s*\)$/);
  if (linear) return Number(linear[1]) * available / 100 + (linear[2] === '-' ? -1 : 1) * Number(linear[3]);
  if (!/^-?(?:\d*\.)?\d+(?:px|%)?$/.test(text)) throw new Error('background-placement');
  return parseFloat(text) * (text.endsWith('%') ? available / 100 : 1);
}

const layerValue = (value, index, fallback) => { const list = splitCSS(value || fallback); return list[index % list.length]; };
const cssWords = value => splitCSS(value, ' ').filter(Boolean);

/** Pure paint generator. Throws for paint that cannot faithfully be transferred. */
function createCornerSVG(paint) {
  const { width: w, height: h } = paint;
  const radii = normalizeRadii(w, h, paint.radii);
  const border = paint.border || [0, 0, 0, 0];
  const colors = paint.borderColors || Array(4).fill('transparent');
  const styles = paint.borderStyles || Array(4).fill('solid');
  const outer = continuousCornerPath(w, h, radii), inner = insetBox(w, h, radii, border);
  const shadows = parseShadows(paint.shadow);
  const outlineWidth = paint.outlineStyle && paint.outlineStyle !== 'none' ? Math.max(0, paint.outlineWidth || 0) : 0;
  const outlineOffset = paint.outlineOffset || 0;
  if (shadows.length > 8) throw new Error('shadow-budget');
  const outset = Math.ceil(Math.max(0, outlineWidth + outlineOffset + (outlineWidth ? 1 : 0), ...shadows.filter(s => !s.inset).map(s => Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 1.5 + Math.max(0, s.spread) + 2)));
  if (outset > 192) throw new Error('shadow-budget');
  let defs = `<clipPath id="outer"><path d="${outer}"/></clipPath><clipPath id="inner"><path d="${inner}"/></clipPath>`;
  const maskRect = `<rect x="${-outset - w}" y="${-outset - h}" width="${w * 3 + outset * 2}" height="${h * 3 + outset * 2}" fill="white"/>`;
  defs += `<mask id="outside" maskUnits="userSpaceOnUse" x="${-outset}" y="${-outset}" width="${w + outset * 2}" height="${h + outset * 2}">${maskRect}<path d="${outer}" fill="black"/></mask>`;
  let outside = '', inside = '';
  for (const [i, s] of shadows.entries()) {
    const margin = Math.ceil(Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 1.5 + Math.abs(s.spread) + 2);
    if (margin > 192) throw new Error('shadow-budget');
    const spread = s.inset ? -s.spread : s.spread;
    const shape = continuousCornerPath(w + spread * 2, h + spread * 2, radii.map(r => r.map(v => Math.max(0, v + spread))), -spread + s.x, -spread + s.y);
    defs += `<filter id="s${i}" filterUnits="userSpaceOnUse" x="${-margin}" y="${-margin}" width="${w + margin * 2}" height="${h + margin * 2}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${n(s.blur / 2)}"/></filter>`;
    if (s.inset) {
      defs += `<mask id="i${i}" maskUnits="userSpaceOnUse">${maskRect}<path d="${shape}" fill="black" filter="url(#s${i})"/></mask>`;
      inside = `<path d="${inner}" fill="${xml(s.color)}" mask="url(#i${i})"/>` + inside;
    } else outside = `<g mask="url(#outside)"><path d="${shape}" fill="${xml(s.color)}" filter="url(#s${i})"/></g>` + outside;
  }
  const clipEdges = paint.clip === 'padding-box' ? border : paint.clip === 'content-box' ? border.map((v, i) => v + (paint.padding?.[i] || 0)) : [0, 0, 0, 0];
  const backgroundPath = insetBox(w, h, radii, clipEdges);
  let fill = `<path d="${backgroundPath}" fill="${xml(paint.background || 'transparent')}"/>`;
  const images = !paint.image || paint.image === 'none' ? [] : splitCSS(paint.image);
  for (let i = images.length - 1; i >= 0; i--) {
    if (images[i] === 'none') continue;
    if (layerValue(paint.attachment, i, 'scroll') !== 'scroll') throw new Error('background-attachment');
    const boxEdges = box => box === 'border-box' ? [0, 0, 0, 0] : box === 'padding-box' ? border : box === 'content-box' ? border.map((v, j) => v + (paint.padding?.[j] || 0)) : null;
    const edges = boxEdges(layerValue(paint.origin, i, 'padding-box'));
    const layerClip = boxEdges(layerValue(paint.clips, i, paint.clip || 'border-box'));
    if (!edges || !layerClip) throw new Error('background-origin');
    const areaW = w - edges[1] - edges[3], areaH = h - edges[0] - edges[2];
    const size = cssWords(layerValue(paint.size, i, 'auto'));
    if (size.length > 2) throw new Error('background-size');
    const tileW = backgroundLength(size[0], areaW, areaW), tileH = backgroundLength(size[1], areaH, areaH);
    if (!(tileW > 0 && tileH > 0)) continue;
    const position = cssWords(layerValue(paint.position, i, '0% 0%'));
    if (position.length !== 2) throw new Error('background-position');
    const tx = edges[3] + backgroundLength(position[0], areaW - tileW, 0), ty = edges[0] + backgroundLength(position[1], areaH - tileH, 0);
    const repeat = layerValue(paint.repeat, i, 'repeat').split(/\s+/);
    const rx = repeat[0] === 'repeat-x' ? 'repeat' : repeat[0] === 'repeat-y' ? 'no-repeat' : repeat[0];
    const ry = repeat[0] === 'repeat-x' ? 'no-repeat' : repeat[0] === 'repeat-y' ? 'repeat' : repeat[1] || repeat[0];
    if (![rx, ry].every(mode => ['repeat', 'no-repeat'].includes(mode))) throw new Error('background-repeat');
    defs += gradient(images[i], `g${i}`, tileW, tileH, [0, 0]);
    defs += `<pattern id="p${i}" patternUnits="userSpaceOnUse" x="${n(tx)}" y="${n(ty)}" width="${n(tileW)}" height="${n(tileH)}"><rect width="${n(tileW)}" height="${n(tileH)}" fill="url(#g${i})"/></pattern>`;
    const layerPath = insetBox(w, h, radii, layerClip);
    if (rx === 'repeat' && ry === 'repeat') fill += `<path d="${layerPath}" fill="url(#p${i})"/>`;
    else {
      defs += `<clipPath id="tile${i}"><rect x="${n(rx === 'repeat' ? 0 : tx)}" y="${n(ry === 'repeat' ? 0 : ty)}" width="${n(rx === 'repeat' ? w : tileW)}" height="${n(ry === 'repeat' ? h : tileH)}"/></clipPath>`;
      fill += `<path d="${layerPath}" fill="url(#p${i})" clip-path="url(#tile${i})"/>`;
    }
  }
  let stroke = '';
  const ring = outer + inner;
  if (border.some(v => v > 0)) {
    if (styles.some((style, i) => border[i] && !['solid', 'none', 'hidden', 'dashed', 'dotted'].includes(style))) throw new Error('border-style');
    const patterned = styles.some((style, i) => border[i] && ['dashed', 'dotted'].includes(style));
    if (patterned) {
      if (!border.every(v => v === border[0]) || !styles.every(v => v === styles[0]) || !colors.every(v => v === colors[0])) throw new Error('mixed-pattern-border');
      const bw = border[0], middle = insetBox(w, h, radii, Array(4).fill(bw / 2));
      stroke = `<path d="${middle}" fill="none" stroke="${xml(colors[0])}" stroke-width="${bw}" stroke-dasharray="${styles[0] === 'dotted' ? `0 ${bw * 2}` : `${bw * 3} ${bw * 2}`}" stroke-linecap="${styles[0] === 'dotted' ? 'round' : 'butt'}"/>`;
    } else if (colors.every(c => c === colors[0])) stroke = `<path d="${ring}" fill-rule="evenodd" fill="${xml(colors[0])}"/>`;
    else {
      const wedges = [`0,0 ${w},0 ${w / 2},${h / 2}`, `${w},0 ${w},${h} ${w / 2},${h / 2}`, `${w},${h} 0,${h} ${w / 2},${h / 2}`, `0,${h} 0,0 ${w / 2},${h / 2}`];
      for (let i = 0; i < 4; i++) if (border[i]) {
        defs += `<clipPath id="b${i}"><polygon points="${wedges[i]}"/></clipPath>`;
        stroke += `<path d="${ring}" fill-rule="evenodd" fill="${xml(colors[i])}" clip-path="url(#b${i})"/>`;
      }
    }
  }
  let indicator = '';
  let outline = '';
  if (outlineWidth) {
    const expanded = amount => continuousCornerPath(w + amount * 2, h + amount * 2, radii.map(pair => pair.map(v => Math.max(0, v + amount))), -amount, -amount);
    outline = `<path data-outline="true" d="${expanded(outlineOffset + outlineWidth)}${expanded(outlineOffset)}" fill-rule="evenodd" fill="${xml(paint.outlineColor || 'currentColor')}"/>`;
  }
  if (paint.select?.gutter > 0) {
    const rtl = paint.direction === 'rtl', end = rtl ? 3 : 1;
    const inset = border[end] + (paint.padding?.[end] || 0) + paint.select.gutter / 2;
    const cx = rtl ? inset : w - inset, cy = (border[0] + h - border[2]) / 2;
    const half = Math.min(4, paint.select.gutter / 3, cx - 1, w - cx - 1, h / 4);
    if (half > 0) indicator = `<path d="M${n(cx - half)} ${n(cy - half / 2)}L${n(cx)} ${n(cy + half / 2)}L${n(cx + half)} ${n(cy - half / 2)}" fill="none" stroke="${xml(paint.select.color)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#outer)"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w + outset * 2)}" height="${n(h + outset * 2)}" viewBox="${-outset} ${-outset} ${n(w + outset * 2)} ${n(h + outset * 2)}"><defs>${defs}</defs>${outside}${fill}${inside}${stroke}${indicator}${outline}</svg>`;
  return { svg, outset };
}

const dataImage = svg => `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;
function resolveRadius(value, width, height) {
  const parts = value.trim().split(/\s+/);
  const length = (text, size) => text.endsWith('%') ? px(text) * size / 100 : px(text);
  return [length(parts[0], width), length(parts[1] || parts[0], height)];
}

function snapshot(node, style, width, height) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  return { width, height,
    radii: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(c => resolveRadius(style[`border${c}Radius`], width, height)),
    background: style.backgroundColor, image: style.backgroundImage, size: style.backgroundSize,
    position: style.backgroundPosition, attachment: style.backgroundAttachment, origin: style.backgroundOrigin, repeat: style.backgroundRepeat,
    clip: splitCSS(style.backgroundClip).at(-1), clips: style.backgroundClip, shadow: style.boxShadow,
    blend: style.backgroundBlendMode,
    border: sides.map(s => px(style[`border${s}Width`])), borderColors: sides.map(s => style[`border${s}Color`]),
    borderStyles: sides.map(s => style[`border${s}Style`]), padding: sides.map(s => px(style[`padding${s}`])),
    outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`, appearance: style.appearance,
    outlineWidth: px(style.outlineWidth), outlineOffset: px(style.outlineOffset), outlineColor: style.outlineColor, outlineStyle: style.outlineStyle,
    display: style.display, visibility: style.visibility, borderImage: style.borderImageSource,
    direction: style.direction, primary: style.getPropertyValue('--primary').trim(), surface: style.getPropertyValue('--surface-2').trim(),
    rangeTrack: style.getPropertyValue('--range-track').trim(), progress: style.getPropertyValue('--range-progress').trim(),
    ...(node.tagName === 'SELECT' ? { color: style.color, font: style.font, fontSize: style.fontSize, lineHeight: style.lineHeight,
      writingMode: style.writingMode, cssHeight: style.height, minHeight: style.minHeight, boxSizing: style.boxSizing,
      autoHeight: node.computedStyleMap?.().get('height')?.value === 'auto' } : {}),
  };
}

function skipReason(node, paint) {
  if (node.closest('[data-continuous-corners="off"], [data-continuous-corners="circle"]')) return 'opt-out';
  if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return 'non-html';
  const menuAction = node.matches('#btnRepo, #btnTheme') && node.closest('.topbar-actions.actions-open');
  if (!menuAction && node.matches(CIRCLES) && Math.abs(paint.width - paint.height) < .5) return 'circle';
  if (/^(IFRAME|OBJECT|EMBED|PROGRESS|METER|OPTION)$/.test(node.tagName)) return 'native-control';
  if (node.tagName === 'SELECT' && !paint.writingMode.startsWith('horizontal')) return 'native-select-writing-mode';
  if (node.tagName === 'INPUT' && !['text', 'password', 'search', 'email', 'url', 'tel', 'number', 'button', 'submit', 'reset', 'range'].includes(node.type)
    && !(node.type === 'checkbox' && paint.appearance === 'none')) return 'native-control';
  if (node.tagName === 'INPUT' && node.type === 'range') return 'native-range';
  if (paint.display === 'none' || paint.visibility === 'hidden') return 'hidden';
  if (paint.display === 'inline' || paint.display.startsWith('table') || paint.display === 'contents') return 'fragmented-box';
  if (!paint.radii.some(pair => pair.every(v => v > 0))) return 'square';
  if (Math.abs(paint.width - paint.height) < .5 && paint.radii.every(([rx, ry]) => rx >= paint.width / 2 && ry >= paint.height / 2)) return 'circle';
  // CSS full-round M3 controls are already circular arcs/capsules. Preserve
  // their authored shape instead of forcing the Apple rectangle profile.
  const half = Math.min(paint.width, paint.height) / 2;
  if (paint.radii.every(([rx, ry]) => rx >= half && ry >= half)) return 'pill';
  if (paint.borderImage !== 'none') return 'authored-border-image';
  if (!['border-box', 'padding-box', 'content-box'].includes(paint.clip)) return 'background-clip';
  if (paint.image !== 'none' && splitCSS(paint.blend).some(mode => mode !== 'normal')) return 'background-blend';
  return '';
}

// Do not transition from the sampled source color back to transparent. Spatial
// transitions remain CSS-owned; paint states are updated together in one batch.
function spatialTransitions(value) {
  return splitCSS(value).flatMap(property => property === 'all' ? ['transform', 'translate', 'scale', 'rotate', 'opacity', 'color', 'filter', 'width', 'height', 'padding', 'margin', 'border-radius'] :
    /^(background|border-(?:top-|right-|bottom-|left-)?color|box-shadow)/.test(property) ? [] : [property]).join(', ') || 'none';
}

/** Idempotent per root. The same profile is self-drawn on all browser engines. */
function setupContinuousCorners(options = {}) {
  const root = options.root || globalThis.document;
  if (!root) return { mode: 'unavailable', refresh() {}, flush() {}, dispose() {}, stats: () => ({}) };
  if (INSTANCES.has(root)) return INSTANCES.get(root);
  const doc = root.nodeType === 9 ? root : root.ownerDocument, win = doc.defaultView;
  const states = new Map(), dirty = new Set(), scans = new Set(), visible = new Set(), moving = new Map(), cache = new Map(), selectMetrics = new Map();
  const scrollPositions = new WeakMap();
  const media = win.matchMedia('(forced-colors: active)');
  const selectOpen = win.CSS?.supports('selector(select:open)');
  const metrics = { frames: 0, measured: 0, drawn: 0, cacheHits: 0, radiusChecks: 0, selectProbes: 0 };
  let frame = 0, discoveryTimer = 0, disposed = false, prune = false, flushing = false;
  const schedule = () => { if (!disposed && !frame) frame = win.requestAnimationFrame(flush); };
  const inRoot = node => node.isConnected && (root.nodeType === 9 || root === node || root.contains(node));
  const nearViewport = box => box && box.width > 0 && box.height > 0 && box.bottom >= -160 && box.top <= win.innerHeight + 160
    && box.right >= -160 && box.left <= win.innerWidth + 160;
  function rememberBounds(state, bounds) {
    state.bounds = { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
    for (let parent = state.node.parentElement; parent; parent = parent.parentElement) {
      if (!scrollPositions.has(parent)) scrollPositions.set(parent, { x: parent.scrollLeft, y: parent.scrollTop });
    }
  }
  const rememberStyle = state => { state.expectedStyle = state.node.getAttribute('style') || ''; };
  const restore = state => {
    const node = state.node;
    node.removeAttribute(ATTR); node.removeAttribute(MEASURE); node.removeAttribute('data-cc-range'); node.removeAttribute('data-cc-select'); node.removeAttribute('data-cc-media'); node.removeAttribute('data-cc-content');
    for (const property of PROPERTIES) {
      const old = state.saved.get(property);
      if (old?.[0]) node.style.setProperty(property, old[0], old[1]); else node.style.removeProperty(property);
    }
    state.applied = false; state.key = ''; rememberStyle(state);
  };
  const mark = node => {
    if (!node || node.nodeType !== 1) return;
    const state = states.get(node);
    if (state?.visible) { dirty.add(state); schedule(); }
  };
  const resize = new win.ResizeObserver(entries => {
    for (const entry of entries) {
      const state = states.get(entry.target);
      if (!state) continue;
      const box = entry.borderBoxSize?.[0];
      if (box) state.box = { inline: box.inlineSize, block: box.blockSize };
      mark(entry.target);
    }
  });
  const intersection = new win.IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = states.get(entry.target);
      if (!state) continue;
      rememberBounds(state, entry.boundingClientRect);
      state.visible = entry.isIntersecting;
      if (state.visible) { visible.add(state); resize.observe(state.node); dirty.add(state); }
      else { visible.delete(state); resize.unobserve(state.node); moving.delete(state); }
    }
    if (dirty.size) flush();
  }, { rootMargin: '160px' });
  function track(node) {
    const existing = states.get(node);
    if (existing) {
      if (!existing.visible) {
        const box = node.getBoundingClientRect(); rememberBounds(existing, box);
        if (nearViewport(box)) {
          existing.visible = true; visible.add(existing); resize.observe(node); dirty.add(existing);
        }
      }
      return;
    }
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || /^(HTML|BODY|SCRIPT|STYLE|LINK|OPTION|OPTGROUP|FONT)$/.test(node.tagName)) return;
    if (node.closest('[data-continuous-corners="off"], [data-continuous-corners="circle"]')) return;
    if (!node.matches('input[type="range"].m3-slider')) {
      metrics.radiusChecks++;
      if (!/[1-9]/.test(win.getComputedStyle(node).borderRadius)) return;
    }
    const saved = new Map(PROPERTIES.map(p => [p, [node.style.getPropertyValue(p), node.style.getPropertyPriority(p)]]));
    const state = { node, saved, visible: false, applied: false, expectedStyle: node.getAttribute('style') || '', reason: 'offscreen', key: '' };
    states.set(node, state); intersection.observe(node);
    // IO is delivered after rendering opportunities. Determine initial
    // visibility now so the first visible frame cannot use the authored arc.
    const bounds = node.getBoundingClientRect();
    rememberBounds(state, bounds);
    if (nearViewport(bounds)) {
      state.visible = true; visible.add(state); resize.observe(node); dirty.add(state);
    }
  }
  function scan(node) {
    if (node.nodeType === 1 && node.matches(CANDIDATES)) track(node);
    for (const child of node.querySelectorAll?.(CANDIDATES) || []) track(child);
  }
  function affected(node, discover = true) {
    if (!node || node.nodeType !== 1) return;
    if (discover) scans.add(node);
    for (const state of visible) if (state.node === node || node.contains(state.node)) { state.box = null; dirty.add(state); }
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const state = states.get(parent); if (state?.visible) dirty.add(state);
    }
    schedule();
  }
  const mutation = new win.MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const state = states.get(record.target);
        if (record.attributeName === 'style') {
          const current = record.target.getAttribute('style') || '';
          if (state && state.expectedStyle === current) continue;
          // Compositor-only fades/transforms do not change corner paint or size.
          // Sampling them used to rediscover the entire workspace every frame.
          const paintStyle = value => (value || '').replace(/(?:^|;)\s*(?:transform|translate|scale|rotate|opacity|will-change)\s*:[^;]*(?=;|$)/gi, '').replace(/^\s*;|;\s*$/g, '').trim();
          if (paintStyle(record.oldValue) === paintStyle(current)) {
            if (state) state.expectedStyle = current;
            continue;
          }
        }
        affected(record.target, !['data-m3-pressed', 'data-result-stale', 'aria-selected', 'aria-pressed', 'aria-expanded', 'value', 'checked'].includes(record.attributeName));
      } else {
        for (const node of record.addedNodes) if (node.nodeType === 1) scans.add(node);
        if (record.removedNodes.length) prune = true;
        mark(record.target);
      }
    }
    if (!dirty.size && !scans.size && !prune) return;
    // MutationObserver checkpoints run before the browser paints newly inserted
    // nodes. Complete discovery and paint here, never defer a new box to IO/RAF.
    flush();
  });
  function cached(paint) {
    const key = JSON.stringify(paint);
    let result = cache.get(key);
    if (result) { metrics.cacheHits++; cache.delete(key); cache.set(key, result); }
    else {
      result = createCornerSVG(paint); result.image = dataImage(result.svg); cache.set(key, result);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
    }
    return result;
  }
  function selectShellMetrics(paint) {
    if (paint.appearance === 'none') return { gutter: 0, height: 0 };
    const key = JSON.stringify([paint.font, paint.fontSize, paint.lineHeight, paint.appearance]);
    if (selectMetrics.has(key)) return selectMetrics.get(key);
    // Constant probe text only. Never clone/read the user's options or value.
    // Measurement is synchronous and detached again before the next paint.
    const probe = doc.createElement('select');
    probe.setAttribute('data-continuous-corners', 'off');
    probe.setAttribute('aria-hidden', 'true'); probe.tabIndex = -1;
    probe.append(doc.createElement('option')); probe.firstChild.textContent = 'MMMM';
    probe.style.cssText = 'all:initial!important;position:fixed!important;left:-10000px!important;top:0!important;visibility:hidden!important;pointer-events:none!important;width:max-content!important;height:auto!important;min-width:0!important;max-width:none!important;min-height:0!important;max-height:none!important;padding:0!important;border:0!important;margin:0!important;box-sizing:content-box!important;transition:none!important;';
    for (const [name, value] of [['font', paint.font], ['font-size', paint.fontSize], ['line-height', paint.lineHeight], ['appearance', paint.appearance], ['-webkit-appearance', paint.appearance]]) if (value) probe.style.setProperty(name, value, 'important');
    let result;
    try {
      (doc.body || doc.documentElement).append(probe);
      const native = probe.getBoundingClientRect();
      probe.style.setProperty('appearance', 'none', 'important'); probe.style.setProperty('-webkit-appearance', 'none', 'important');
      result = { gutter: Math.max(0, native.width - probe.getBoundingClientRect().width), height: native.height };
    } finally { probe.remove(); }
    metrics.selectProbes++;
    selectMetrics.set(key, result);
    if (selectMetrics.size > 32) selectMetrics.delete(selectMetrics.keys().next().value);
    return result;
  }
  function flush() {
    if (disposed || flushing) return;
    flushing = true;
    try {
    if (frame) win.cancelAnimationFrame(frame); frame = 0;
    metrics.frames++;
    const scanRoots = new Set([...scans].filter(inRoot));
    for (const node of scanRoots) {
      let covered = false;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) if (scanRoots.has(parent)) { covered = true; break; }
      if (!covered) scan(node);
    }
    scans.clear();
    if (prune) {
      for (const state of states.values()) if (!inRoot(state.node)) {
        restore(state); intersection.unobserve(state.node); resize.unobserve(state.node);
        states.delete(state.node); visible.delete(state); dirty.delete(state); moving.delete(state);
      }
      prune = false;
    }
    const now = win.performance.now();
    for (const [state, deadline] of moving) {
      if (now > deadline || !state.node.getAnimations().some(a => a.playState === 'running' && /radius|width|height/.test(a.transitionProperty || ''))) moving.delete(state);
      else dirty.add(state);
    }
    // Releasing appearance during source sampling can dismiss an OS picker.
    // Repaint that shell on its next input/change/blur/keyboard event instead.
    const batch = [...dirty].filter(s => s.visible && inRoot(s.node) && !(selectOpen && s.node.tagName === 'SELECT' && s.node.matches(':open'))); dirty.clear();
    if (media.matches) { for (const state of batch) { restore(state); state.reason = 'forced-colors'; } return; }
    // Three batched phases: release source paint, read every source, write SVGs.
    // Keeping the filtered transition list during measurement prevents a new
    // color transition every time the paint overrides are temporarily released.
    for (const state of batch) {
      if (!state.applied) {
        state.transitions = spatialTransitions(win.getComputedStyle(state.node).transitionProperty);
        state.node.style.setProperty('--cc-transition', state.transitions);
      }
      state.node.setAttribute(MEASURE, '');
    }
    const samples = batch.map(state => {
      const style = win.getComputedStyle(state.node);
      const vertical = /^(vertical|sideways)/.test(style.writingMode);
      const width = state.box ? state.box[vertical ? 'block' : 'inline'] : (style.boxSizing === 'border-box' ? px(style.width) : px(style.width) + px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth));
      const height = state.box ? state.box[vertical ? 'inline' : 'block'] : (style.boxSizing === 'border-box' ? px(style.height) : px(style.height) + px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth));
      metrics.measured++;
      return [state, snapshot(state.node, style, width, height)];
    });
    for (const [state, paint] of samples) {
      const node = state.node;
      state.source = paint;
      const reason = paint.width <= 0 || paint.height <= 0 ? 'hidden' : skipReason(node, paint);
      if (reason) { restore(state); state.reason = reason; continue; }
      try {
        {
          const isSelect = node.tagName === 'SELECT';
           const shell = isSelect ? (node.multiple || node.size > 1 ? { gutter: 0, height: 0 } : selectShellMetrics(paint)) : null;
          const gutter = shell?.gutter || 0;
          const result = cached(isSelect ? { ...paint, select: { gutter, color: paint.color } } : paint);
          if (state.key !== result.image) {
            node.style.setProperty('--cc-image', result.image); node.style.setProperty('--cc-outset', `${result.outset}px`);
            state.key = result.image; metrics.drawn++;
          }
          if (isSelect) {
            node.style.setProperty('--cc-select-end', `${n(paint.padding[paint.direction === 'rtl' ? 3 : 1] + gutter)}px`);
            // Chromium's auto-height menulist can lose its two internal pixels
            // after appearance toggles. Keep the measured native content floor;
            // an authored fixed height remains authoritative, including small
            // dense controls that deliberately undercut that intrinsic floor.
            const floor = paint.autoHeight ? shell.height + (paint.boxSizing === 'border-box' ? paint.padding[0] + paint.padding[2] + paint.border[0] + paint.border[2] : 0) : 0;
            node.style.setProperty('--cc-select-height', `max(${paint.minHeight === 'auto' ? '0px' : paint.minHeight}, ${paint.cssHeight}, ${n(floor)}px)`);
            node.setAttribute('data-cc-select', '');
          }
          node.setAttribute(ATTR, ''); state.applied = true; state.reason = '';
          if (/^(IMG|VIDEO|CANVAS)$/.test(node.tagName)) {
            node.style.setProperty('--cc-clip', `path('${continuousCornerPath(paint.width, paint.height, paint.radii)}')`);
            node.setAttribute('data-cc-media', '');
          } else if (node.matches('.ci-editor-wrap > .cm-editor, .ci-spanel-pre > .cm-editor')) {
            node.style.setProperty('--cc-clip', `path('${continuousCornerPath(paint.width, paint.height, paint.radii)}')`);
            node.setAttribute('data-cc-content', '');
          }
        }
      } catch (error) { restore(state); state.reason = error.message; }
      node.removeAttribute(MEASURE); rememberStyle(state);
    }
    if (moving.size) schedule();
    } finally { flushing = false; }
  }
  const handlers = [];
  const listen = (target, event, callback) => { target.addEventListener(event, callback, { capture: true, passive: true }); handlers.push([target, event, callback]); };
  const interaction = event => {
    const target = event.target, related = event.relatedTarget;
    // Hover/focus change only the two branches below their common ancestor.
    // A relatedTarget such as #workspace must never invalidate all of its cards.
    if (['pointerover', 'pointerout', 'focusin', 'focusout'].includes(event.type)) {
      for (const [start, other] of [[target, related], [related, target]]) {
        let scope = null;
        for (let node = start; node?.nodeType === 1 && !node.contains(other); node = node.parentElement) {
          mark(node); if (!scope && states.has(node)) scope = node;
        }
        // Repaint descendants of the nearest painted control/card, never a
        // whole page just because its unpainted wrapper also gains :hover.
        scope ||= start;
        if (scope?.nodeType === 1 && !scope.contains(other)) for (const state of visible) if (scope.contains(state.node)) dirty.add(state);
      }
      if (dirty.size) schedule();
      return;
    }
    affected(target, false);
    // Checked controls commonly paint a sibling (.switch input + .track).
    // Focus/hover state layers may also belong to the immediate wrapper.
    const parent = event.target?.parentElement;
    if (parent && parent !== doc.body && parent !== doc.documentElement) affected(parent, false);
  };
  for (const event of ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'focusout', 'input', 'change', 'keydown', 'keyup', 'toggle']) listen(doc, event, interaction);
  listen(doc, 'transitionrun', event => {
    if (!/radius|width|height/.test(event.propertyName)) return;
    const state = states.get(event.target);
    if (state?.visible) { moving.set(state, win.performance.now() + 2500); mark(state.node); }
  });
  listen(win, 'resize', () => {
    for (const state of visible) dirty.add(state); schedule();
    // A breakpoint may newly round a previously square element. Rediscover at
    // resize completion, rather than observing every unpainted glyph forever.
    win.clearTimeout(discoveryTimer);
    discoveryTimer = win.setTimeout(() => { scans.add(root.nodeType === 9 ? doc.documentElement : root); schedule(); }, 80);
  });
  listen(doc, 'scroll', event => {
    // A box can enter a nested scroll viewport before IO is delivered. Existing
    // rounded boxes are the only targets. Shift cached bounds by the scroll
    // delta; ask layout only about boxes entering the prepaint margin.
    const scroller = event.target.nodeType === 9 ? doc.scrollingElement : event.target;
    if (!scroller) return;
    const position = { x: scroller.scrollLeft, y: scroller.scrollTop }, previous = scrollPositions.get(scroller) || position;
    scrollPositions.set(scroller, position);
    const dx = position.x - previous.x, dy = position.y - previous.y;
    if (!dx && !dy) return;
    for (const state of states.values()) {
      if (state.node === scroller || !scroller.contains(state.node) || !state.bounds) continue;
      const bounds = state.bounds;
      bounds.top -= dy; bounds.bottom -= dy; bounds.left -= dx; bounds.right -= dx;
      if (!state.visible && nearViewport(bounds)) {
        rememberBounds(state, state.node.getBoundingClientRect());
        if (nearViewport(state.bounds)) { state.visible = true; visible.add(state); resize.observe(state.node); dirty.add(state); }
      }
    }
    if (dirty.size) flush();
  });
  listen(doc, 'load', event => { if (event.target.tagName === 'LINK') affected(doc.documentElement); });
  const mediaChange = () => {
    if (media.matches) { for (const state of states.values()) { restore(state); state.reason = 'forced-colors'; } }
    else { for (const state of visible) dirty.add(state); flush(); }
  };
  media.addEventListener('change', mediaChange);
  doc.fonts?.addEventListener('loadingdone', mediaChange);
  const api = {
    mode: 'svg',
    refresh(node = root) { if (node.nodeType === 9) affected(doc.documentElement); else affected(node); },
    flush,
    inspect(node) { const s = states.get(node); return s ? { applied: s.applied, visible: s.visible, reason: s.reason, source: s.source } : null; },
    stats() {
      const reasons = {}; let applied = 0;
      for (const s of states.values()) { if (s.applied) applied++; else reasons[s.reason] = (reasons[s.reason] || 0) + 1; }
      return { mode: 'svg', profile: CORNER_PROFILE, ...metrics, tracked: states.size, visible: visible.size, applied, cache: cache.size, pending: !!frame, reasons };
    },
    dispose() {
      disposed = true; if (frame) win.cancelAnimationFrame(frame); win.clearTimeout(discoveryTimer);
      mutation.disconnect(); intersection.disconnect(); resize.disconnect();
      for (const [target, event, callback] of handlers) target.removeEventListener(event, callback, true);
      media.removeEventListener('change', mediaChange); doc.fonts?.removeEventListener('loadingdone', mediaChange);
      for (const state of states.values()) restore(state);
      states.clear(); visible.clear(); dirty.clear(); moving.clear(); cache.clear(); selectMetrics.clear(); INSTANCES.delete(root);
    },
  };
  INSTANCES.set(root, api);
  mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'disabled', 'checked', 'value', 'min', 'max', 'multiple', 'size', 'aria-selected', 'aria-pressed', 'aria-expanded', 'data-m3-pressed', 'data-result-stale', 'data-theme', 'data-palette', 'data-continuous-corners', 'dir'] });
  if (root.nodeType !== 9) {
    // A scoped renderer still consumes inherited theme tokens and direction.
    const ancestors = { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'data-theme', 'data-palette', 'dir'] };
    if (root !== doc.documentElement) mutation.observe(doc.documentElement, ancestors);
    if (doc.body && root !== doc.body && root !== doc.documentElement) mutation.observe(doc.body, ancestors);
  }
  scan(root);
  flush();
  return api;
}

global.__EBCTFContinuousCorners = Object.freeze({ CORNER_PROFILE, APPLE_CORNER_EXTENT, APPLE_CORNER_COMMANDS,
  cornerCubics, continuousCornerPath, createCornerSVG, normalizeRadii, splitCSS, setupContinuousCorners });
if (global.document?.currentScript) setupContinuousCorners();
})(globalThis);
