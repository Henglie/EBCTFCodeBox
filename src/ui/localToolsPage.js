import { LOCAL_TOOL_CATALOG, LOCAL_TOOL_MIRRORS, LOCAL_TOOLS_SCHEMA } from '../core/localToolCatalog.js';
import { bridgeHealth } from '../core/localBridge.js';

// Shared-entry translations may override these keys through the existing global translator.
export const LOCAL_TOOLS_TEXT = {
  title: ['本机环境工具管理', 'Local environment tools'],
  privacy: ['检测仅读取本机元数据，不导入第三方模块、不联网。外链和安装仅在点击后访问网络。', 'Detection reads local metadata without importing third-party modules or using the network. Links and installation use the network only after a click.'],
  static: ['本地工具 API 不可用。静态部署仅提供目录、链接及可复制命令；原生桥需接入此能力，或单独运行 bridge.py。', 'Local tools API unavailable. Static deployments provide the catalog, links and copyable commands. The native bridge needs this capability, or run bridge.py separately.'],
  checking: ['正在读取本机元数据…', 'Reading local metadata…'],
  connected: ['本地元数据检测已完成', 'Local metadata detection completed'],
  refresh: ['重新检测', 'Detect again'],
  python: ['Python 解释器（pip 安装目标）', 'Python interpreter (pip install target)'],
  node: ['Node 运行时', 'Node runtime'],
  scope: ['npm 检测范围', 'npm detection scope'],
  managed: ['应用专用目录（可安装）', 'App-managed directory (installable)'],
  readonly: ['只读检测', 'Read-only inspection'],
  default: ['默认', 'Default'],
  none: ['未发现；复制命令前先安装运行时', 'Not found; install the runtime before using commands'],
  mirror: ['安装源', 'Installation registry'],
  official: ['默认官方源', 'Official registries'],
  china: ['清华 TUNA / npmmirror', 'TUNA / npmmirror'],
  source: ['镜像说明', 'Mirror documentation'],
  npmSource: ['npm 镜像说明', 'npm mirror documentation'],
  shell: ['复制命令的终端', 'Shell for copied commands'],
  search: ['搜索名称、分发包、模块或用途', 'Search names, distributions, modules or purpose'],
  all: ['全部分类', 'All categories'],
  runtime: ['运行环境', 'Runtimes'],
  crypto: ['密码学', 'Cryptography'],
  general: ['泛密码学 / 二进制', 'General / binary'],
  math: ['数学', 'Mathematics'],
  common: ['常用', 'Common'],
  intermediate: ['中度常用', 'Intermediate'],
  anyLevel: ['全部频度', 'All levels'],
  installed: ['已安装（元数据）', 'Installed (metadata)'],
  missing: ['未安装 / 未在此范围发现', 'Missing / not found in this scope'],
  unavailable: ['环境不可用', 'Environment unavailable'],
  error: ['检测失败', 'Detection failed'],
  unknown: ['未检测', 'Not detected'],
  package: ['分发包', 'Distribution'],
  modules: ['模块', 'Modules'],
  website: ['官网 / 源码', 'Website / source'],
  copy: ['复制命令', 'Copy command'],
  copied: ['已复制', 'Copied'],
  copyFailed: ['复制失败；请选中命令复制', 'Copy failed; select the command to copy it'],
  install: ['安装（联网）', 'Install (network)'],
  installNote: ['pip 只接受 wheel，不编译源码；npm 禁用生命周期脚本，仅装入应用专用目录。不会自动安装系统环境。安装成功仅表示包管理器成功退出，功能兼容性需另验。', 'pip accepts wheels only, without source builds; npm disables lifecycle scripts and only installs into the app-managed directory. System runtimes are never installed automatically. A successful package-manager exit does not verify functional compatibility.'],
  metadataNote: ['元数据版本不代表模块可导入或 ABI 兼容。npm 逐个读取所选目录的 package.json，不运行 npm list / require。SageMath 仅检测本机 sage 命令，不把同名 pip 包算作已装。', 'Metadata versions do not prove importability or ABI compatibility. npm detection reads package.json in the selected directory without npm list / require. SageMath requires a local sage command; a similarly named pip package does not count.'],
  staticTarget: ['静态命令：Python 使用默认 python；npm 使用当前目录下 ebcrypto-local-tools。连接本地服务后显示实际目标。', 'Static commands use default python and ./ebcrypto-local-tools for npm. A local service displays the actual targets.'],
  count: ['项目', 'items'],
  noMatches: ['没有匹配项目', 'No matching items'],
  job: ['安装作业 / 日志', 'Installation job / log'],
  cancel: ['取消安装', 'Cancel installation'],
  logs: ['刷新日志', 'Refresh log'],
  running: ['安装中', 'Installing'],
  cancelling: ['正在取消', 'Cancelling'],
  cancelled: ['已取消（已写入的包不回滚）', 'Cancelled (written packages are not rolled back)'],
  succeeded: ['包管理器成功退出', 'Package manager exited successfully'],
  failed: ['安装失败', 'Installation failed'],
  target: ['目标', 'Target'],
  noLog: ['等待包管理器输出…', 'Waiting for package-manager output…'],
  busy: ['已有安装作业；等待完成或取消', 'An installation is active; wait or cancel'],
  jobContinues: ['离开页面仅停止日志轮询；作业继续，返回本页可查看。超时 180 秒，输出上限 128 KiB。', 'Leaving stops log polling; the job continues and can be viewed on return. Timeout: 180 seconds; output limit: 128 KiB.'],
};

