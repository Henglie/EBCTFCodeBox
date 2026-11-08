import { attachOpWorkbench } from './opWorkbench.js';

const active = new Set();
const text = key => window.__ebctfT?.(key) || key;

/** Reuses the ordinary workbench geometry without rebuilding any field/canvas. */
export function createSpecialWorkbench(key, className = '') {
  const element = document.createElement('div');
  element.className = `op-workbench special-workbench ${className}`.trim();
  element.dataset.workbenchKey = key;
  const config = document.createElement('section'); config.className = 'op-config special-config';
  const data = document.createElement('section'); data.className = 'op-data special-data';
  data.setAttribute('aria-label', text('ui.workbench.data'));
  const splitter = document.createElement('div'); splitter.className = 'op-splitter';
  splitter.setAttribute('role', 'separator'); splitter.setAttribute('aria-orientation', 'vertical');
  splitter.setAttribute('aria-label', text('ui.workbench.resize')); splitter.title = text('ui.workbench.resizeHint');
  config.id = `special-config-${key.replace(/[^\w-]/g, '-')}`;
  splitter.setAttribute('aria-controls', config.id);
  element.append(config, splitter, data);
  let stop = null;
  const api = {
    element, config, data,
    mount(host) { host.append(element); stop = attachOpWorkbench(element); active.add(api); },
    dispose() { stop?.(); stop = null; active.delete(api); },
  };
  return api;
}

export function disposeSpecialWorkbenches() { for (const api of [...active]) api.dispose(); }
