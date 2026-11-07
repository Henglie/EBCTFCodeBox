// Compact, non-modal action disclosure. The existing buttons keep their handlers.
export function initTopbarMenu() {
  const toggle = document.getElementById("btnMoreActions");
  const actions = document.getElementById("topbarActions");
  if (!toggle || !actions) return;
  const media = matchMedia("(max-width: 600px)");
  let opened = false;
  const close = (restoreFocus = false) => {
    if (!opened) return;
    opened = false;
    actions.classList.remove("actions-open");
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && media.matches) toggle.focus({ preventScroll: true });
  };
  toggle.addEventListener("click", () => {
    if (opened) { close(true); return; }
    opened = true;
    actions.classList.add("actions-open");
    toggle.setAttribute("aria-expanded", "true");
    actions.querySelector("button, a[href]")?.focus({ preventScroll: true });
  });
  // Capture also observes actions whose existing handlers stop propagation.
  actions.addEventListener("click", event => {
    const action = event.target.closest("button, a[href]");
    if (!action || !opened) return;
    // Anchored panels retain their visible anchor until dismissed.
    if (action.id === "btnLang" || action.id === "btnFont") return;
    close(true);
  }, true);
  document.addEventListener("pointerdown", event => {
    if (event.target.closest(".env-panel, .lang-menu")) return;
    if (!actions.contains(event.target) && !toggle.contains(event.target)) close();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !opened || event.defaultPrevented) return;
    if (document.querySelector('.env-panel, .lang-menu, [aria-modal="true"]')) return;
    event.preventDefault();
    close(true);
  });
  window.addEventListener("hashchange", () => close());
  media.addEventListener("change", () => {
    const focused = document.activeElement;
    close();
    if (media.matches && actions.contains(focused)) toggle.focus({ preventScroll: true });
    else if (!media.matches && focused === toggle) actions.querySelector("button, a[href]")?.focus();
  });
}
