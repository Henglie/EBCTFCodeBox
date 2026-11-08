import { attachEditorToolbar } from './editorToolbar.js';
import { openExpandModal } from './expandableInput.js';
import { icon } from './icons.js';

export function attachFieldTools(area, label, { getEpoch = () => 0 } = {}) {
  const t = key => window.__ebctfT?.(key) || key;
  const changed = () => area.dispatchEvent(new Event('input', { bubbles: true }));
  area.addEventListener('input', () => { area._loadSeq = (area._loadSeq || 0) + 1; });
  const toolbar = attachEditorToolbar(area, { onChange: changed, exportName: `${area.id}.txt` });
  toolbar.classList.add('io-field-tools');
  const [, clear, ...secondary] = [...toolbar.children];
  const button = (glyph, key, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'et-btn';
    node.title = node.ariaLabel = t(key); node.innerHTML = icon(glyph); node.addEventListener('click', action);
    return node;
  };
  const file = document.createElement('input'); file.type = 'file'; file.hidden = true;
  const paste = button('content_paste', 'ui.op.paste', async () => {
    const epoch = getEpoch(), seq = area._loadSeq = (area._loadSeq || 0) + 1;
    try {
      const text = await navigator.clipboard.readText();
      if (epoch !== getEpoch() || seq !== area._loadSeq || !area.isConnected) return;
      area.value = text; changed();
    } catch { if (epoch === getEpoch() && seq === area._loadSeq && area.isConnected) window.__ebctfToast?.(t('ui.toast.clipFail')); }
  });
  async function read(fileValue) {
    if (!fileValue) return;
    const epoch = getEpoch(), seq = area._loadSeq = (area._loadSeq || 0) + 1;
    try {
      const bytes = await fileValue.arrayBuffer();
      if (epoch !== getEpoch() || seq !== area._loadSeq || !area.isConnected) return;
      area.value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      changed();
    } catch (error) { if (epoch === getEpoch() && seq === area._loadSeq && area.isConnected) window.__ebctfToast?.(error.message); }
    finally { file.value = ''; }
  }
  file.addEventListener('change', () => read(file.files?.[0]));
  area.addEventListener('dragover', event => event.preventDefault());
  area.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); read(event.dataTransfer?.files?.[0]); });
  const more = document.createElement('details'); more.className = 'io-tools-more';
  const summary = document.createElement('summary'); summary.className = 'et-btn';
  summary.title = summary.ariaLabel = t('ui.topbar.more'); summary.innerHTML = icon('expand_more');
  const extra = document.createElement('div'); extra.className = 'io-tools-extra'; extra.append(...secondary);
  more.append(summary, extra);
  more.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); more.open = false; summary.focus(); } });
  extra.addEventListener('click', () => { more.open = false; summary.focus({ preventScroll: true }); });
  const expand = button('open_in_full', 'ui.expand.title', () => {
    const epoch = getEpoch(), seq = area._loadSeq || 0;
    openExpandModal(area.value, value => {
      if (epoch !== getEpoch() || seq !== (area._loadSeq || 0) || !area.isConnected) return;
      area.value = value; changed();
    }, { modalTitle: label, cancelLabel: t('ui.expand.cancel'), saveLabel: t('ui.expand.save'), closeOnClear: true });
  });
  toolbar.replaceChildren(paste, clear, button('cloud_upload', 'ui.op.pickFile', () => file.click()), expand, more, file);
  return toolbar;
}
