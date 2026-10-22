const IMAGE_LIMIT = 4;
export const SESSION_ENTRANCE_IMAGE_BUDGET_MS = 450;

/** Give the initial visible front images a bounded chance to finish decoding.
 * @param root - Mounted session root, after the front HTML has been inserted.
 * @param onReady - Called once immediately for text, or after image load/decode/budget.
 * @param remainingMs - Remaining entry budget, shared across pre-entry HTML replacements.
 * @returns Cleanup that removes listeners/timer and ignores late decode continuations.
 */
export function prepareSessionEntrance(root: HTMLDivElement | null, onReady: () => void, remainingMs = SESSION_ENTRANCE_IMAGE_BUDGET_MS): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cleanups: (() => void)[] = [];
  const cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const remove of cleanups.splice(0)) remove();
  };
  const finish = () => {
    if (!active) return;
    active = false;
    cleanup();
    onReady();
  };
  const cancel = () => { active = false; cleanup(); };
  try {
    const front = root?.querySelector<HTMLElement>('.card-turn-surface--front');
    if (!front || remainingMs <= 0) { finish(); return cancel; }
    const viewport = front.querySelector<HTMLElement>('.card-scroll-viewport') ?? front;
    const bounds = viewport.getBoundingClientRect();
    const view = front.ownerDocument.defaultView;
    const top = Math.max(0, bounds.top);
    const left = Math.max(0, bounds.left);
    const bottom = Math.min(bounds.bottom, view?.innerHeight ?? bounds.bottom);
    const right = Math.min(bounds.right, view?.innerWidth ?? bounds.right);
    if (bottom <= top || right <= left) { finish(); return cancel; }
    const pending: HTMLImageElement[] = [];
    for (const image of front.querySelectorAll<HTMLImageElement>('img')) {
      if (image.complete && (image.naturalWidth <= 0 || typeof image.decode !== 'function')) continue;
      if (image.getClientRects().length === 0) continue;
      const style = view?.getComputedStyle(image);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') continue;
      const rect = image.getBoundingClientRect();
      const vertical = rect.height > 0 ? rect.bottom > top && rect.top < bottom : rect.top >= top && rect.top < bottom;
      const horizontal = rect.width > 0 ? rect.right > left && rect.left < right : rect.left >= left && rect.left < right;
      if (!vertical || !horizontal) continue;
      pending.push(image);
      if (pending.length === IMAGE_LIMIT) break;
    }
    if (!pending.length) { finish(); return cancel; }
    let remaining = pending.length;
    timer = setTimeout(finish, Math.max(0, Math.min(remainingMs, SESSION_ENTRANCE_IMAGE_BUDGET_MS)));
    for (const image of pending) {
      let settled = false;
      const removeListeners = () => {
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', done);
      };
      const done = () => {
        if (!active || settled) return;
        settled = true;
        removeListeners();
        remaining--;
        if (remaining === 0) finish();
      };
      const loaded = () => {
        removeListeners();
        if (!active || settled) return;
        try {
          if (image.naturalWidth > 0 && typeof image.decode === 'function') {
            void image.decode().then(done, done);
          } else done();
        } catch { done(); }
      };
      image.addEventListener('load', loaded, { once:true });
      image.addEventListener('error', done, { once:true });
      cleanups.push(removeListeners);
      // A cached request can complete between the initial scan and listener setup.
      if (image.complete) loaded();
    }
  } catch {
    // A malformed/imported image must never leave the session unavailable.
    finish();
  }
  return cancel;
}
