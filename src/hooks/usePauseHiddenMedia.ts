import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Pause retained media when hidden and release captured videos when their DOM leaves.
 * @param root - Editor face containing native media controls.
 * @param active - Whether this face is currently available for playback.
 * @returns Nothing; playback stays an explicit user action.
 */
export function usePauseHiddenMedia(root: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const videos = new Set<HTMLVideoElement>();
    const capture = (video: HTMLVideoElement) => {
      if (videos.has(video)) return;
      videos.add(video);
      if (!active) video.pause();
    };
    const inTree = (node: Node): HTMLVideoElement[] => {
      if (!(node instanceof Element)) return [];
      return node instanceof HTMLVideoElement ? [node] : [...node.querySelectorAll('video')];
    };
    for (const video of container.querySelectorAll('video')) capture(video);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (!active && record.target instanceof HTMLVideoElement) record.target.pause();
          continue;
        }
        for (const removed of record.removedNodes) {
          for (const video of inTree(removed)) {
            // A section reordered within this same workspace remains the same media.
            if (container.contains(video)) continue;
            video.pause();
            videos.delete(video);
          }
        }
        for (const added of record.addedNodes) {
          for (const video of inTree(added)) if (container.contains(video)) capture(video);
        }
      }
    });
    observer.observe(container, { subtree:true, childList:true, attributes:true, attributeFilter:['autoplay'] });
    return () => {
      observer.disconnect();
      for (const video of videos) video.pause();
      videos.clear();
    };
  }, [root, active]);
}
