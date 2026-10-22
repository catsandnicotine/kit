import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { usePauseHiddenMedia } from './usePauseHiddenMedia';

/** Keep retained study videos manual and silent when their card side is hidden.
 * @param root - The study-only HTML container, after its content has been inserted.
 * @param contentKey - Replacement HTML/theme identity for cleanup of the prior videos.
 * @param visible - Whether this controlled card side is currently active.
 * @returns Nothing; original saved markup and scheduling stay unchanged.
 */
export function useStudyVideoMedia(root: RefObject<HTMLElement | null>, contentKey: string, visible: boolean): void {
  usePauseHiddenMedia(root, visible);
  useLayoutEffect(() => {
    const videos = [...root.current?.querySelectorAll('video') ?? []];
    for (const video of videos) {
      video.removeAttribute('autoplay');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      if (!visible) video.pause();
    }
    return () => { for (const video of videos) video.pause(); };
  }, [root, contentKey, visible]);
}
