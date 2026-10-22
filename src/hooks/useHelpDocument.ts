import { useEffect, useState } from 'react';
import type { HelpDocumentState, HelpPage } from '../types/helpDocument';

/** Read only Kit's bundled help pages without creating a second browsing context.
 * @param page - The selected bundled document, or null while settings are shown.
 * @returns The current document or a visible loading/error state.
 */
export function useHelpDocument(page: HelpPage | null): HelpDocumentState {
  const [state, setState] = useState<HelpDocumentState>({ status: 'idle' });
  useEffect(() => {
    if (!page) return;
    const controller = new AbortController();
    const load = async () => {
      setState({ status: 'loading', page });
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}${page}.html`, { signal: controller.signal });
        if (!response.ok) throw new Error('Bundled help unavailable');
        const document = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (!controller.signal.aborted) setState({ status: 'ready', page, html: document.body.innerHTML });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error', page });
      }
    };
    void load();
    return () => controller.abort();
  }, [page]);
  return page && 'page' in state && state.page === page ? state : { status: 'idle' };
}
