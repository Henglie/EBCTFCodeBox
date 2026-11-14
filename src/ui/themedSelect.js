import { icon } from './icons.js';

let active = null;
let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  const style = document.createElement('style');
  style.textContent = `
.m3-select{display:inline-flex;position:relative;min-width:120px;max-width:100%;vertical-align:middle;}
.m3-select>select[hidden]{display:none!important;}
.m3-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;min-height:44px;padding:0 12px;border:0;border-radius:var(--r-md);background:var(--control-track);color:var(--on-surface);font:inherit;text-align:start;}
.m3-select-trigger>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.m3-select-trigger svg{width:20px;height:20px;flex:none;fill:currentColor;}
.m3-select-trigger:disabled{opacity:.5;cursor:default;}
.m3-select-menu{position:fixed;inset:auto;margin:0;padding:8px;border:0;border-radius:var(--r-lg);background:var(--surface-3);color:var(--on-surface);box-shadow:var(--elevation-floating,var(--el-3));overflow:auto;overscroll-behavior:contain;box-sizing:border-box;z-index:2000;}
.m3-select-menu[hidden]{display:none!important;}
.m3-choice-row{min-height:44px;box-sizing:border-box;border:0;border-radius:var(--r-md);color:var(--on-surface);font:inherit;text-align:start;}
button.m3-choice-row{display:flex;align-items:center;gap:12px;width:100%;padding:8px 12px;background:transparent;white-space:normal;overflow-wrap:anywhere;}
button.m3-choice-row:hover,button.m3-choice-row:focus-visible{background:var(--surface-hi);}
button.m3-choice-row[aria-selected=true]{background:var(--primary-container);color:var(--on-primary-container);}
button.m3-choice-row svg{width:20px;height:20px;flex:none;fill:currentColor;}
button.m3-choice-row .m3-choice-label{flex:1;min-width:0;}
.ci-dialog .ci-head .m3-select{max-width:220px;}
.ds-prof-row .m3-select{flex:1;min-width:120px;}
@media(max-width:860px){.ci-dialog .ci-head .m3-select{flex:1;min-width:0;max-width:none;}}
`;
  document.head.append(style);
  window.addEventListener('keydown', event => {
    if (!active || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); active.close(true); return;
    }
    if (event.key === 'Tab') { active.close(false); return; }
    active.keydown(event);
  }, true);
  document.addEventListener('pointerdown', event => {
    if (active && !active.root.contains(event.target)) active.close(false);
  }, true);
  window.addEventListener('resize', () => active?.position());
  new MutationObserver(() => {
    if (active && !active.root.isConnected) active.close(false);
  }).observe(document.body, { childList: true, subtree: true });
}

/** Keep the real select as the form/data contract; draw its popup with M3 tokens. */
export function themedSelect(select) {
  initialize();
  const root = document.createElement('span'); root.className = 'm3-select';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'm3-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  const arrow = document.createElement('span'); arrow.innerHTML = icon('expand_more'); arrow.setAttribute('aria-hidden', 'true');
  trigger.append(label, arrow);
  const menu = document.createElement('div'); menu.className = 'm3-select-menu'; menu.hidden = true;
  menu.setAttribute('role', 'listbox'); menu.setAttribute('popover', 'manual');
  menu.id = `m3-select-${++themedSelect.nextId}`; trigger.setAttribute('aria-controls', menu.id);
  select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  root.append(select, trigger, menu);
  const sync = () => {
    label.textContent = select.options[select.selectedIndex]?.textContent || select.title || '';
    trigger.disabled = select.disabled;
    trigger.title = select.title || label.textContent;
    trigger.setAttribute('aria-label', (select.getAttribute('aria-label') || select.title || '') + ': ' + label.textContent);
  };
  for (const property of ['value', 'selectedIndex']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property);
    Object.defineProperty(select, property, { configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, value); sync(); },
    });
  }
  select.addEventListener('change', sync);
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
  const enabled = () => [...menu.querySelectorAll('button:not([disabled])')];
  let typeahead = '', typedAt = 0;
  const controller = {
    root,
    close(focus) {
      if (active !== controller) return;
      if (typeof menu.hidePopover === 'function') { try { menu.hidePopover(); } catch { /* Not open. */ } }
      menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); active = null;
      if (focus && root.isConnected) trigger.focus({ preventScroll: true });
    },
    position() {
      const r = trigger.getBoundingClientRect(), viewport = window.visualViewport;
      const height = viewport?.height || innerHeight, width = viewport?.width || innerWidth;
      const offsetTop = viewport?.offsetTop || 0, offsetLeft = viewport?.offsetLeft || 0;
      const below = height + offsetTop - r.bottom - 12, above = r.top - offsetTop - 12;
      const down = below >= 160 || below >= above;
      const available = Math.max(44, down ? below : above);
      menu.style.width = Math.min(Math.max(r.width, 220), width - 24) + 'px';
      menu.style.maxHeight = Math.min(360, available) + 'px';
      menu.style.left = Math.min(Math.max(offsetLeft + 12, r.left), width + offsetLeft - parseFloat(menu.style.width) - 12) + 'px';
      menu.style.top = (down ? r.bottom + 6 : Math.max(offsetTop + 8, r.top - menu.offsetHeight - 6)) + 'px';
    },
    keydown(event) {
      if (!root.contains(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const rows = enabled(); if (!rows.length) return;
      const index = rows.indexOf(document.activeElement);
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % rows.length;
      else if (event.key === 'ArrowUp') next = (index + rows.length - 1) % rows.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = rows.length - 1;
      else if (event.key.length === 1 && event.key !== ' ') {
        typeahead = Date.now() - typedAt > 700 ? event.key : typeahead + event.key; typedAt = Date.now();
        next = rows.findIndex(row => row.textContent.trim().toLocaleLowerCase().startsWith(typeahead.toLocaleLowerCase()));
      }
      if (next != null && next >= 0) { event.preventDefault(); event.stopPropagation(); rows[next].focus(); }
    },
  };
  const open = () => {
    if (trigger.disabled) return;
    if (active === controller) { controller.close(true); return; }
    active?.close(false); active = controller; menu.replaceChildren();
    [...select.options].forEach((option, index) => {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'm3-choice-row';
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.selected)); row.disabled = option.disabled;
      const text = document.createElement('span'); text.className = 'm3-choice-label'; text.textContent = option.textContent;
      row.append(text);
      if (option.selected) { const mark = document.createElement('span'); mark.innerHTML = icon('check'); mark.setAttribute('aria-hidden', 'true'); row.append(mark); }
      row.addEventListener('click', () => {
        select.selectedIndex = index; controller.close(true);
        select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.append(row);
    });
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    if (typeof menu.showPopover === 'function') menu.showPopover();
    controller.position();
    (menu.querySelector('[aria-selected=true]:not([disabled])') || enabled()[0])?.focus({ preventScroll: true });
  };
  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', event => {
    if (active !== controller && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); open(); }
  });
  sync();
  return root;
}
themedSelect.nextId = 0;
