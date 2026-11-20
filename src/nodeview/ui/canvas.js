/**
 * canvas.js — 节点画布引擎（DOM 节点卡片 + SVG 连线，自研，无框架无打包）。
 *
 * 合同（MT809 / T952）：
 *   · 只认图格式 v1 与一个「端口表提供者」回调；不执行算法、不 import src/core。
 *   · 对外只发事件：nv:selection-change / nv:connect-request / nv:graph-change /
 *     nv:request-node-search / nv:viewport-change / nv:announce。
 *   · 节点文字是真实 DOM 文本，可选中、可被读屏；不使用 canvas 位图。
 *   · 颜色全部走主题变量，无硬编码色值；RTL 与 390px 由 CSS 逻辑属性承担。
 *
 * 坐标：世界坐标 = 节点 x/y；屏幕坐标 = 视口内像素。
 *   screen = world * k + view   （world 层整体 transform，平移缩放只改一个 transform）
 */

import {
  GEO,
  NvGraphError,
  clone,
  clamp,
  normalizeGraph,
  normalizePortTable,
  portLayout,
  nodeSize,
  portAnchor,
  edgePath,
  nodeBox,
  graphBBox,
  validateConnection,
  selectionBBox,
  computeSnap,
  createId,
  isNoteNode,
  stableStringify,
} from './canvasModel.js';
import { createHistory, createClipboard } from './canvasHistory.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const STRINGS = {
  zh: {
    'canvas.label': '节点画布',
    'canvas.hint': '空格 + 拖动平移；滚轮缩放；拖动节点移动；空白处拖动框选；端口拖动连线',
    'toolbar.zoomIn': '放大',
    'toolbar.zoomOut': '缩小',
    'toolbar.zoomReset': '重置为 100%',
    'toolbar.fit': '适应画布',
    'minimap.label': '小地图',
    'node.collapse': '折叠节点',
    'node.expand': '展开节点',
    'node.bypass': '旁路',
    'node.note': '便签',
    'node.decode': '解码',
    'node.portAria': '节点 {node} 的端口 {port}（{type}，{dir}）',
    'port.dir.in': '输入',
    'port.dir.out': '输出',
    'connect.start': '已从「{node} · {port}」开始连线，请选择{dir}端口',
    'connect.done': '连线已建立',
    'connect.cancel': '已取消连线',
    'connect.reason.direction': '方向不对：只能从输出口连到输入口',
    'connect.reason.type': '类型不匹配：{from} 不能直接接到 {to}，中间需要显式转换节点',
    'connect.reason.self': '不能连到同一个节点',
    'connect.reason.duplicate': '这条连线已经存在',
    'connect.reason.cycle': '会形成环：图必须是有向无环图',
    'connect.reason.node-missing': '端口所属节点不存在',
    'connect.reason.port-missing': '端口不存在',
    'connect.reason.busy': '这个端口正在被拖动，先完成当前连线',
    'a11y.selected': '已选中 {count} 个对象',
    'a11y.moved': '已移动到 {x}, {y}',
    'a11y.deleted': '已删除 {count} 个对象',
    'a11y.copied': '已复制 {count} 个对象',
    'a11y.pasted': '已粘贴 {count} 个对象',
    'a11y.undo': '已撤销',
    'a11y.redo': '已重做',
    'a11y.nothingToUndo': '没有可撤销的操作',
    'a11y.nothingToRedo': '没有可重做的操作',
    'a11y.noSelection': '没有选中对象',
    'a11y.collapsed': '节点已折叠',
    'a11y.expanded': '节点已展开',
    'a11y.search': '打开节点搜索',
    'a11y.selectedAll': '已全选 {count} 个对象',
    'search.hint': '拖到空白处松开：请求节点搜索',
  },
  en: {
    'canvas.label': 'Node canvas',
    'canvas.hint': 'Space + drag to pan; wheel to zoom; drag nodes; drag on empty space to marquee; drag from a port to connect',
    'toolbar.zoomIn': 'Zoom in',
    'toolbar.zoomOut': 'Zoom out',
    'toolbar.zoomReset': 'Reset to 100%',
    'toolbar.fit': 'Fit to view',
    'minimap.label': 'Minimap',
    'node.collapse': 'Collapse node',
    'node.expand': 'Expand node',
    'node.bypass': 'Bypass',
    'node.note': 'Note',
    'node.decode': 'decode',
    'node.portAria': 'Port {port} of node {node} ({type}, {dir})',
    'port.dir.in': 'input',
    'port.dir.out': 'output',
    'connect.start': 'Connecting from "{node} · {port}", pick a {dir} port',
    'connect.done': 'Connection created',
    'connect.cancel': 'Connection cancelled',
    'connect.reason.direction': 'Wrong direction: connect an output port to an input port',
    'connect.reason.type': 'Type mismatch: {from} cannot connect to {to} without an explicit converter',
    'connect.reason.self': 'Cannot connect a node to itself',
    'connect.reason.duplicate': 'This connection already exists',
    'connect.reason.cycle': 'This would create a cycle; the graph must stay acyclic',
    'connect.reason.node-missing': 'The node of this port no longer exists',
    'connect.reason.port-missing': 'The port does not exist',
    'connect.reason.busy': 'Another connection is already in progress',
    'a11y.selected': '{count} objects selected',
    'a11y.moved': 'Moved to {x}, {y}',
    'a11y.deleted': '{count} objects deleted',
    'a11y.copied': '{count} objects copied',
    'a11y.pasted': '{count} objects pasted',
    'a11y.undo': 'Undone',
    'a11y.redo': 'Redone',
    'a11y.nothingToUndo': 'Nothing to undo',
    'a11y.nothingToRedo': 'Nothing to redo',
    'a11y.noSelection': 'Nothing is selected',
    'a11y.collapsed': 'Node collapsed',
    'a11y.expanded': 'Node expanded',
    'a11y.search': 'Open node search',
    'a11y.selectedAll': '{count} objects selected',
    'search.hint': 'Release on empty space to request node search',
  },
};

let uid = 0;

export class NodeCanvas {
  constructor(host, options = {}) {
    if (!host || !host.appendChild) throw new Error('createCanvas(host): host element required');
    this.host = host;
    this.options = { historyLimit: 200, grid: GEO.grid, snap: true, ...options };
    this.portProvider = typeof options.portProvider === 'function' ? options.portProvider : null;
    this.locale = options.locale === 'en' ? 'en' : 'zh';
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    this.rtl = options.rtl === true;
    this.grid = Number.isFinite(options.grid) ? options.grid : GEO.grid;
    this.snapEnabled = options.snap !== false;

    this.graph = normalizeGraph(options.graph || { schemaVersion: 1, nodes: [], edges: [], groups: [], viewport: { x: 0, y: 0, k: 1 } });
    this.view = { ...this.graph.viewport };
    this.selection = new Set();
    this.history = createHistory({ limit: Math.max(100, this.options.historyLimit) });
    this.clipboard = createClipboard();

    this._listeners = [];
    this._listenerCount = 0;
    this._nodeEls = new Map();
    this._edgeEls = new Map();
    this._groupEls = new Map();
    this._meta = new Map();
    this._boxes = new Map();
    this._portsCache = new Map();
    this._raf = 0;
    this._mmRaf = 0;
    this._destroyed = false;

    this.mode = 'idle';
    this.pointers = new Map();
    this.pending = null;
    this.spaceDown = false;
    this.drag = null;
    this.pinch = null;
    this._keyboardMoved = null;
    this._clipboardPastes = 0;

    this._buildDom();
    this._bind();
    this._rebuildAll();
    this.host.appendChild(this.root);
    this._applyView();
  }

  /* ------------------------------------------------------------------ DOM */

  _buildDom() {
    const root = document.createElement('div');
    root.className = 'nv-canvas';
    root.dataset.nvRoot = '';
    root.dir = this.rtl ? 'rtl' : 'ltr';

    const viewport = document.createElement('div');
    viewport.className = 'nv-viewport';
    viewport.dataset.nvViewport = '';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'application');
    viewport.setAttribute('aria-label', this.t('canvas.label'));
    viewport.setAttribute('aria-describedby', `nv-hint-${++uid}`);

    const world = document.createElement('div');
    world.className = 'nv-world';
    world.dataset.nvWorld = '';

