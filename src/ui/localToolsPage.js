import { LOCAL_TOOL_CATALOG, LOCAL_TOOLS_SCHEMA, LOCAL_TOOL_MIRRORS } from '../core/localToolCatalog.js';
import { bridgeHealth } from '../core/localBridge.js';
import { icon as iconSvg } from './icons.js';

export const LOCAL_TOOLS_TEXT = {
  title: ['本机环境工具管理', 'Local environment tools'],
  subtitle: ['检测只读取本机元数据，不导入第三方模块、不联网；安装与卸载使用固定的分发包目录，执行前需再次确认。', 'Detection only reads local metadata without importing third-party modules or using the network. Install and uninstall use the fixed package catalog and require a second confirmation.'],
  privacy: ['检测仅读取本机元数据，不导入第三方模块、不联网。', 'Detection reads local metadata without importing third-party modules or using the network.'],
  static: ['本地工具 API 不可用。静态部署仅提供目录、详情和官网链接；连接本地服务后显示实际检测结果。', 'Local tools API unavailable. Static deployments provide catalog, details and official links; a local service provides actual metadata.'],
  checking: ['正在读取本机元数据…', 'Reading local metadata…'],
  connected: ['本地元数据检测已完成', 'Local metadata detection completed'],
  refresh: ['重新检测', 'Detect again'],
  python: ['Python 解释器', 'Python interpreter'], node: ['Node 运行时', 'Node runtime'], scope: ['npm 检测范围', 'npm detection scope'],
  managed: ['应用专用目录', 'App-managed directory'], readonly: ['只读检测', 'Read-only inspection'], default: ['默认', 'Default'], none: ['未发现', 'Not found'],
  search: ['搜索名称、分发包、模块或用途', 'Search names, distributions, modules or purpose'], searchLabel: ['搜索', 'Search'], all: ['全部分类', 'All categories'], runtime: ['运行环境', 'Runtimes'], crypto: ['密码学', 'Cryptography'], general: ['泛密码学 / 二进制', 'General / binary'], math: ['数学', 'Mathematics'], command: ['命令行工具', 'Command-line tools'],
  common: ['常用', 'Common'], intermediate: ['中度常用', 'Intermediate'], anyLevel: ['全部频度', 'All levels'], installed: ['已安装', 'Installed'], missing: ['未发现', 'Not found'], unavailable: ['环境不可用', 'Environment unavailable'], error: ['检测失败', 'Detection failed'], unknown: ['未检测', 'Not detected'], package: ['分发包', 'Distribution'], modules: ['模块', 'Modules'], website: ['官网 / 源码', 'Website / source'], count: ['项目', 'items'], noMatches: ['没有匹配项目', 'No matching items'],
  install: ['一键安装', 'Install'], uninstall: ['卸载', 'Uninstall'], installing: ['正在安装…', 'Installing…'], uninstalling: ['正在卸载…', 'Uninstalling…'], installedNow: ['安装完成，正在刷新检测', 'Installed; refreshing detection'], uninstalledNow: ['卸载完成，正在刷新检测', 'Uninstalled; refreshing detection'], installFailed: ['操作失败', 'Operation failed'],
  installCommand: ['一键安装指令', 'Install command'], uninstallCommand: ['卸载指令', 'Uninstall command'], copy: ['复制指令', 'Copy command'], copied: ['指令已复制', 'Command copied'], copyFailed: ['复制失败，请手动选择命令', 'Copy failed; select the command manually'],
  notInstallable: ['该工具由系统包管理器或官网安装，本页不代为执行。', 'Install this tool with your system package manager or its official installer.'],
  installHint: ['安装说明', 'Install notes'],
  confirmUninstall: ['确认卸载', 'Confirm uninstall'],
  confirmUninstallBody: ['将从本机环境移除 {0}（{1}）。此操作会修改系统已安装的包，确定继续？', 'This removes {0} ({1}) from the local environment and changes installed packages. Continue?'],
  cancel: ['取消', 'Cancel'], confirm: ['确认卸载', 'Uninstall'],
  metadataNote: ['元数据版本不代表模块可导入或 ABI 兼容。npm 逐个读取所选目录的 package.json，不运行 npm list / require。SageMath 仅检测本机 sage 命令，不把同名 pip 包算作已装。', 'Metadata versions do not prove importability or ABI compatibility. npm detection reads package.json without npm list / require. SageMath requires a local sage command.'],
  searchEmpty: ['输入关键词过滤', 'Type to filter'],
  version: ['版本', 'Version'], mirror: ['镜像', 'Mirror'], defaultMirror: ['官方源', 'Official'], tunaMirror: ['清华镜像', 'TUNA mirror'], aliyunMirror: ['阿里云镜像', 'Aliyun mirror'], ustcMirror: ['中科大镜像', 'USTC mirror'], tencentMirror: ['腾讯云镜像', 'Tencent Cloud mirror'], path: ['路径', 'Path'], copyPath: ['复制路径', 'Copy path'],
};