function text(key) {
  try {
    const value = globalThis.window?.__ebctfT?.(`ui.localTools.${key}`);
    if (value && value !== `ui.localTools.${key}`) return value;
  } catch { /* Local fallbacks remain usable without the main UI. */ }
  const lang = globalThis.document?.documentElement.lang || globalThis.navigator?.language || 'zh';
  return LOCAL_TOOLS_TEXT[key]?.[/^zh/i.test(lang) ? 0 : 1] || key;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter(value => value != null));
  return node;
}
const button = (label, action, attrs = {}) => el('button', { type: 'button', onclick: action, ...attrs }, label);
const link = (label, url) => el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, label);

/** Optional request(action, payload, {signal}) lets the host reuse its authenticated native bridge client. */
async function defaultRequest(action, payload, { signal } = {}) {
  const response = await fetch(`http://127.0.0.1:8181/api/local-tools/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal, cache: 'no-store', credentials: 'omit',
  });
  let value;
  try { value = await response.json(); } catch { throw new Error(`HTTP ${response.status}`); }
  if (!response.ok || !value?.ok) throw new Error(value?.error || `HTTP ${response.status}`);
  if (value.schema !== LOCAL_TOOLS_SCHEMA) throw new Error('Unsupported local tools schema');
  return value;
}

function quote(arg, shell) {
  return shell === 'pwsh' ? `'${String(arg).replaceAll("'", "''")}'` : `'${String(arg).replaceAll("'", "'\"'\"'")}'`;
}
function commandFor(item, data, mirrorId, shell) {
  if (item.kind === 'runtime') {
    const node = data?.nodes.find(value => value.id === data.selected.nodeId);
    const path = data?.tools[item.id]?.path;
    let argv = null;
    if (item.id === 'npm' && node?.npmCli) argv = [node.path, node.npmCli, '--version'];
    else if (item.id !== 'npm' && path) argv = [path, item.id === 'java' ? '-version' : item.id === '7z' ? 'i' : '--version'];
    return argv ? (shell === 'pwsh' ? '& ' : '') + argv.map(value => quote(value, shell)).join(' ') : item.command;
  }
  const mirror = LOCAL_TOOL_MIRRORS[mirrorId];
  let argv;
  if (item.kind === 'pip') {
    const py = data?.interpreters.find(value => value.id === data.selected.pythonId);
    argv = [py?.path || 'python', '-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install',
      '--only-binary=:all:', '--no-input', '--retries', '1', '--timeout', '15', '--index-url', mirror.pip, '--', item.package];
  } else {
    const node = data?.nodes.find(value => value.id === data.selected.nodeId);
    const scope = data?.npmScopes.find(value => value.id === 'managed');
    const prefix = scope ? scope.path.replace(/[/\\]node_modules$/, '') : './ebcrypto-local-tools';
    argv = [...(node?.npmCli ? [node.path, node.npmCli] : ['npm']), 'install', '--prefix', prefix,
      '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save=false',
      `--userconfig=${prefix}/.ebcrypto-user.npmrc`, `--globalconfig=${prefix}/.ebcrypto-global.npmrc`,
      '--fetch-retries=1', '--fetch-timeout=15000', `--registry=${mirror.npm}`, '--', item.package];
  }
  return (shell === 'pwsh' ? '& ' : '') + argv.map(value => quote(value, shell)).join(' ');
}