    const groupLayer = document.createElement('div');
    groupLayer.className = 'nv-groups';
    groupLayer.dataset.nvGroups = '';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'nv-edges');
    svg.dataset.nvEdges = '';
    svg.setAttribute('aria-hidden', 'true');
    this.edgeGroup = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(this.edgeGroup);
    this.previewPath = document.createElementNS(SVG_NS, 'path');
    this.previewPath.setAttribute('class', 'nv-edge-preview');
    this.previewPath.setAttribute('hidden', '');
    svg.appendChild(this.previewPath);

    const nodeLayer = document.createElement('div');
    nodeLayer.className = 'nv-nodes';
    nodeLayer.dataset.nvNodes = '';

    world.append(groupLayer, svg, nodeLayer);

    const overlay = document.createElement('div');
    overlay.className = 'nv-overlay';
    overlay.dataset.nvOverlay = '';

    const marquee = document.createElement('div');
    marquee.className = 'nv-marquee';
    marquee.dataset.nvMarquee = '';
    marquee.hidden = true;

    const guideX = document.createElement('div');
    guideX.className = 'nv-guide nv-guide-x';
    guideX.dataset.axis = 'x';
    guideX.hidden = true;
    const guideY = document.createElement('div');
    guideY.className = 'nv-guide nv-guide-y';
    guideY.dataset.axis = 'y';
    guideY.hidden = true;

    overlay.append(guideX, guideY, marquee);
    viewport.appendChild(world);
    viewport.appendChild(overlay);

    const hud = document.createElement('div');
    hud.className = 'nv-hud';

    const zoomBox = document.createElement('div');
    zoomBox.className = 'nv-zoom';
    const mkBtn = (act, label, text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nv-zoom-btn';
      b.dataset.nvAct = act;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = text;
      return b;
    };
    this.btnZoomOut = mkBtn('zoom-out', this.t('toolbar.zoomOut'), '\u2212');
    this.btnZoomReset = mkBtn('zoom-reset', this.t('toolbar.zoomReset'), '100%');
    this.zoomLabel = document.createElement('span');
    this.zoomLabel.dataset.nvZoomLabel = '';
    this.zoomLabel.textContent = '100%';
    this.btnZoomReset.textContent = '';
    this.btnZoomReset.appendChild(this.zoomLabel);
    this.btnZoomIn = mkBtn('zoom-in', this.t('toolbar.zoomIn'), '+');
    this.btnFit = mkBtn('fit', this.t('toolbar.fit'), '\u2922');
    this.btnFit.classList.add('nv-zoom-btn-text');
    zoomBox.append(this.btnZoomOut, this.btnZoomReset, this.btnZoomIn, this.btnFit);

    const minimap = document.createElement('div');
    minimap.className = 'nv-minimap';
    minimap.dataset.nvMinimap = '';
    minimap.setAttribute('role', 'img');
    minimap.setAttribute('aria-label', this.t('minimap.label'));
    this.mmSvg = document.createElementNS(SVG_NS, 'svg');
    this.mmSvg.setAttribute('class', 'nv-mm-svg');
    this.mmContent = document.createElementNS(SVG_NS, 'g');
    this.mmViewRect = document.createElementNS(SVG_NS, 'rect');
    this.mmViewRect.setAttribute('class', 'nv-mm-view');
    this.mmViewRect.dataset.nvMmView = '';
    this.mmSvg.append(this.mmContent, this.mmViewRect);
    minimap.appendChild(this.mmSvg);

    hud.append(zoomBox, minimap);

    const live = document.createElement('div');
    live.className = 'nv-live';
    live.dataset.nvLive = '';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    live.setAttribute('role', 'status');

    const reason = document.createElement('div');
    reason.className = 'nv-connect-reason';
    reason.dataset.nvReason = '';
    reason.hidden = true;
    reason.setAttribute('role', 'status');

    const hint = document.createElement('p');
    hint.className = 'nv-hint';
    hint.id = `nv-hint-${uid}`;
    hint.textContent = this.t('canvas.hint');

    root.append(viewport, hud, live, reason, hint);
    this.root = root;
    this.viewportEl = viewport;
    this.worldEl = world;
    this.groupLayer = groupLayer;
    this.edgeSvg = svg;
    this.nodeLayer = nodeLayer;
    this.overlayEl = overlay;
    this.marqueeEl = marquee;
    this.guideX = guideX;
    this.guideY = guideY;
    this.minimapEl = minimap;
    this.liveEl = live;
    this.reasonEl = reason;
    this.hintEl = hint;
  }

  /* -------------------------------------------------------------- 基础工具 */

  t(key, vars) {
    const dict = STRINGS[this.locale] || STRINGS.zh;
    let text = dict[key] !== undefined ? dict[key] : (STRINGS.zh[key] !== undefined ? STRINGS.zh[key] : key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    }
    return text;
  }

  setLocale(locale) {
    this.locale = locale === 'en' ? 'en' : 'zh';
    this.viewportEl.setAttribute('aria-label', this.t('canvas.label'));
    this.btnZoomIn.setAttribute('aria-label', this.t('toolbar.zoomIn'));
    this.btnZoomOut.setAttribute('aria-label', this.t('toolbar.zoomOut'));
    this.btnZoomReset.setAttribute('aria-label', this.t('toolbar.zoomReset'));
    this.btnFit.setAttribute('aria-label', this.t('toolbar.fit'));
    this.minimapEl.setAttribute('aria-label', this.t('minimap.label'));
    this.hintEl.textContent = this.t('canvas.hint');
    this._rebuildAll();
    return this;
  }

  _listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push({ target, type, fn, opts });
    this._listenerCount += 1;
  }

  _emit(type, detail, { cancelable = false } = {}) {
    const ev = new CustomEvent(`nv:${type}`, { detail, bubbles: true, cancelable });
    this.host.dispatchEvent(ev);
    if (this.onEvent) this.onEvent(type, detail);
    return !ev.defaultPrevented;
  }

  _announce(message) {
    this.liveEl.textContent = '';
    // 读屏需要文本变化才能播报
    const node = document.createElement('span');
    node.textContent = message;
    this.liveEl.appendChild(node);
    this._emit('announce', { message });
  }

  /** 视口矩形缓存：拖动中每帧 getBoundingClientRect 会强制同步布局（实测拖垮到 20fps）。 */
  _viewportRect(force = false) {
    if (force || !this._rect) {
      const r = this.viewportEl.getBoundingClientRect();
      this._rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return this._rect;
  }

  _localPoint(ev) {
    const r = this._viewportRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  screenToWorld(pt) {
    return { x: (pt.x - this.view.x) / this.view.k, y: (pt.y - this.view.y) / this.view.k };
  }

  worldToScreen(pt) {
    return { x: pt.x * this.view.k + this.view.x, y: pt.y * this.view.k + this.view.y };
  }

  /* ------------------------------------------------------------ 端口表缓存 */

  _tableFor(node) {
    const key = `${node.opId}|${node.direction || ''}`;
    if (this._portsCache.has(key)) return this._portsCache.get(key);
    let raw = null;
    if (this.portProvider) {
      try {
        raw = this.portProvider(node);
      } catch (err) {
        raw = null;
      }
    }
    const table = normalizePortTable(raw, node.opId);
    this._portsCache.set(key, table);
    return table;
  }

  invalidatePorts(opId) {
    if (!opId) this._portsCache.clear();
    else for (const key of [...this._portsCache.keys()]) if (key.startsWith(`${opId}|`)) this._portsCache.delete(key);
    this._meta.clear();
    this._rebuildAll();
  }

  _metaFor(node) {
    let meta = this._meta.get(node.id);
    if (meta && meta.opId === node.opId && meta.dir === node.direction) return meta;
    const table = isNoteNode(node) ? { title: this.t('node.note'), ports: [] } : this._tableFor(node);
    const layout = portLayout(table.ports);
    meta = { table, layout, ports: table.ports, size: nodeSize(node, table.ports), opId: node.opId, dir: node.direction };
    this._meta.set(node.id, meta);
    return meta;
  }

  _boxOf(node) {
    const meta = this._metaFor(node);
    const size = nodeSize(node, meta.ports);
    return { x: node.x, y: node.y, w: size.w, h: size.h };
  }

  /* ---------------------------------------------------------------- 渲染 */

  _rebuildAll() {
    this._meta.clear();
    this._boxes.clear();
    this._nodeEls.clear();
    this._edgeEls.clear();
    this._groupEls.clear();
    this.edgeGroup.textContent = '';
    this.nodeLayer.textContent = '';
    this.groupLayer.textContent = '';

    for (const g of this.graph.groups) this.groupLayer.appendChild(this._createGroupEl(g));
    for (const n of this.graph.nodes) {
      const el = this._createNodeEl(n);
      this.nodeLayer.appendChild(el);
      this._boxes.set(n.id, this._boxOf(n));
    }
    for (const e of this.graph.edges) {
      const el = this._createEdgeEl(e);
      this.edgeGroup.appendChild(el);
      this._updateEdge(e);
    }
    this._syncSelectionClasses();
    this._updateMinimap(true);
  }

  _createNodeEl(node) {
    const el = document.createElement('div');
    el.className = 'nv-node';
    el.dataset.id = node.id;
    el.dataset.opId = node.opId;
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    const meta = this._metaFor(node);
    const size = nodeSize(node, meta.ports);
    el.style.width = `${size.w}px`;
    el.style.height = `${size.h}px`;
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;

    if (isNoteNode(node)) {
      el.classList.add('nv-note');
      const head = document.createElement('div');
      head.className = 'nv-note-head';
      head.textContent = node.noteTitle || this.t('node.note');
      const body = document.createElement('div');
      body.className = 'nv-note-body';
      body.textContent = node.note || '';
      el.append(head, body);
      el.setAttribute('aria-label', `${this.t('node.note')}: ${node.note || ''}`);
      this.nodeElsSet(el, node);
      return el;
    }

    const head = document.createElement('div');
    head.className = 'nv-node-head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nv-node-toggle';
    toggle.dataset.nvToggle = '';
    toggle.setAttribute('aria-expanded', node.collapsed === true ? 'false' : 'true');
    toggle.setAttribute('aria-label', node.collapsed === true ? this.t('node.expand') : this.t('node.collapse'));
    toggle.title = toggle.getAttribute('aria-label');
    const chev = document.createElement('span');
    chev.className = 'nv-chev';
    chev.setAttribute('aria-hidden', 'true');
    toggle.appendChild(chev);

    const title = document.createElement('span');
    title.className = 'nv-node-title';
    title.textContent = meta.table.title || node.opId;

    const dir = document.createElement('span');
    dir.className = 'nv-node-dir';
    dir.textContent = node.direction === 'decode' ? this.t('node.decode') : '';

    head.append(toggle, title, dir);

    const body = document.createElement('div');
    body.className = 'nv-body';
    if (node.collapsed === true) body.hidden = true;

    const colIn = document.createElement('div');
    colIn.className = 'nv-col nv-col-in';
    const colOut = document.createElement('div');
    colOut.className = 'nv-col nv-col-out';

    for (const p of meta.layout.ins) colIn.appendChild(this._createPortRow(node, p, meta));
    for (const p of meta.layout.outs) colOut.appendChild(this._createPortRow(node, p, meta));

    body.append(colIn, colOut);
    el.append(head, body);

    if (node.collapsed === true) el.classList.add('is-collapsed');
    if (node.disabled === true) el.classList.add('is-disabled');
    el.setAttribute('aria-label', `${meta.table.title || node.opId}${node.disabled ? ` (${this.t('node.bypass')})` : ''}`);
    el.title = meta.table.title || node.opId;
    this.nodeElsSet(el, node);
    return el;
  }

  nodeElsSet(el, node) {
    this._nodeEls.set(node.id, el);
  }

  _createPortRow(node, port, meta) {
    const row = document.createElement('div');
    row.className = `nv-port-row nv-port-row-${port.dir}`;
    row.dataset.portRow = port.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nv-port';
    btn.dataset.node = node.id;
    btn.dataset.port = port.id;
    btn.dataset.dir = port.dir;
    btn.dataset.type = port.type;
    btn.setAttribute('aria-label', this.t('node.portAria', {
      node: meta.table.title || node.opId,
      port: port.label,
      type: port.type,
      dir: port.dir === 'out' ? this.t('port.dir.out') : this.t('port.dir.in'),
    }));
    btn.title = `${port.label} · ${port.type}`;
    if (port.required) btn.dataset.required = '1';
    const label = document.createElement('span');
    label.className = 'nv-port-label';
    label.textContent = port.label;
    row.append(btn, label);
    return row;
  }

  _createGroupEl(group) {
    const el = document.createElement('div');
    el.className = 'nv-group';
    el.dataset.id = group.id;
    el.dataset.nvGroup = '';
    el.style.transform = `translate(${group.x}px, ${group.y}px)`;
    el.style.width = `${group.w}px`;
    el.style.height = `${group.h}px`;
    const head = document.createElement('div');
    head.className = 'nv-group-head';
    head.dataset.nvGroupHead = '';
    const title = document.createElement('span');
    title.className = 'nv-group-title';
    title.textContent = group.title || '';
    head.appendChild(title);
    const resize = document.createElement('div');
    resize.className = 'nv-group-resize';
    resize.dataset.nvResize = '';
    resize.setAttribute('aria-hidden', 'true');
    el.append(head, resize);
    this._groupEls.set(group.id, el);
    return el;
  }

  _createEdgeEl(edge) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'nv-edge');
    g.dataset.id = edge.id;
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('class', 'nv-edge-hit');
    hit.dataset.nvEdgeHit = edge.id;
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('class', 'nv-edge-line');
    line.dataset.nvEdgeLine = edge.id;
    g.append(hit, line);
    this._edgeEls.set(edge.id, { g, hit, line });
    return g;
  }

  _anchor(nodeId, portId) {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const meta = this._metaFor(node);
    return portAnchor(node, portId, meta.ports, GEO, this.rtl);
  }

  _updateEdge(edge) {
    const entry = this._edgeEls.get(edge.id);
    if (!entry) return;
    const a = this._anchor(edge.from.node, edge.from.port);
    const b = this._anchor(edge.to.node, edge.to.port);
    if (!a || !b) {
      entry.line.setAttribute('d', '');
      entry.hit.setAttribute('d', '');
      return;
    }
    const d = edgePath(a, b, this.rtl);
    entry.line.setAttribute('d', d);
    entry.hit.setAttribute('d', d);
    entry.line.dataset.from = `${edge.from.node}:${edge.from.port}`;
    entry.line.dataset.to = `${edge.to.node}:${edge.to.port}`;
  }

  _updateEdgesFor(nodeIds) {
    for (const e of this.graph.edges) {
      if (nodeIds.has(e.from.node) || nodeIds.has(e.to.node)) {
        this._updateEdge(e);
        if (this.selection.has(e.id)) this._positionHandles(e.id);
      }
    }
  }

  _applyView() {
    this.worldEl.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.k})`;
    this.zoomLabel.textContent = `${Math.round(this.view.k * 100)}%`;
    this.graph.viewport = { ...this.view };
    this._updateMinimapView();
    this._emit('viewport-change', { ...this.view });
  }

  _syncSelectionClasses() {
    for (const [id, el] of this._nodeEls) {
      const on = this.selection.has(id);
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-current', on ? 'true' : 'false');
    }
    for (const [id, el] of this._groupEls) el.classList.toggle('is-selected', this.selection.has(id));
    for (const [id, entry] of this._edgeEls) {
      const on = this.selection.has(id);
      entry.g.classList.toggle('is-selected', on);
      if (on) this._ensureEdgeHandles(id);
      else this._removeEdgeHandles(id);
    }
  }

  /* -------------------------------------------------------------- 小地图 */

  _graphBBox() {
    const nodes = this.graph.nodes.map((n) => ({ box: this._boxOf(n) }));
    return graphBBox(nodes, this.graph.groups);
  }

  _updateMinimap(force = false) {
    if (!force && this._mmRaf) return;
    if (force) {
      cancelAnimationFrame(this._mmRaf);
    }
    this._mmRaf = requestAnimationFrame(() => {
      this._mmRaf = 0;
      if (this._destroyed) return;
      const bbox = this._graphBBox();
      const pad = 40;
      const world = bbox ? { x: bbox.x - pad, y: bbox.y - pad, w: bbox.w + pad * 2, h: bbox.h + pad * 2 } : { x: -200, y: -200, w: 400, h: 400 };
      this._mmWorld = world;
      this.mmSvg.setAttribute('viewBox', `${world.x} ${world.y} ${world.w} ${world.h}`);
      this.mmSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const frag = document.createDocumentFragment();
      this._mmRects = new Map();
      for (const g of this.graph.groups) {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', g.x);
        r.setAttribute('y', g.y);
        r.setAttribute('width', g.w);
        r.setAttribute('height', g.h);
        r.setAttribute('class', 'nv-mm-group');
        frag.appendChild(r);
        this._mmRects.set(g.id, r);
      }
      for (const n of this.graph.nodes) {
        const b = this._boxes.get(n.id) || this._boxOf(n);
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', b.x);
        r.setAttribute('y', b.y);
        r.setAttribute('width', b.w);
        r.setAttribute('height', b.h);
        r.setAttribute('rx', 4);
        r.setAttribute('class', this.selection.has(n.id) ? 'nv-mm-node is-selected' : 'nv-mm-node');
        frag.appendChild(r);
        this._mmRects.set(n.id, r);
      }
      this.mmContent.textContent = '';
      this.mmContent.appendChild(frag);
      this._updateMinimapView();
    });
  }

  /** 拖动/微移时只搬动受影响的小地图方块，不重建 300 个 rect。 */
  _moveMinimapRects(ids) {
    if (!this._mmRects) return;
    for (const id of ids) {
      const r = this._mmRects.get(id);
      if (!r) continue;
      if (this._nodeEls.has(id)) {
        const b = this._boxes.get(id);
        if (b) {
          r.setAttribute('x', b.x);
          r.setAttribute('y', b.y);
        }
      } else {
        const g = this.graph.groups.find((x) => x.id === id);
        if (g) {
          r.setAttribute('x', g.x);
          r.setAttribute('y', g.y);
          r.setAttribute('width', g.w);
          r.setAttribute('height', g.h);
        }
      }
    }
    this._updateMinimapView();
  }

  _updateMinimapView() {
    const world = this._mmWorld;
    if (!world) return;
    const vx = -this.view.x / this.view.k;
    const vy = -this.view.y / this.view.k;
    const vw = this.viewportEl.clientWidth / this.view.k;
    const vh = this.viewportEl.clientHeight / this.view.k;
    this.mmViewRect.setAttribute('x', vx);
    this.mmViewRect.setAttribute('y', vy);
    this.mmViewRect.setAttribute('width', Math.max(1, vw));
    this.mmViewRect.setAttribute('height', Math.max(1, vh));
    this.mmViewRect.setAttribute('vector-effect', 'non-scaling-stroke');
  }

  /* ------------------------------------------------------------ 视口操作 */

  zoomAt(factor, point) {
    const k = clamp(this.view.k * factor, GEO.minZoom, GEO.maxZoom);
    if (k === this.view.k) return;
    const wx = (point.x - this.view.x) / this.view.k;
    const wy = (point.y - this.view.y) / this.view.k;
    this.view = { x: point.x - wx * k, y: point.y - wy * k, k };
    this._applyView();
  }

  zoomBy(factor) {
    this.zoomAt(factor, { x: this.viewportEl.clientWidth / 2, y: this.viewportEl.clientHeight / 2 });
  }

  resetZoom() {
    const cx = this.viewportEl.clientWidth / 2;
    const cy = this.viewportEl.clientHeight / 2;
    const w = this.screenToWorld({ x: cx, y: cy });
    this.view = { x: cx - w.x, y: cy - w.y, k: 1 };
    this._applyView();
  }

  panBy(dx, dy) {
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
    this._applyView();
  }

  fitView({ padding = 48 } = {}) {
    const W = this.viewportEl.clientWidth || 800;
    const H = this.viewportEl.clientHeight || 600;
    const bbox = this._graphBBox();
    if (!bbox) {
      this.view = { x: W / 2, y: H / 2, k: 1 };
      this._applyView();
      return;
    }
    const k = clamp(Math.min((W - padding * 2) / bbox.w, (H - padding * 2) / bbox.h), GEO.minZoom, 1.5);
    this.view = {
      x: (W - bbox.w * k) / 2 - bbox.x * k,
      y: (H - bbox.h * k) / 2 - bbox.y * k,
      k,
    };
    this._applyView();
  }

  centerOn(worldPt) {
    this.view = {
      ...this.view,
      x: this.viewportEl.clientWidth / 2 - worldPt.x * this.view.k,
      y: this.viewportEl.clientHeight / 2 - worldPt.y * this.view.k,
    };
    this._applyView();
  }

  /* -------------------------------------------------------------- 图操作 */

  getGraph() {
    this.graph.viewport = { ...this.view };
    return clone(this.graph);
  }

  setGraph(raw, { preserveView = false, silent = false } = {}) {
    const g = normalizeGraph(raw);
    this.graph = g;
    this._portsCache.clear();
    this.history.clear();
    if (!preserveView) this.view = { ...g.viewport };
    this.selection = new Set([...this.selection].filter((id) => this._idExists(id)));
    this._rebuildAll();
    this._applyView();
    if (!silent) this._emit('graph-change', { graph: this.getGraph(), reason: 'set-graph' });
    return this;
  }

  _idExists(id) {
    return this.graph.nodes.some((n) => n.id === id) || this.graph.groups.some((g) => g.id === id) || this.graph.edges.some((e) => e.id === id);
  }

  _snapshot() {
    return { graph: clone(this.graph), selection: [...this.selection] };
  }

  _commit(before, reason = 'edit') {
    this.history.record(before);
    this._afterGraphChange(reason);
  }

  _afterGraphChange(reason) {
    for (const n of this.graph.nodes) this._boxes.set(n.id, this._boxOf(n));
    this._updateMinimap(true);
    this._emit('graph-change', { graph: this.getGraph(), reason });
  }

  addNode(spec, { focus = false, select = true, commit = true } = {}) {
    if (!spec || !spec.opId) throw new NvGraphError('node/op-required', 'addNode requires opId');
    const before = commit ? this._snapshot() : null;
    const existing = new Set([...this.graph.nodes.map((n) => n.id), ...this.graph.groups.map((g) => g.id), ...this.graph.edges.map((e) => e.id)]);
    const id = spec.id && !existing.has(spec.id) ? spec.id : createId('n', existing);
    const size = nodeSize({ opId: spec.opId, x: 0, y: 0, w: spec.w || GEO.width, collapsed: spec.collapsed === true }, this._tableFor(spec).ports);
    const center = this.screenToWorld({ x: this.viewportEl.clientWidth / 2, y: this.viewportEl.clientHeight / 2 });
    const node = {
      id,
      opId: spec.opId,
      direction: spec.direction === 'decode' ? 'decode' : 'encode',
      params: spec.params && typeof spec.params === 'object' ? clone(spec.params) : {},
      x: Number.isFinite(spec.x) ? Math.round(spec.x) : Math.round(center.x - size.w / 2),
      y: Number.isFinite(spec.y) ? Math.round(spec.y) : Math.round(center.y - size.h / 2),
      w: spec.w || GEO.width,
    };
    if (spec.collapsed === true) node.collapsed = true;
    if (spec.disabled === true) node.disabled = true;
    if (typeof spec.note === 'string') node.note = spec.note;
    this.graph.nodes.push(node);
    this._meta.delete(node.id);
    const el = this._createNodeEl(node);
    this.nodeLayer.appendChild(el);
    this._boxes.set(node.id, this._boxOf(node));
    if (select) this.selection = new Set([node.id]);
    this._syncSelectionClasses();
    if (commit) this._commit(before, 'add-node');
    else this._afterGraphChange('add-node');
    if (focus) this.focusNode(node.id);
    return node.id;
  }

  removeIds(ids) {
    const set = new Set(ids);
    if (!set.size) return 0;
    const before = this._snapshot();
    this.graph.nodes = this.graph.nodes.filter((n) => !set.has(n.id));
    this.graph.groups = this.graph.groups.filter((g) => !set.has(g.id));
    this.graph.edges = this.graph.edges.filter((e) => !set.has(e.id) && !set.has(e.from.node) && !set.has(e.to.node));
    for (const id of set) this.selection.delete(id);
    this._rebuildAll();
    this._commit(before, 'remove');
    return set.size;
  }

  deleteSelection() {
    if (!this.selection.size) {
      this._announce(this.t('a11y.noSelection'));
      return 0;
    }
    const count = this.removeIds([...this.selection]);
    this._announce(this.t('a11y.deleted', { count }));
    this._emit('selection-change', { selection: [] });
    return count;
  }

  select(ids, { add = false } = {}) {
    const list = Array.isArray(ids) ? ids : [ids];
    const next = add ? new Set(this.selection) : new Set();
    for (const id of list) if (this._idExists(id)) next.add(id);
    this.selection = next;
    this._syncSelectionClasses();
    this._updateMinimap(true);
    this._emit('selection-change', { selection: [...this.selection] });
    return this;
  }

  clearSelection() {
    this.select([]);
  }

  getSelection() {
    return [...this.selection];
  }

  selectAll() {
    const ids = [...this.graph.nodes.map((n) => n.id), ...this.graph.groups.map((g) => g.id)];
    this.selection = new Set(ids);
    this._syncSelectionClasses();
    this._updateMinimap(true);
    this._emit('selection-change', { selection: ids });
    this._announce(this.t('a11y.selectedAll', { count: ids.length }));
  }

  /* ---------------------------------------------------------- 复制粘贴 */

  copySelection() {
    const nodes = this.graph.nodes.filter((n) => this.selection.has(n.id)).map((n) => clone(n));
    const groups = this.graph.groups.filter((g) => this.selection.has(g.id)).map((g) => clone(g));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = this.graph.edges.filter((e) => nodeIds.has(e.from.node) && nodeIds.has(e.to.node)).map((e) => clone(e));
    if (!nodes.length && !groups.length) {
      this._announce(this.t('a11y.noSelection'));
      return false;
    }
    this.clipboard.write({ nodes, groups, edges });
    this._announce(this.t('a11y.copied', { count: nodes.length + groups.length }));
    return true;
  }

  paste({ offset = 24 } = {}) {
    const payload = this.clipboard.read();
    if (!payload) return [];
    const before = this._snapshot();
    this._clipboardPastes += 1;
    const dx = offset * this._clipboardPastes;
    const dy = offset * this._clipboardPastes;
    const existing = new Set([...this.graph.nodes.map((n) => n.id), ...this.graph.groups.map((g) => g.id), ...this.graph.edges.map((e) => e.id)]);
    const map = new Map();
    const newNodes = payload.nodes.map((n) => {
      const id = createId('n', existing);
      map.set(n.id, id);
      return { ...clone(n), id, x: n.x + dx, y: n.y + dy };
    });
    for (const n of newNodes) {
      this.graph.nodes.push(n);
      this._meta.delete(n.id);
      this.nodeLayer.appendChild(this._createNodeEl(n));
      this._boxes.set(n.id, this._boxOf(n));
    }
    const newGroups = payload.groups.map((g) => {
      const id = createId('g', existing);
      map.set(g.id, id);
      return { ...clone(g), id, x: g.x + dx, y: g.y + dy };
    });
    for (const g of newGroups) {
      this.graph.groups.push(g);
      this.groupLayer.appendChild(this._createGroupEl(g));
    }
    const newEdges = payload.edges
      .filter((e) => map.has(e.from.node) && map.has(e.to.node))
      .map((e) => ({
        id: createId('e', existing),
        from: { node: map.get(e.from.node), port: e.from.port },
        to: { node: map.get(e.to.node), port: e.to.port },
      }));
    for (const e of newEdges) {
      this.graph.edges.push(e);
      this.edgeGroup.appendChild(this._createEdgeEl(e));
      this._updateEdge(e);
    }
    this.selection = new Set([...newNodes.map((n) => n.id), ...newGroups.map((g) => g.id)]);
    this._syncSelectionClasses();
    this._commit(before, 'paste');
    this._announce(this.t('a11y.pasted', { count: newNodes.length + newGroups.length }));
    return [...this.selection];
  }

  duplicateSelection() {
    if (this.copySelection()) return this.paste();
    return [];
  }

  /** 公开连线入口（宿主在「节点搜索」里建好节点后调用）。 */
  connect(from, to, { commit = true } = {}) {
    const result = validateConnection({ graph: this.graph, from, to, getPorts: (n) => this._tableFor(n) });
    if (!result.ok) {
      this._announce(this.t(`connect.reason.${result.code}`, result.vars || {}));
      return { ok: false, ...result };
    }
    const fromPort = this._portInfo(from.node, from.port);
    const detail = { from: { ...from }, to: { ...to }, type: fromPort ? fromPort.type : 'text', reconnectOf: null, via: 'api' };
    if (!this._emit('connect-request', detail, { cancelable: true })) return { ok: false, code: 'rejected', vars: {} };
    const before = commit ? this._snapshot() : null;
    const existing = new Set(this.graph.edges.map((e) => e.id));
    const edge = { id: createId('e', existing), from: { ...from }, to: { ...to } };
    this.graph.edges.push(edge);
    this.edgeGroup.appendChild(this._createEdgeEl(edge));
    this._updateEdge(edge);
    if (commit) this._commit(before, 'connect');
    else this._afterGraphChange('connect');
    return { ok: true, edgeId: edge.id };
  }

  /* -------------------------------------------------------------- 视图/方向 */

  setRtl(on) {
    const next = !!on;
    if (next === this.rtl) return this;
    this.rtl = next;
    this.root.dir = next ? 'rtl' : 'ltr';
    this._rebuildAll();
    return this;
  }

  isRtl() {
    return this.rtl;
  }

  getViewport() {
    return { ...this.view };
  }

  setViewport(vp) {
    this.view = {
      x: Number.isFinite(vp.x) ? vp.x : this.view.x,
      y: Number.isFinite(vp.y) ? vp.y : this.view.y,
      k: clamp(Number.isFinite(vp.k) ? vp.k : this.view.k, GEO.minZoom, GEO.maxZoom),
    };
    this._applyView();
    return this;
  }

  /* ------------------------------------------------------------ 撤销重做 */

  undo() {
    const cur = this._snapshot();
    const prev = this.history.undo(cur);
    if (!prev) {
      this._announce(this.t('a11y.nothingToUndo'));
      return false;
    }
    this._restore(prev, 'undo');
    this._announce(this.t('a11y.undo'));
    return true;
  }

  redo() {
    const cur = this._snapshot();
    const next = this.history.redo(cur);
    if (!next) {
      this._announce(this.t('a11y.nothingToRedo'));
      return false;
    }
    this._restore(next, 'redo');
    this._announce(this.t('a11y.redo'));
    return true;
  }

  _restore(snap, reason) {
    const hadFocus = this.viewportEl.contains(document.activeElement) || document.activeElement === this.viewportEl;
    const view = { ...this.view };
    this.graph = normalizeGraph(snap.graph);
    this.graph.viewport = view;
    this.view = view;
    this.selection = new Set((snap.selection || []).filter((id) => this._idExists(id)));
    this._rebuildAll();
    this._applyView();
    this._emit('selection-change', { selection: [...this.selection] });
    this._emit('graph-change', { graph: this.getGraph(), reason });
    if (hadFocus) this.viewportEl.focus({ preventScroll: true });
  }

  canUndo() { return this.history.canUndo; }
  canRedo() { return this.history.canRedo; }
  historySize() { return { undo: this.history.undoSize, redo: this.history.redoSize, limit: this.history.limit }; }

  /* ------------------------------------------------------------ 折叠/旁路 */

  toggleCollapse(nodeId) {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node || isNoteNode(node)) return false;
    const before = this._snapshot();
    if (node.collapsed === true) delete node.collapsed;
    else node.collapsed = true;
    const el = this._nodeEls.get(nodeId);
    if (el) {
      const meta = this._metaFor(node);
      const size = nodeSize(node, meta.ports);
      el.style.height = `${size.h}px`;
      el.classList.toggle('is-collapsed', node.collapsed === true);
      const body = el.querySelector('.nv-body');
      if (body) body.hidden = node.collapsed === true;
      const toggle = el.querySelector('.nv-node-toggle');
      if (toggle) {
        toggle.setAttribute('aria-expanded', node.collapsed === true ? 'false' : 'true');
        const label = node.collapsed === true ? this.t('node.expand') : this.t('node.collapse');
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
      }
    }
    this._boxes.set(nodeId, this._boxOf(node));
    this._updateEdgesFor(new Set([nodeId]));
    this._commit(before, 'collapse');
    this._announce(this.t(node.collapsed === true ? 'a11y.collapsed' : 'a11y.expanded'));
    return true;
  }

  toggleDisabled(nodeId) {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node || isNoteNode(node)) return false;
    const before = this._snapshot();
    if (node.disabled === true) delete node.disabled;
    else node.disabled = true;
    const el = this._nodeEls.get(nodeId);
    if (el) {
      const meta = this._metaFor(node);
      el.classList.toggle('is-disabled', node.disabled === true);
      el.setAttribute('aria-label', `${meta.table.title || node.opId}${node.disabled === true ? ` (${this.t('node.bypass')})` : ''}`);
    }
    this._commit(before, 'toggle-disabled');
    return true;
  }

  /* -------------------------------------------------------------- 焦点 */

  focusNode(id) {
    const el = this._nodeEls.get(id);
    if (el) el.focus({ preventScroll: true });
  }

  focusPort(nodeId, portId) {
    const el = this.nodeLayer.querySelector(`.nv-port[data-node="${cssEscape(nodeId)}"][data-port="${cssEscape(portId)}"]`);
    if (el) el.focus({ preventScroll: true });
  }

  focusCanvas() {
    this.viewportEl.focus({ preventScroll: true });
  }

  /* -------------------------------------------------------------- 事件绑定 */

  _bind() {
    const vp = this.viewportEl;
    this._onPointerDown = (e) => this._pointerDown(e);
    this._onPointerMove = (e) => this._pointerMove(e);
    this._onPointerUp = (e) => this._pointerUp(e);
    this._onWheel = (e) => this._wheel(e);
    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this._keyUp(e);
    this._onClick = (e) => this._click(e);

    this._listen(vp, 'pointerdown', this._onPointerDown);
    this._listen(vp, 'pointermove', this._onPointerMove);
    this._listen(vp, 'pointerup', this._onPointerUp);
    this._listen(vp, 'pointercancel', this._onPointerUp);
    this._listen(vp, 'wheel', this._onWheel, { passive: false });
    this._listen(vp, 'keydown', this._onKeyDown);
    this._listen(vp, 'keyup', this._onKeyUp);
    this._listen(vp, 'click', this._onClick);
    this._listen(vp, 'contextmenu', (e) => {
      if (e.target.closest('.nv-node')) e.preventDefault();
    });

    this._listen(this.root.querySelector('[data-nv-act="zoom-in"]'), 'click', () => this.zoomBy(1.2));
    this._listen(this.root.querySelector('[data-nv-act="zoom-out"]'), 'click', () => this.zoomBy(1 / 1.2));
    this._listen(this.root.querySelector('[data-nv-act="zoom-reset"]'), 'click', () => this.resetZoom());
    this._listen(this.root.querySelector('[data-nv-act="fit"]'), 'click', () => this.fitView());

    this._onMmDown = (e) => this._minimapDown(e);
    this._onMmMove = (e) => this._minimapMove(e);
    this._onMmUp = (e) => this._minimapUp(e);
    this._listen(this.minimapEl, 'pointerdown', this._onMmDown);
    this._listen(this.minimapEl, 'pointermove', this._onMmMove);
    this._listen(this.minimapEl, 'pointerup', this._onMmUp);

    this._onResize = () => {
      this._viewportRect(true);
      this._updateMinimapView();
    };
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(vp);
    } else {
      this._listen(window, 'resize', this._onResize);
    }
    this._onWindowKey = (e) => {
      const t = e.target;
      if (t === document.body || t === document.documentElement) this._keyDown(e);
    };
    this._listen(window, 'keydown', this._onWindowKey);
    this._listen(window, 'scroll', () => this._viewportRect(true), true);
    this._listen(window, 'resize', () => this._viewportRect(true));
    this._listen(window, 'blur', () => {
      this.spaceDown = false;
      this.root.classList.remove('is-panning');
    });
  }

  /* ------------------------------------------------------------ 指针交互 */

  _pointerDown(e) {
    if (e.button === 2) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (this.pointers.size === 2) {
      this._beginPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    this._viewportRect(true);
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    // 折叠按钮走原生 click，不抢指针（抢了会把 click 重定向到视口）
    if (target.closest('[data-nv-toggle]')) return;

    try {
      this.viewportEl.setPointerCapture(e.pointerId);
    } catch (err) {
      // 合成事件 / 已释放的 pointerId 不中断交互
    }
    this._downPoint = this._localPoint(e);
    this._downClient = { x: e.clientX, y: e.clientY };
    this._moved = false;

    const portEl = target.closest('.nv-port');
    const endpoint = target.closest('.nv-edge-endpoint');
    const edgeHit = target.closest('.nv-edge-hit');
    const groupResize = target.closest('[data-nv-resize]');
    const groupHead = target.closest('[data-nv-group-head]');
    const nodeEl = target.closest('.nv-node');

    if (e.button === 1 || this.spaceDown) {
      this._startPan();
      e.preventDefault();
      return;
    }

    if (portEl) {
      e.preventDefault();
      portEl.focus({ preventScroll: true });
      this._startConnect({
        node: portEl.dataset.node,
        port: portEl.dataset.port,
        dir: portEl.dataset.dir,
        type: portEl.dataset.type,
      });
      return;
    }

    if (endpoint) {
      e.preventDefault();
      this._startReconnect(endpoint.dataset.edge, endpoint.dataset.end);
      return;
    }

    if (edgeHit) {
      const id = edgeHit.dataset.nvEdgeHit;
      if (e.shiftKey) this.select([id], { add: true });
      else this.select([id]);
      this._emit('selection-change', { selection: [...this.selection] });
      return;
    }

    if (groupResize) {
      e.preventDefault();
      const el = groupResize.closest('.nv-group');
      const group = this.graph.groups.find((g) => g.id === el.dataset.id);
      if (!group) return;
      this.mode = 'resize-group';
      this.drag = { before: this._snapshot(), group, start: this._worldPoint(e), id: group.id };
      return;
    }

    if (groupHead) {
      e.preventDefault();
      const el = groupHead.closest('.nv-group');
      const group = this.graph.groups.find((g) => g.id === el.dataset.id);
      if (!group) return;
      this.select([group.id], { add: e.shiftKey });
      const children = this.graph.nodes.filter((n) => {
        const b = this._boxes.get(n.id) || this._boxOf(n);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        return cx >= group.x && cx <= group.x + group.w && cy >= group.y && cy <= group.y + group.h;
      });
      this.mode = 'drag-group';
      this.drag = { before: this._snapshot(), group, children, start: this._worldPoint(e), orig: { x: group.x, y: group.y } };
      return;
    }

    if (nodeEl) {
      e.preventDefault();
      const id = nodeEl.dataset.id;
      const wasSelected = this.selection.has(id);
      if (e.shiftKey) {
        if (wasSelected) this.selection.delete(id);
        else this.selection.add(id);
        this._syncSelectionClasses();
        this._emit('selection-change', { selection: [...this.selection] });
        if (!wasSelected) return;
      } else if (!wasSelected) {
        this.select([id]);
      }
      if (!this.selection.size) return;
      nodeEl.focus({ preventScroll: true });
      const origins = new Map();
      for (const nid of this.selection) {
        const n = this.graph.nodes.find((x) => x.id === nid);
        if (n) origins.set(nid, { x: n.x, y: n.y });
      }
      this.mode = 'drag-nodes';
      const moving = new Set(origins.keys());
      this.drag = {
        before: this._snapshot(),
        start: this._worldPoint(e),
        origins,
        moved: false,
        // 拖动期间其余节点不动：一次性缓存，避免每帧重建 300 个包围盒
        others: this.graph.nodes.filter((n) => !moving.has(n.id)).map((n) => this._boxes.get(n.id) || this._boxOf(n)),
        edgeIds: this.graph.edges.filter((edge) => moving.has(edge.from.node) || moving.has(edge.to.node)).map((edge) => edge.id),
      };
      this.root.classList.add('is-dragging');
      return;
    }

    // 空白处
    this.viewportEl.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      this._startPan();
      return;
    }
    if (!e.shiftKey) this.select([]);
    this.mode = 'marquee';
    this.drag = { start: this._localPoint(e), startWorld: this._worldPoint(e), additive: e.shiftKey };
    this.marqueeEl.hidden = false;
    this._updateMarquee(this._localPoint(e));
  }

  _startPan() {
    this.mode = 'pan';
    this.drag = { startClient: { ...this._downClient }, view: { ...this.view } };
    this.root.classList.add('is-panning');
  }

  _worldPoint(e) {
    return this.screenToWorld(this._localPoint(e));
  }

  _pointerMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (this.mode === 'pinch') {
      this._updatePinch();
      return;
    }
    if (this.mode === 'idle' && !this.pending) return;
    if (Math.abs(e.clientX - (this._downClient ? this._downClient.x : e.clientX)) > 3 ||
        Math.abs(e.clientY - (this._downClient ? this._downClient.y : e.clientY)) > 3) {
      this._moved = true;
    }

    switch (this.mode) {
      case 'pan': {
        const dx = e.clientX - this.drag.startClient.x;
        const dy = e.clientY - this.drag.startClient.y;
        this.view = { ...this.view, x: this.drag.view.x + dx, y: this.drag.view.y + dy };
        this._applyView();
        break;
      }
      case 'drag-nodes':
        this._dragNodes(e);
        break;
      case 'drag-group':
        this._dragGroup(e);
        break;
      case 'resize-group':
        this._resizeGroup(e);
        break;
      case 'marquee':
        this._updateMarquee(this._localPoint(e));
        break;
      default:
        break;
    }
    if (this.pending) this._updateConnectPreview(e);
  }

  _pointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.mode === 'pinch') {
      if (this.pointers.size < 2) {
        this.mode = 'idle';
        this.pinch = null;
      }
      return;
    }
    if (this.viewportEl.hasPointerCapture && this.viewportEl.hasPointerCapture(e.pointerId)) {
      this.viewportEl.releasePointerCapture(e.pointerId);
    }
    const mode = this.mode;
    this.mode = 'idle';
    this.root.classList.remove('is-panning', 'is-dragging');

    if (mode === 'pan') {
      this._emit('viewport-change', { ...this.view });
      return;
    }

    if (mode === 'drag-nodes' && this.drag) {
      if (this.drag.moved) this._commit(this.drag.before, 'move-nodes');
      this._hideGuides();
      this.drag = null;
      return;
    }

    if (mode === 'drag-group' && this.drag) {
      if (this.drag.moved) this._commit(this.drag.before, 'move-group');
      this.drag = null;
      return;
    }

    if (mode === 'resize-group' && this.drag) {
      if (this.drag.moved !== false) this._commit(this.drag.before, 'resize-group');
      this.drag = null;
      return;
    }

    if (mode === 'marquee' && this.drag) {
      this._finishMarquee();
      this.drag = null;
      this.marqueeEl.hidden = true;
      return;
    }

    if (this.pending) {
      if (!this._moved) {
        this._cancelConnect({ requestSearch: false });
        return;
      }
      const portEl = this._portAt(e.clientX, e.clientY);
      if (portEl) {
        this._completeConnect({
          node: portEl.dataset.node,
          port: portEl.dataset.port,
          dir: portEl.dataset.dir,
          type: portEl.dataset.type,
        }, 'pointer');
      } else {
        this._cancelConnect({ requestSearch: !this.pending.edgeId, point: this._worldPoint(e) });
      }
    }
  }

  _click(e) {
    const toggle = e.target.closest('[data-nv-toggle]');
    if (toggle) {
      const nodeEl = toggle.closest('.nv-node');
      this.toggleCollapse(nodeEl.dataset.id);
    }
  }

  _dragNodes(e) {
    const drag = this.drag;
    if (!drag) return;
    const world = this._worldPoint(e);
    let dx = world.x - drag.start.x;
    let dy = world.y - drag.start.y;
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) drag.moved = true;

    const movingBoxes = [];
    for (const [id, origin] of drag.origins) {
      const n = this.graph.nodes.find((x) => x.id === id);
      if (!n) continue;
      const box = this._boxes.get(id) || this._boxOf(n);
      movingBoxes.push({ x: origin.x + dx, y: origin.y + dy, w: box.w, h: box.h });
    }
    const union = selectionBBox(movingBoxes);
    let snapped = { dx: 0, dy: 0, guides: [] };
    if (this.snapEnabled && union) {
      snapped = computeSnap({
        moving: union,
        others: drag.others,
        threshold: 6 / this.view.k,
        grid: this.grid,
        snapAlign: true,
        snapGrid: true,
      });
      dx += snapped.dx;
      dy += snapped.dy;
    }
    this._showGuides(snapped.guides);

    for (const [id, origin] of drag.origins) {
      const n = this.graph.nodes.find((x) => x.id === id);
      if (!n) continue;
      n.x = Math.round(origin.x + dx);
      n.y = Math.round(origin.y + dy);
      const el = this._nodeEls.get(id);
      if (el) el.style.transform = `translate(${n.x}px, ${n.y}px)`;
      this._boxes.set(id, this._boxOf(n));
    }
    for (const id of drag.edgeIds) {
      const edge = this.graph.edges.find((x) => x.id === id);
      if (!edge) continue;
      this._updateEdge(edge);
      if (this.selection.has(id)) this._positionHandles(id);
    }
    this._moveMinimapRects(drag.origins.keys());
  }

  _dragGroup(e) {
    const drag = this.drag;
    const world = this._worldPoint(e);
    const dx = Math.round(world.x - drag.start.x);
    const dy = Math.round(world.y - drag.start.y);
    if (dx || dy) drag.moved = true;
    drag.group.x = Math.round(drag.orig.x + dx);
    drag.group.y = Math.round(drag.orig.y + dy);
    const el = this._groupEls.get(drag.id);
    if (el) el.style.transform = `translate(${drag.group.x}px, ${drag.group.y}px)`;
    const changed = new Set();
    for (const child of drag.children) {
      child.x += dx - (drag.lastDx || 0);
      child.y += dy - (drag.lastDy || 0);
      const cel = this._nodeEls.get(child.id);
      if (cel) cel.style.transform = `translate(${child.x}px, ${child.y}px)`;
      this._boxes.set(child.id, this._boxOf(child));
      changed.add(child.id);
    }
    drag.lastDx = dx;
    drag.lastDy = dy;
    this._updateEdgesFor(changed);
    this._moveMinimapRects([...changed, drag.id]);
  }

  _resizeGroup(e) {
    const drag = this.drag;
    const world = this._worldPoint(e);
    drag.group.w = Math.max(120, Math.round(world.x - drag.group.x));
    drag.group.h = Math.max(80, Math.round(world.y - drag.group.y));
    const el = this._groupEls.get(drag.id);
    if (el) {
      el.style.width = `${drag.group.w}px`;
      el.style.height = `${drag.group.h}px`;
    }
    this._updateMinimap();
  }

  /* -------------------------------------------------------------- 框选 */

  _updateMarquee(pt) {
    const a = this.drag ? this.drag.start : pt;
    const x = Math.min(a.x, pt.x);
    const y = Math.min(a.y, pt.y);
    const w = Math.abs(pt.x - a.x);
    const h = Math.abs(pt.y - a.y);
    this.marqueeEl.style.transform = `translate(${x}px, ${y}px)`;
    this.marqueeEl.style.width = `${w}px`;
    this.marqueeEl.style.height = `${h}px`;
  }

  _finishMarquee() {
    const rect = this.marqueeEl.getBoundingClientRect();
    if (rect.width < 3 && rect.height < 3) return;
    const world = {
      x: (rect.left - this.viewportEl.getBoundingClientRect().left - this.view.x) / this.view.k,
      y: (rect.top - this.viewportEl.getBoundingClientRect().top - this.view.y) / this.view.k,
      w: rect.width / this.view.k,
      h: rect.height / this.view.k,
    };
    const hits = [];
    for (const n of this.graph.nodes) {
      const b = this._boxes.get(n.id) || this._boxOf(n);
      if (b.x < world.x + world.w && b.x + b.w > world.x && b.y < world.y + world.h && b.y + b.h > world.y) hits.push(n.id);
    }
    for (const g of this.graph.groups) {
      if (g.x < world.x + world.w && g.x + g.w > world.x && g.y < world.y + world.h && g.y + g.h > world.y) hits.push(g.id);
    }
    if (hits.length || !this.drag || !this.drag.additive) this.select(hits, { add: !!(this.drag && this.drag.additive) });
    this._announce(this.t('a11y.selected', { count: this.selection.size }));
  }

  /* -------------------------------------------------------------- 连线 */

  _portAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el && el.closest ? el.closest('.nv-port') : null;
  }

  _startConnect(portInfo) {
    if (this.pending) this._cancelConnect({ requestSearch: false });
    this.pending = {
      fixed: { ...portInfo },
      requireDir: portInfo.dir === 'out' ? 'in' : 'out',
      via: 'pointer',
      edgeId: null,
      last: null,
    };
    this._highlightCandidates();
    this.root.classList.add('is-connecting');
    this._announce(this.t('connect.start', {
      node: this._nodeTitle(portInfo.node),
      port: portInfo.port,
      dir: this.t(`port.dir.${this.pending.requireDir}`),
    }));
  }

  _startReconnect(edgeId, end) {
    const edge = this.graph.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const fixedRef = end === 'from' ? edge.to : edge.from;
    const movedRef = end === 'from' ? edge.from : edge.to;
    const fixedPort = this._portInfo(fixedRef.node, fixedRef.port);
    if (!fixedPort) return;
    this.pending = {
      fixed: fixedPort,
      requireDir: fixedPort.dir === 'out' ? 'in' : 'out',
      via: 'pointer',
      edgeId,
      movedRef,
      last: null,
    };
    this._highlightCandidates();
    this.root.classList.add('is-connecting');
  }

  _portInfo(nodeId, portId) {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const meta = this._metaFor(node);
    const port = meta.ports.find((p) => p.id === portId);
    if (!port) return null;
    return { node: nodeId, port: portId, dir: port.dir, type: port.type };
  }

  _nodeTitle(id) {
    const node = this.graph.nodes.find((n) => n.id === id);
    if (!node) return id;
    return this._metaFor(node).table.title || node.opId;
  }

  _highlightCandidates() {
    if (!this.pending) return;
    const { fixed, requireDir } = this.pending;
    for (const [nodeId, el] of this._nodeEls) {
      for (const btn of el.querySelectorAll('.nv-port')) {
        btn.classList.remove('is-candidate', 'is-hover-ok', 'is-hover-bad');
        if (btn.dataset.dir !== requireDir) continue;
        if (nodeId === fixed.node) continue;
        const compatible = btn.dataset.type === fixed.type || btn.dataset.type === 'any' || fixed.type === 'any';
        if (compatible) btn.classList.add('is-candidate');
      }
    }
  }

  _updateConnectPreview(e) {
    const pending = this.pending;
    if (!pending) return;
    const pt = this._localPoint(e);
    const world = this.screenToWorld(pt);
    pending.last = world;
    const fixedAnchor = this._anchor(pending.fixed.node, pending.fixed.port);
    if (fixedAnchor) {
      const d = pending.fixed.dir === 'out' ? edgePath(fixedAnchor, world, this.rtl) : edgePath(world, fixedAnchor, this.rtl);
      this.previewPath.setAttribute('d', d);
      this.previewPath.removeAttribute('hidden');
      this.previewPath.classList.toggle('is-invalid', !!this._lastInvalid);
    }
    const hover = this._portAt(e.clientX, e.clientY);
    this._clearHoverPorts();
    if (hover) {
      const target = { node: hover.dataset.node, port: hover.dataset.port, dir: hover.dataset.dir, type: hover.dataset.type };
      const result = this._validatePending(target);
      if (result.ok) {
        hover.classList.add('is-hover-ok');
        this._hideReason();
      } else {
        hover.classList.add('is-hover-bad');
        this._showReason(result, pt);
      }
    } else if (this._moved) {
      this._hideReason();
    }
    if (this.previewPath.isConnected === false) this.edgeSvg.appendChild(this.previewPath);
  }

  _clearHoverPorts() {
    for (const el of this.nodeLayer.querySelectorAll('.nv-port.is-hover-ok, .nv-port.is-hover-bad')) {
      el.classList.remove('is-hover-ok', 'is-hover-bad');
    }
  }

  _validatePending(target) {
    const pending = this.pending;
    if (!pending) return { ok: false, code: 'busy', vars: {} };
    let from;
    let to;
    if (pending.fixed.dir === 'out') {
      from = pending.fixed;
      to = target;
    } else {
      from = target;
      to = pending.fixed;
    }
    if (pending.edgeId) {
      const g = { ...this.graph, edges: this.graph.edges.filter((e) => e.id !== pending.edgeId) };
      return validateConnection({ graph: g, from, to, getPorts: (n) => this._tableFor(n) });
    }
    return validateConnection({ graph: this.graph, from, to, getPorts: (n) => this._tableFor(n) });
  }

  _showReason(result, pt) {
    const from = result.vars && result.vars.from ? result.vars.from : '';
    const to = result.vars && result.vars.to ? result.vars.to : '';
    const text = this.t(`connect.reason.${result.code}`, { from, to });
    this.reasonEl.textContent = text;
    this.reasonEl.hidden = false;
    this.reasonEl.dataset.code = result.code;
    const left = clamp((pt ? pt.x : 0) + 16, 8, Math.max(8, this.viewportEl.clientWidth - 260));
    const top = clamp((pt ? pt.y : 0) + 18, 8, Math.max(8, this.viewportEl.clientHeight - 48));
    this.reasonEl.style.transform = `translate(${left}px, ${top}px)`;
    this._lastInvalid = true;
  }

  _hideReason() {
    this.reasonEl.hidden = true;
    this._lastInvalid = false;
  }

  _completeConnect(target, via) {
    const pending = this.pending;
    if (!pending) return false;
    const result = this._validatePending(target);
    if (!result.ok) {
      this._announce(this.t(`connect.reason.${result.code}`, result.vars || {}));
      if (via === 'pointer') {
        const pt = this._downPoint || { x: 0, y: 0 };
        this._cancelConnect({ requestSearch: false });
        this._showReason(result, pt);
        clearTimeout(this._reasonTimer);
        this._reasonTimer = setTimeout(() => this._hideReason(), 1400);
      } else {
        this._showReason(result, this._downPoint || { x: 0, y: 0 });
      }
      return false;
    }
    const from = pending.fixed.dir === 'out' ? pending.fixed : target;
    const to = pending.fixed.dir === 'out' ? target : pending.fixed;
    const detail = {
      from: { node: from.node, port: from.port },
      to: { node: to.node, port: to.port },
      type: from.type,
      reconnectOf: pending.edgeId,
      via,
    };
    const accepted = this._emit('connect-request', detail, { cancelable: true });
    if (!accepted) {
      this._cancelConnect({ requestSearch: false });
      return false;
    }
    const before = this._snapshot();
    if (pending.edgeId) {
      const edge = this.graph.edges.find((e) => e.id === pending.edgeId);
      if (edge) {
        edge.from = { ...detail.from };
        edge.to = { ...detail.to };
        this._updateEdge(edge);
      }
    } else {
      const existing = new Set(this.graph.edges.map((e) => e.id));
      const edge = { id: createId('e', existing), from: { ...detail.from }, to: { ...detail.to } };
      this.graph.edges.push(edge);
      this.edgeGroup.appendChild(this._createEdgeEl(edge));
      this._updateEdge(edge);
    }
    this._commit(before, pending.edgeId ? 'reconnect' : 'connect');
    this._announce(this.t('connect.done'));
    this._cancelConnect({ requestSearch: false });
    return true;
  }

  _cancelConnect({ requestSearch = false, point = null } = {}) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.previewPath.setAttribute('hidden', '');
    this.previewPath.setAttribute('d', '');
    this._clearHoverPorts();
    for (const el of this.nodeLayer.querySelectorAll('.nv-port.is-candidate')) el.classList.remove('is-candidate');
    this._hideReason();
    this.root.classList.remove('is-connecting');
    if (requestSearch) {
      const at = point || { x: 0, y: 0 };
      this._emit('request-node-search', {
        from: { node: pending.fixed.node, port: pending.fixed.port, dir: pending.fixed.dir, type: pending.fixed.type },
        requireDir: pending.requireDir,
        at: { x: Math.round(at.x), y: Math.round(at.y) },
        mode: 'pointer',
      });
      this._announce(this.t('search.hint'));
    } else if (this._moved) {
      this._announce(this.t('connect.cancel'));
    }
  }

  /* ---------------------------------------------------------- 连线端点手柄 */

  _ensureEdgeHandles(edgeId) {
    const entry = this._edgeEls.get(edgeId);
    if (!entry || entry.handles) return;
    const edge = this.graph.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const mk = (end) => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('r', '6');
      c.setAttribute('class', 'nv-edge-endpoint');
      c.dataset.edge = edgeId;
      c.dataset.end = end;
      return c;
    };
    entry.fromHandle = mk('from');
    entry.toHandle = mk('to');
    entry.g.append(entry.fromHandle, entry.toHandle);
    entry.handles = true;
    this._positionHandles(edgeId);
  }

  _positionHandles(edgeId) {
    const entry = this._edgeEls.get(edgeId);
    const edge = this.graph.edges.find((e) => e.id === edgeId);
    if (!entry || !edge || !entry.handles) return;
    const a = this._anchor(edge.from.node, edge.from.port);
    const b = this._anchor(edge.to.node, edge.to.port);
    // 手柄沿连线内缩 12px：正好坐在端口圆点外侧，避免被端口按钮挡住
    const sign = this.rtl ? -1 : 1;
    if (a) { entry.fromHandle.setAttribute('cx', a.x + 12 * sign); entry.fromHandle.setAttribute('cy', a.y); }
    if (b) { entry.toHandle.setAttribute('cx', b.x - 12 * sign); entry.toHandle.setAttribute('cy', b.y); }
  }

  _removeEdgeHandles(edgeId) {
    const entry = this._edgeEls.get(edgeId);
    if (!entry || !entry.handles) return;
    entry.fromHandle.remove();
    entry.toHandle.remove();
    entry.handles = false;
  }

  /* ---------------------------------------------------------- 对齐参考线 */

  _showGuides(guides) {
    const gx = guides.find((g) => g.axis === 'x');
    const gy = guides.find((g) => g.axis === 'y');
    if (gx) {
      this.guideX.hidden = false;
      this.guideX.style.transform = `translateX(${gx.pos * this.view.k + this.view.x}px)`;
    } else {
      this.guideX.hidden = true;
    }
    if (gy) {
      this.guideY.hidden = false;
      this.guideY.style.transform = `translateY(${gy.pos * this.view.k + this.view.y}px)`;
    } else {
      this.guideY.hidden = true;
    }
  }

  _hideGuides() {
    this.guideX.hidden = true;
    this.guideY.hidden = true;
  }

  /* -------------------------------------------------------------- 缩放 */

  _wheel(e) {
    e.preventDefault();
    const pt = this._localPoint(e);
    const unit = e.deltaMode === 1 ? 0.05 : (e.deltaMode === 2 ? 1 : 0.0015);
    const factor = Math.exp(-e.deltaY * unit);
    this.zoomAt(factor, pt);
  }

  _beginPinch() {
    const pts = [...this.pointers.values()];
    const a = pts[0];
    const b = pts[1];
    this.mode = 'pinch';
    this.drag = null;
    this.marqueeEl.hidden = true;
    this.root.classList.remove('is-dragging');
    this._hideGuides();
    this.pinch = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: { ...this.view },
    };
    this.root.classList.add('is-panning');
    if (this.pending) this._cancelConnect({ requestSearch: false });
  }

  _updatePinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2 || !this.pinch) return;
    const a = pts[0];
    const b = pts[1];
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = this.viewportEl.getBoundingClientRect();
    const localCenter = { x: center.x - rect.left, y: center.y - rect.top };
    const localStart = { x: this.pinch.center.x - rect.left, y: this.pinch.center.y - rect.top };
    const k = clamp(this.pinch.view.k * (dist / this.pinch.dist), GEO.minZoom, GEO.maxZoom);
    const wx = (localStart.x - this.pinch.view.x) / this.pinch.view.k;
    const wy = (localStart.y - this.pinch.view.y) / this.pinch.view.k;
    this.view = { x: localCenter.x - wx * k, y: localCenter.y - wy * k, k };
    this._applyView();
  }

  /* -------------------------------------------------------------- 小地图交互 */

  _minimapDown(e) {
    e.preventDefault();
    this._mmDragging = true;
    try {
      this.minimapEl.setPointerCapture(e.pointerId);
    } catch (err) {
      // 合成事件下没有可捕获的指针
    }
    this._minimapJump(e);
  }

  _minimapMove(e) {
    if (!this._mmDragging) return;
    this._minimapJump(e);
  }

  _minimapUp(e) {
    this._mmDragging = false;
    if (this.minimapEl.hasPointerCapture(e.pointerId)) this.minimapEl.releasePointerCapture(e.pointerId);
  }

  _minimapJump(e) {
    const world = this._mmWorld;
    if (!world) return;
    const r = this.mmSvg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // viewBox 为 meet 缩放：按较紧的边等比映射
    const scale = Math.min(r.width / world.w, r.height / world.h);
    const renderedW = world.w * scale;
    const renderedH = world.h * scale;
    const offX = (r.width - renderedW) / 2;
    const offY = (r.height - renderedH) / 2;
    const wx = world.x + (e.clientX - r.left - offX) / scale;
    const wy = world.y + (e.clientY - r.top - offY) / scale;
    this.centerOn({ x: wx, y: wy });
  }

  /* -------------------------------------------------------------- 键盘 */

  _keyDown(e) {
    if (e.target.matches && e.target.matches('input, textarea, [contenteditable="true"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const portEl = e.target.closest ? e.target.closest('.nv-port') : null;

    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') && portEl) {
      e.preventDefault();
      this._portKeyActivate(portEl);
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.root.classList.add('is-space');
      }
      e.preventDefault();
      return;
    }

    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      this.copySelection();
      return;
    }
    if (mod && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      if (this.copySelection()) this.deleteSelection();
      return;
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      this.paste();
      return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.pending) this._cancelConnect({ requestSearch: false });
      else if (this.mode !== 'idle') {
        this.mode = 'idle';
        this.marqueeEl.hidden = true;
        this.root.classList.remove('is-connecting');
      } else this.clearSelection();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.altKey ? 1 : (e.shiftKey ? 32 : 8);
      const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
      const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
      this._nudgeSelection(dx, dy);
      return;
    }
    if (!mod && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      const center = this.screenToWorld({ x: this.viewportEl.clientWidth / 2, y: this.viewportEl.clientHeight / 2 });
      this._emit('request-node-search', {
        from: null,
        requireDir: null,
        at: { x: Math.round(center.x), y: Math.round(center.y) },
        mode: 'keyboard',
      });
      this._announce(this.t('a11y.search'));
      return;
    }
    if (!mod && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      this.fitView();
      return;
    }
    if (!mod && (e.key === '0')) {
      e.preventDefault();
      this.resetZoom();
      return;
    }
    if (!mod && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      this.zoomBy(1.2);
      return;
    }
    if (!mod && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      this.zoomBy(1 / 1.2);
    }
  }

  _keyUp(e) {
    if (e.key === ' ' || e.code === 'Space') {
      this.spaceDown = false;
      this.root.classList.remove('is-space');
    }
  }

  _portKeyActivate(portEl) {
    const info = {
      node: portEl.dataset.node,
      port: portEl.dataset.port,
      dir: portEl.dataset.dir,
      type: portEl.dataset.type,
    };
    if (!this.pending) {
      this.pending = { fixed: info, requireDir: info.dir === 'out' ? 'in' : 'out', via: 'keyboard', edgeId: null, last: null };
      this._highlightCandidates();
      this.root.classList.add('is-connecting');
      this._announce(this.t('connect.start', {
        node: this._nodeTitle(info.node),
        port: info.port,
        dir: this.t(`port.dir.${this.pending.requireDir}`),
      }));
      return;
    }
    const pending = this.pending;
    if (pending.fixed.node === info.node && pending.fixed.port === info.port) {
      this._cancelConnect({ requestSearch: false });
      return;
    }
    if (info.dir !== pending.requireDir) {
      this._announce(this.t('connect.reason.direction'));
      return;
    }
    this._completeConnect(info, 'keyboard');
  }

  _nudgeSelection(dx, dy) {
    if (!this.selection.size) {
      this._announce(this.t('a11y.noSelection'));
      return;
    }
    const nodes = this.graph.nodes.filter((n) => this.selection.has(n.id));
    if (!nodes.length) return;
    const before = this._snapshot();
    for (const n of nodes) {
      n.x += dx;
      n.y += dy;
      const el = this._nodeEls.get(n.id);
      if (el) el.style.transform = `translate(${n.x}px, ${n.y}px)`;
      this._boxes.set(n.id, this._boxOf(n));
    }
    this._updateEdgesFor(new Set(nodes.map((n) => n.id)));
    this._moveMinimapRects(nodes.map((n) => n.id));
    this._commit(before, 'nudge');
    const first = nodes[0];
    this._announce(this.t('a11y.moved', { x: first.x, y: first.y }));
  }

  /* -------------------------------------------------------------- 统计 */

  getStats() {
    return {
      listeners: this._listenerCount,
      domNodes: this.root.querySelectorAll('*').length,
      nodes: this.graph.nodes.length,
      edges: this.graph.edges.length,
      groups: this.graph.groups.length,
      selection: this.selection.size,
      historyUndo: this.history.undoSize,
      historyRedo: this.history.redoSize,
      viewport: { ...this.view },
    };
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._mmRaf);
    clearTimeout(this._reasonTimer);
    if (this._ro) this._ro.disconnect();
    for (const { target, type, fn, opts } of this._listeners) target.removeEventListener(type, fn, opts);
    this._listeners.length = 0;
    this._listenerCount = 0;
    this.host.removeChild(this.root);
    this._nodeEls.clear();
    this._edgeEls.clear();
    this._groupEls.clear();
    this._meta.clear();
    this._boxes.clear();
    this._portsCache.clear();
  }
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

export function createCanvas(host, options = {}) {
  return new NodeCanvas(host, options);
}

export { STRINGS, GEO };

export default createCanvas;
