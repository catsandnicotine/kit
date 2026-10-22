import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Keep study content from opening native selection/callout UI; editors remain separate.
 * @param planeRef - The retained study-only front/back DOM surface.
 * @returns Nothing; imported inline-important selection styles are overridden in this scope.
 */
export function useStudySelectionGuard(planeRef: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const plane = planeRef.current;
    if (!plane) return;
    const guardElement = (element: HTMLElement | SVGElement) => {
      if (element.closest('input,textarea,[contenteditable="true"]')) return;
      for (const property of ['user-select', '-webkit-user-select', '-webkit-touch-callout']) {
        if (element.style.getPropertyValue(property) === 'none' && element.style.getPropertyPriority(property) === 'important') continue;
        element.style.setProperty(property, 'none', 'important');
      }
    };
    const guardTree = (root: HTMLElement | SVGElement) => {
      guardElement(root);
      for (const element of root.querySelectorAll('*')) if (element instanceof HTMLElement || element instanceof SVGElement) guardElement(element);
    };
    guardTree(plane);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) if (node instanceof HTMLElement || node instanceof SVGElement) guardTree(node);
        } else if (record.target instanceof HTMLElement || record.target instanceof SVGElement) {
          // Per-frame transform/shading changes inspect only that one element.
          guardElement(record.target);
        }
      }
    });
    observer.observe(plane, { subtree:true, childList:true, attributes:true, attributeFilter:['style', 'contenteditable'] });
    return () => observer.disconnect();
  }, [planeRef]);
}