let recentJobId = null;

/** Returns a root with .ready (initial local detection), .dispose(), and .refresh(). */
export function renderLocalToolsPage(host, options = {}) {
  if (!host) throw new TypeError('Local tools host is required');
  host.querySelector('.local-tools-page')?.dispose?.();
  const root = el('section', { class: 'local-tools-page', 'aria-label': text('title') });
  host.replaceChildren(root);
  const request = options.request || defaultRequest;
  let data = null, dead = false, sequence = 0, timer = null, currentJob = null, detecting = false;
  const controllers = new Set();
  const status = el('p', { class: 'lt-status', role: 'status', 'aria-live': 'polite' }, text('checking'));
  const controls = el('div', { class: 'lt-controls' });
  const grid = el('div', { class: 'lt-grid' });
  const resultCount = el('p', { class: 'lt-count', role: 'status' });
  const jobs = el('section', { class: 'lt-jobs', hidden: true, 'aria-label': text('job') });
  const jobState = el('p', { role: 'status', 'aria-live': 'polite' });
  const jobLog = el('pre', { class: 'lt-job-log', tabindex: '0', dir: 'ltr', 'aria-label': text('job') });
  const cancel = button(text('cancel'), async () => {
    try { const result = await call('cancel', { jobId: recentJobId }); updateJob(result.job); }
    catch (error) { status.textContent = error.message; }
  });
  jobs.append(el('h2', {}, text('job')), jobState, jobLog, el('div', { class: 'lt-actions' },
    cancel, button(text('logs'), () => pollJob())), el('p', { class: 'lt-note' }, text('jobContinues')));

  function select(label, id, values) {
    const field = el('select', { id, 'aria-label': label });
    for (const [value, caption] of values) field.append(el('option', { value }, caption));
    controls.append(el('label', { class: 'lt-field', for: id }, el('span', {}, label), field));
    return field;
  }
  const python = select(text('python'), 'lt-python', [['', text('none')]]);
  const node = select(text('node'), 'lt-node', [['', text('none')]]);
  const scope = select(text('scope'), 'lt-scope', [['managed', text('managed')]]);
  const mirror = select(text('mirror'), 'lt-mirror', [['default', text('official')], ['tuna', text('china')]]);
  const shell = select(text('shell'), 'lt-shell', [['pwsh', 'PowerShell'], ['posix', 'POSIX sh / bash']]);
  shell.value = /Win/i.test(navigator.platform) ? 'pwsh' : 'posix';
  const search = el('input', { type: 'search', placeholder: text('search'), 'aria-label': text('search') });
  const category = el('select', { 'aria-label': text('all') }, ...['all', 'runtime', 'crypto', 'general', 'math'].map(
    value => el('option', { value }, text(value))));
  const level = el('select', { 'aria-label': text('anyLevel') }, ...['anyLevel', 'common', 'intermediate'].map(
    value => el('option', { value }, text(value))));
  const refresh = button(text('refresh'), () => detect(true), { class: 'lt-primary' });
  const mirrorLinks = el('div', { class: 'lt-actions' });
  function sourceLinks() {
    const value = LOCAL_TOOL_MIRRORS[mirror.value];
    mirrorLinks.replaceChildren(link(text('source'), value.source),
      ...(value.npmSource ? [link(text('npmSource'), value.npmSource)] : []));
  }
  root.append(el('header', { class: 'lt-heading' }, el('h1', {}, text('title')), refresh),
    el('p', { class: 'lt-note' }, text('privacy')), status, controls, mirrorLinks,
    el('p', { class: 'lt-note' }, text('staticTarget')), el('p', { class: 'lt-note' }, text('installNote')),
    el('p', { class: 'lt-note' }, text('metadataNote')),
    el('div', { class: 'lt-filters' }, search, category, level), resultCount, jobs, grid);
  sourceLinks();

  async function call(action, payload) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), action === 'detect' ? 90000 : 10000);
    try {
      const result = await request(action, payload, { signal: controller.signal });
      if (!result?.ok || result.schema !== LOCAL_TOOLS_SCHEMA) throw new Error(result?.error || 'Unsupported local tools response');
      return result;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }

  function setOptions(field, values, selected) {
    field.replaceChildren(...values.map(([value, caption]) => el('option', { value }, caption)));
    if (!values.length) field.append(el('option', { value: '' }, text('none')));
    field.value = selected || '';
    field.disabled = detecting || !values.length;
  }

  async function detect(force = false) {
    const token = ++sequence;
    detecting = true; refresh.disabled = true;
    for (const field of [python, node, scope]) field.disabled = true;
    status.textContent = text('checking');
    renderCards();
    try {
      // Reuse the current bridge health envelope; an injected client owns its own authentication.
      if (!options.request && !data) {
        const health = await bridgeHealth();
        if (!health.ok) throw new Error(text('static'));
      }
      if (dead || token !== sequence) return;
      const payload = { refresh: force };
      if (python.value) payload.pythonId = python.value;
      if (node.value) payload.nodeId = node.value;
      if (scope.value) payload.npmScope = scope.value;
      const result = await call('detect', payload);
      if (dead || token !== sequence) return;
      data = result;
      status.textContent = text('connected');
    } catch (error) {
      if (dead || token !== sequence) return;
      data = null;
      status.textContent = `${text('static')} ${error.message === text('static') ? '' : error.message}`.trim();
    } finally {
      if (!dead && token === sequence) {
        detecting = false; refresh.disabled = false;
        setOptions(python, data?.interpreters.map(value => [value.id, `${value.default ? text('default') + ' · ' : ''}${value.version} · ${value.path}`]) || [], data?.selected.pythonId);
        setOptions(node, data?.nodes.map(value => [value.id, value.path]) || [], data?.selected.nodeId);
        setOptions(scope, data?.npmScopes.map(value => [value.id, `${value.id === 'managed' ? text('managed') : text('readonly')} · ${value.path}`]) || [['managed', text('managed')]], data?.selected.npmScope || 'managed');
        renderCards();
        if (data && recentJobId) pollJob();
      }
    }
  }

  async function copy(command, output) {
    try { await navigator.clipboard.writeText(command); status.textContent = text('copied'); }
    catch {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(output); selection.removeAllRanges(); selection.addRange(range);
      status.textContent = text('copyFailed');
    }
  }

  function activeJob() { return ['running', 'cancelling'].includes(currentJob?.state); }
  function renderCards() {
    const query = search.value.trim().toLocaleLowerCase();
    const list = LOCAL_TOOL_CATALOG.filter(item => (category.value === 'all' || category.value === item.category)
      && (level.value === 'anyLevel' || level.value === item.level)
      && [item.name, item.package, ...item.modules, item.purpose, item.purposeEn].join(' ').toLocaleLowerCase().includes(query));
    resultCount.textContent = `${list.length} / ${LOCAL_TOOL_CATALOG.length} ${text('count')}`;
    grid.replaceChildren();
    if (!list.length) grid.append(el('p', {}, text('noMatches')));
    for (const item of list) {
      const info = data?.tools[item.id];
      const state = info?.status || 'unknown';
      const lang = document.documentElement.lang || navigator.language;
      const command = commandFor(item, data, mirror.value, shell.value);
      const output = el('code', { dir: 'ltr' }, command);
      const card = el('article', { class: 'lt-card', 'data-tool-id': item.id },
        el('div', { class: 'lt-card-head' }, el('h2', {}, item.name), el('span', { class: `lt-badge lt-${state}` },
          `${text(state)}${info?.version ? ' · ' + info.version : ''}`)),
        el('div', { class: 'lt-tags' }, `${item.kind} · ${text(item.category)} · ${text(item.level)}`),
        el('p', {}, /^zh/i.test(lang) ? item.purpose : item.purposeEn),
        el('p', { class: 'lt-package', dir: 'ltr' }, `${text('package')}: ${item.package}`),
        item.modules.length ? el('p', { class: 'lt-package', dir: 'ltr' }, `${text('modules')}: ${item.modules.join(', ')}`) : null,
        info?.path ? el('p', { class: 'lt-path', dir: 'ltr' }, info.path) : null,
        info?.error ? el('p', { class: 'lt-error' }, info.error) : null,
        el('pre', { class: 'lt-command', tabindex: '0', 'aria-label': item.name + ' command' }, output));
      const actions = el('div', { class: 'lt-actions' }, link(text('website'), item.url),
        button(text('copy'), () => copy(command, output)));
      if (item.kind !== 'runtime') {
        const install = button(text('install'), async () => {
          if (detecting || !data) return;
          if (activeJob()) { status.textContent = text('busy'); return; }
          install.disabled = true;
          const payload = { id: item.id, mirror: mirror.value };
          if (item.kind === 'pip') payload.pythonId = data.selected.pythonId;
          else { payload.nodeId = data.selected.nodeId; payload.npmScope = data.selected.npmScope; }
          try {
            const result = await call('install', payload);
            if (dead) return;
            recentJobId = result.job.jobId;
            updateJob(result.job); schedulePoll(); renderCards();
          } catch (error) { if (!dead) status.textContent = error.message; }
          finally { if (!dead) renderCards(); }
        }, { disabled: !data?.install[item.kind] || activeJob() || detecting });
        actions.append(install);
      }
      card.append(actions); grid.append(card);
    }
  }

  function updateJob(job) {
    if (dead) return;
    currentJob = job; jobs.hidden = false;
    jobState.textContent = `${job.id} · ${text(job.state)} · ${text('target')}: ${job.plan.target}${job.reason ? ' · ' + job.reason : ''}${job.exitCode != null ? ' · exit ' + job.exitCode : ''}`;
    jobLog.textContent = job.log || text('noLog');
    cancel.disabled = job.state !== 'running';
    renderCards();
  }
  function schedulePoll() {
    clearTimeout(timer);
    if (!dead && root.isConnected && activeJob()) timer = setTimeout(() => pollJob(), 900);
  }
  async function pollJob() {
    clearTimeout(timer);
    if (dead || !recentJobId) return;
    try {
      const wasActive = activeJob();
      const result = await call('job', { jobId: recentJobId });
      updateJob(result.job);
      if (wasActive && !activeJob()) await detect(true);
      schedulePoll();
    } catch (error) { if (!dead) status.textContent = error.message; }
  }

  for (const field of [search, category, level, mirror, shell]) field.addEventListener(field === search ? 'input' : 'change', () => { sourceLinks(); renderCards(); });
  for (const field of [python, node, scope]) field.addEventListener('change', () => detect(true));
  const observer = new MutationObserver(() => { if (!root.isConnected) root.dispose(); });
  observer.observe(host, { childList: true });
  root.dispose = () => { dead = true; sequence++; clearTimeout(timer); controllers.forEach(value => value.abort()); observer.disconnect(); };
  root.refresh = () => detect(true);
  renderCards();
  root.ready = options.autoDetect === false ? Promise.resolve() : detect();
  return root;
}
