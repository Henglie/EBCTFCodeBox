/** Shared CodeMirror input policy for editable code and source comparison. */
export function codeInputExtensions(CM, { readonly = false, label, onSave, onRun, onEscape }) {
  const { EditorState, EditorView, keymap, searchKeymap, openSearchPanel, closeSearchPanel } = CM;
  let tabFocus = false;
  const keys = [
    { key: 'Escape', run: view => closeSearchPanel(view) || !!onEscape?.() },
    { key: 'Mod-f', run: openSearchPanel },
  ];
  const extensions = [
    EditorState.tabSize.of(2),
    EditorView.editorAttributes.of({ dir: 'ltr' }),
    EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', translate: 'no', ...(readonly ? { tabindex: '0' } : {}) }),
  ];
  if (readonly) {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    keys.push(...CM.defaultKeymap);
  } else {
    keys.push(
      { key: 'Mod-s', run: () => { onSave(); return true; } },
      { key: 'Mod-Enter', run: () => { onRun(); return true; } },
      { key: 'Mod-h', run: openSearchPanel },
      { key: 'Mod-/', run: CM.toggleComment },
      { key: 'Mod-Shift-z', run: CM.historyKeymap.find(binding => binding.key === 'Mod-y').run },
      { key: 'Mod-m', run: view => { tabFocus = !tabFocus; view.setTabFocusMode(tabFocus); return true; } },
      CM.indentWithTab, ...CM.closeBracketsKeymap, ...CM.defaultKeymap, ...CM.historyKeymap,
    );
    extensions.push(EditorState.allowMultipleSelections.of(true), CM.history(), CM.drawSelection(), CM.dropCursor(),
      CM.rectangularSelection(), CM.closeBrackets(), CM.bracketMatching(), CM.highlightSelectionMatches());
  }
  extensions.push(keymap.of([...keys, ...searchKeymap]));
  return extensions;
}
