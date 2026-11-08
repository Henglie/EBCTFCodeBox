/** Shared OP editor shell: heading and tools sit inside the editor's border. */
export function createIoEditorFrame(title, tools, body) {
  const frame = document.createElement('div'); frame.className = 'io-editor-frame';
  const head = document.createElement('div'); head.className = 'io-pane-head';
  const label = document.createElement('span'); label.className = 'io-pane-title'; label.textContent = title;
  head.append(label, tools);
  frame.append(head, body);
  return frame;
}