function text(key) {
  try { const value = globalThis.window?.__ebctfT?.(`ui.localTools.${key}`); if (value && value !== `ui.localTools.${key}`) return value; } catch {}
  const lang = globalThis.document?.documentElement.lang || globalThis.navigator?.language || 'zh';
  return LOCAL_TOOLS_TEXT[key]?.[/^zh/i.test(lang) ? 0 : 1] || key;
}
function localLabel(key) {
  const lang = globalThis.document?.documentElement.lang || globalThis.navigator?.language || 'zh';
  return LOCAL_TOOLS_TEXT[key]?.[/^zh/i.test(lang) ? 0 : 1] || text(key);
}
function fmt(key, ...args) {
  return localLabel(key).replace(/\{(\d+)\}/g, (m, i) => args[i] != null ? args[i] : m);
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter(value => value != null));
  return node;
}
function icon(name, cls = 'lt-icon') {
  const node = el('span', { class: cls, 'aria-hidden': 'true' });
  node.innerHTML = iconSvg(name);
  return node;
}
const CATEGORY_ICON = { runtime: 'computer', crypto: 'key', math: 'calculate', general: 'extension' };
function toolIcon(item) {
  const brand = { python:'python.svg', node:'node.svg', npm:'npm.svg', git:'git.svg', java:'openjdk.svg', '7z':'7zip.svg', sage:'sagemath.svg' }[item.id];
  if (brand) return el('img', { class: `lt-icon lt-brand-icon lt-brand-icon--${item.id}`, src: `public/icons/tools/${brand}`, alt: '', 'aria-hidden': 'true' });
  const name = item.kind === 'command' ? 'terminal' : CATEGORY_ICON[item.category] || 'extension';
  return icon(name, `lt-icon lt-icon--${item.category}`);
}
const button = (label, action, attrs = {}) => el('button', { type: 'button', onclick: action, ...attrs }, label);
const link = (label, url) => el('a', { class: 'lt-link', href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, label);

async function defaultRequest(action, payload, { signal } = {}) {
  const response = await fetch(`http://127.0.0.1:8181/api/local-tools/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal, cache: 'no-store', credentials: 'omit' });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value?.ok || value.schema !== LOCAL_TOOLS_SCHEMA) throw new Error(value?.error || `HTTP ${response.status}`);
  return value;
}

/** Page-internal M3 confirmation sheet. Never uses window.confirm (project ruling). */
function confirmSheet({ title, message, confirmLabel, cancelLabel, danger = true }) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const overlay = el('div', { class: 'lt-confirm' });
    const cancel = button(cancelLabel, () => close(false), { class: 'lt-confirm-cancel' });
    const accept = button(confirmLabel, () => close(true), { class: `lt-confirm-accept${danger ? ' danger' : ''}` });
    const dialog = el('div', { class: 'lt-confirm-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lt-confirm-title' },
      el('h2', { id: 'lt-confirm-title' }, title), el('p', {}, message), el('div', { class: 'lt-confirm-actions' }, cancel, accept));
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(false); }
      if (event.key === 'Tab') {
        event.preventDefault(); (document.activeElement === cancel ? accept : cancel).focus({ preventScroll: true });
      }
    };
    const close = value => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove(); resolve(value);
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
    overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
    document.addEventListener('keydown', onKey, true);
    overlay.append(dialog); document.body.append(overlay);
    cancel.focus({ preventScroll: true });
  });
}

export function renderLocalToolsPage(host, options = {}) {
  if (!host) throw new TypeError('Local tools host is required');
  host.querySelector('.local-tools-page')?.dispose?.();
  const root = el('section', { class: 'local-tools-page', 'aria-label': text('title') }); host.replaceChildren(root);
  const request = options.request || defaultRequest;
  let data = null, dead = false, sequence = 0, mirror = 'default', busy = '';
  const controllers = new Set();
  const status = el('p', { class: 'lt-status', role: 'status', 'aria-live': 'polite' }, text('checking'));
  const controls = el('div', { class: 'lt-controls' });
  const grid = el('div', { class: 'lt-grid' });
  const resultCount = el('p', { class: 'lt-count', role: 'status' });
  const field = (label, id, values, extra = '') => {
    const select = el('select', { id, class: 'lt-select', 'aria-label': label }, ...values.map(([value, caption]) => el('option', { value }, caption)));
    controls.append(el('div', { class: `lt-field ${extra}`.trim() }, el('span', { class: 'lt-field-label', id: `${id}-label` }, label), select));
    select.setAttribute('aria-labelledby', `${id}-label`);
    return select;
  };
  const python = field(text('python'), 'lt-python', [['', text('none')]]);
  const node = field(text('node'), 'lt-node', [['', text('none')]]);
  const scope = field(text('scope'), 'lt-scope', [['managed', text('managed')]]);
  const mirrorField = field(localLabel('mirror'), 'lt-mirror', [['default', localLabel('defaultMirror')], ['tuna', localLabel('tunaMirror')], ['aliyun', localLabel('aliyunMirror')], ['ustc', localLabel('ustcMirror')], ['tencent', localLabel('tencentMirror')]]);
  mirrorField.value = mirror;
  mirrorField.addEventListener('change', () => { mirror = mirrorField.value || 'default'; });
  const search = el('input', { type: 'search', placeholder: text('search'), 'aria-label': text('search') });
  search.id = 'lt-search';
  const searchField = el('label', { class: 'lt-field lt-field--search', for: 'lt-search' }, el('span', { class: 'lt-field-label' }, localLabel('searchLabel')), search);
  controls.append(searchField);
  const category = field(localLabel('all'), 'lt-category', ['all', 'runtime', 'crypto', 'math', 'general'].map(value => [value, localLabel(value)]));
  const level = field(localLabel('anyLevel'), 'lt-level', ['anyLevel', 'common', 'intermediate'].map(value => [value, localLabel(value)]));
  const refresh = button(text('refresh'), () => detect(true), { class: 'lt-primary lt-refresh' });
  root.append(
    el('header', { class: 'lt-hero' },
      el('div', { class: 'lt-hero-copy' }, el('h1', {}, text('title')), el('p', { class: 'lt-sub' }, text('subtitle'))),
      refresh),
    el('div', { class: 'lt-status-row' }, status, resultCount),
    controls,
    grid,
    el('p', { class: 'lt-note' }, text('metadataNote')),
  );

  async function call(action, payload) {
    const controller = new AbortController(); controllers.add(controller);
    try { return await request(action, payload, { signal: controller.signal }); } finally { controllers.delete(controller); }
  }
  function setOptions(select, values, selected) {
    select.replaceChildren(...values.map(([value, caption]) => el('option', { value }, caption)));
    if (!values.length) select.append(el('option', { value: '' }, text('none')));
    select.value = selected || ''; select.disabled = !values.length;
  }
  async function detect(force = false) {
    const token = ++sequence; refresh.disabled = true; status.textContent = text('checking'); status.dataset.state = 'busy';
    try {
      if (!options.request && !data) { const health = await bridgeHealth(); if (!health.ok) throw new Error(text('static')); }
      const result = await call('detect', { refresh: force, ...(python.value ? { pythonId: python.value } : {}), ...(node.value ? { nodeId: node.value } : {}), ...(scope.value ? { npmScope: scope.value } : {}) });
      if (dead || token !== sequence) return; data = result; status.textContent = text('connected'); status.dataset.state = 'ok';
    } catch (error) {
      if (!dead && token === sequence) { data = null; status.dataset.state = 'error'; status.textContent = `${text('static')} ${error.message === text('static') ? '' : error.message}`.trim(); }
    } finally {
      if (!dead && token === sequence) {
        refresh.disabled = false;
        setOptions(python, data?.interpreters?.map(value => [value.id, `${value.default ? text('default') + ' · ' : ''}${value.version} · ${value.path}`]) || [], data?.selected?.pythonId);
        setOptions(node, data?.nodes?.map(value => [value.id, value.path]) || [], data?.selected?.nodeId);
        setOptions(scope, data?.npmScopes?.map(value => [value.id, `${value.id === 'managed' ? text('managed') : text('readonly')} · ${value.path}`]) || [['managed', text('managed')]], data?.selected?.npmScope || 'managed');
        renderCards();
      }
    }
  }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); status.textContent = text('copied'); status.dataset.state = 'ok'; }
    catch { status.textContent = text('copyFailed'); status.dataset.state = 'error'; }
  }
  function targetArgs(item) {
    return item.kind === 'pip'
      ? { pythonId: data?.selected?.pythonId }
      : { nodeId: data?.selected?.nodeId, npmScope: data?.selected?.npmScope || 'managed' };
  }
  function installReady(item) {
    if (!data) return false;
    return item.kind === 'pip'
      ? !!data.selected?.pythonId && data.pipAvailable !== false && data.install?.pip !== false
      : !!data.selected?.nodeId && data.install?.npm !== false;
  }
  function uninstallReady(item) {
    if (!data || data.tools?.[item.id]?.status !== 'installed') return false;
    return item.kind === 'pip' ? data.install?.uninstallPip !== false && !!data.selected?.pythonId : data.install?.uninstallNpm !== false && !!data.selected?.nodeId;
  }
  async function runJob(item, action, trigger) {
    if (busy) return;
    busy = item.id; trigger.disabled = true;
    const original = trigger.textContent;
    trigger.textContent = action === 'uninstall' ? localLabel('uninstalling') : localLabel('installing');
    try {
      const job = await call(action, { id: item.id, mirror, ...targetArgs(item) });
      status.textContent = `${action === 'uninstall' ? text('uninstalling') : text('installing')} ${job.plan?.argv?.slice(-1)[0] || item.package}`;
      status.dataset.state = 'busy';
      let state = job.job;
      while (state && ['running', 'cancelling'].includes(state.state)) {
        await new Promise(resolve => setTimeout(resolve, 350));
        state = (await call('job', { jobId: state.jobId })).job;
        if (dead) return;
      }
      if (state?.state === 'succeeded') {
        status.textContent = action === 'uninstall' ? text('uninstalledNow') : text('installedNow');
        status.dataset.state = 'ok';
        await detect(true);
      } else throw new Error(state?.reason || text('installFailed'));
    } catch (error) {
      status.textContent = `${text('installFailed')}: ${error.message}`; status.dataset.state = 'error';
    } finally {
      busy = ''; trigger.disabled = false; trigger.textContent = original;
    }
  }
  async function uninstall(item, trigger) {
    const ok = await confirmSheet({
      title: text('confirmUninstall'),
      message: fmt('confirmUninstallBody', item.name, item.package),
      confirmLabel: text('confirm'), cancelLabel: text('cancel'),
    });
    if (!ok || dead) return;
    await runJob(item, 'uninstall', trigger);
  }
  const quote = value => /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  function commandText(item) {
    const mirrorInfo = LOCAL_TOOL_MIRRORS[mirror] || LOCAL_TOOL_MIRRORS.default;
    if (item.kind === 'pip') {
      const pythonPath = data?.interpreters?.find(value => value.id === data?.selected?.pythonId)?.path || 'python';
      return `${quote(pythonPath)} -I -m pip --isolated install --no-input --prefer-binary --index-url ${mirrorInfo.pip} -- ${item.package}`;
    }
    if (item.kind === 'npm') {
      const selected = data?.nodes?.find(value => value.id === data?.selected?.nodeId);
      const nodePath = selected?.path || 'node';
      const npmCli = selected?.npmCli || '<npm-cli.js>';
      const prefix = (data?.npmScopes?.find(value => value.id === 'managed')?.path || '').replace(/[\\/]node_modules[\\/]?$/, '') || '<npm-prefix>';
      return `${quote(nodePath)} ${quote(npmCli)} install --prefix ${quote(prefix)} --ignore-scripts --no-audit --no-fund --package-lock=false --save=false --registry=${mirrorInfo.npm} -- ${item.package}`;
    }
    return '';
  }
  function renderCards() {
    const query = search.value.trim().toLocaleLowerCase();
    const order = ['runtime', 'crypto', 'math', 'general']; const levels = { common: 0, intermediate: 1 };
    const list = LOCAL_TOOL_CATALOG.filter(item => (category.value === 'all' || category.value === item.category) && (level.value === 'anyLevel' || level.value === item.level) && [item.name, item.package, ...item.modules, item.purpose, item.purposeEn].join(' ').toLocaleLowerCase().includes(query))
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || (levels[a.level] ?? 9) - (levels[b.level] ?? 9) || a.name.localeCompare(b.name));
    resultCount.textContent = `${list.length} / ${LOCAL_TOOL_CATALOG.length} ${localLabel('count')}`;
    grid.replaceChildren();
    if (!list.length) { grid.append(el('p', { class: 'lt-empty' }, text('noMatches'))); return; }
    let current = null;
    for (const item of list) {
      if (!current || current.id !== item.category) {
        const body = el('div', { class: 'lt-group-body' });
        const count = el('span', { class: 'lt-group-count' });
        const details = el('details', { class: 'lt-group', open: true },
          el('summary', { class: 'lt-group-title' }, icon(CATEGORY_ICON[item.category] || 'extension'), el('span', { class: 'lt-group-name' }, localLabel(item.category)), count, icon('expand_more', 'lt-icon lt-chevron')), body);
        grid.append(details); current = { id: item.category, body, count, total: 0 };
      }
      current.total++;
      const info = data?.tools?.[item.id]; const state = info?.status || 'unknown'; const cmd = commandText(item);
      const installable = item.kind === 'pip' || item.kind === 'npm';
      const installBtn = installable ? button(localLabel('install'), () => runJob(item, 'install', installBtn), { class: 'lt-action lt-action--primary', disabled: !installReady(item), hidden: state === 'installed', title: installReady(item) ? '' : text('static') }) : null;
      const uninstallBtn = installable ? button(localLabel('uninstall'), () => uninstall(item, uninstallBtn), { class: 'lt-action lt-action--danger', disabled: !uninstallReady(item), hidden: state !== 'installed' }) : null;
      const copyBtn = installable ? button(localLabel('copy'), () => copyText(cmd || ''), { class: 'lt-copy' }) : null;
      const commandBlock = el('div', { class: 'lt-command-block' },
        el('div', { class: 'lt-command-head' }, el('span', {}, installable ? localLabel('installCommand') : text('installHint')), copyBtn),
        installable ? el('pre', { class: 'lt-command', dir: 'ltr' }, cmd) : el('p', { class: 'lt-command-note' }, text('notInstallable')));
      const badge = el('span', { class: `lt-badge lt-badge--${state}`, title: info?.error || '' }, localLabel(state));
      const card = el('article', { class: 'lt-card', 'data-tool-id': item.id, 'data-state': state },
        el('div', { class: 'lt-card-head' },
          toolIcon(item),
          el('div', { class: 'lt-card-title' },
            el('h2', { title: item.name }, item.name),
            el('div', { class: 'lt-card-sub' },
              el('span', { class: 'lt-card-kind' }, localLabel(item.category)),
              badge))),
        el('p', { class: 'lt-card-purpose' }, item.purpose),
        el('div', { class: 'lt-card-meta' },
          el('span', { class: 'lt-meta-key' }, localLabel('package')),
          el('code', { class: 'lt-meta-value', dir: 'ltr' }, item.package)),
        info?.version ? el('div', { class: 'lt-card-meta' }, el('span', { class: 'lt-meta-key' }, localLabel('version')), el('code', { class: 'lt-meta-value', dir: 'ltr' }, info.version)) : null,
        item.modules.length ? el('div', { class: 'lt-card-meta' }, el('span', { class: 'lt-meta-key' }, localLabel('modules')), el('code', { class: 'lt-meta-value', dir: 'ltr' }, item.modules.join(', '))) : null,
         info?.path ? el('div', { class: 'lt-card-meta lt-card-meta--copyable', title: text('copyPath') }, el('span', { class: 'lt-meta-key' }, localLabel('path')), el('button', { class: 'lt-meta-value lt-meta-path', type: 'button', onclick: () => copyText(info.path), 'aria-label': `${localLabel('path')}: ${info.path}` }, info.path)) : null,
        info?.error ? el('p', { class: 'lt-error' }, info.error) : null,
        el('div', { class: 'lt-card-actions' },
          link(localLabel('website'), item.url),
          installBtn, uninstallBtn),
        installable ? el('details', { class: 'lt-command-details' }, el('summary', {}, icon('terminal'), el('span', {}, localLabel('installCommand'))), commandBlock) : null);
      current.body.append(card); current.count.textContent = `${current.total} ${localLabel('count')}`;
    }
  }
  for (const fieldNode of [search, category, level]) fieldNode.addEventListener(fieldNode === search ? 'input' : 'change', renderCards);
  for (const fieldNode of [python, node, scope]) fieldNode.addEventListener('change', () => detect(true));
  const observer = new MutationObserver(() => { if (!root.isConnected) root.dispose(); }); observer.observe(host, { childList: true });
  root.dispose = () => { dead = true; sequence++; controllers.forEach(value => value.abort()); observer.disconnect(); };
  root.refresh = () => detect(true); renderCards(); root.ready = options.autoDetect === false ? Promise.resolve() : detect(); return root;
}
