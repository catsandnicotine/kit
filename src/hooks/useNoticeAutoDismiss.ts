import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent } from 'react';
import type { NoticeAutoDismissOptions, NoticeClock } from '../types/noticeTiming';
import { pauseNoticeClock, remainingNoticeTime, resumeNoticeClock } from '../lib/noticeTiming';

/**
 * Hide a finished notice after visible reading time, pausing for interaction.
 * @param options - Message identity, visibility, budget, and dismissal callback; null means persistent.
 * @returns Pointer/focus handlers and a details-state callback for the notice container.
 */
export function useNoticeAutoDismiss({ identity, visible, delayMs, onDismiss }: NoticeAutoDismissOptions) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const callback = useRef(onDismiss);
  callback.current = onDismiss;
  const clock = useRef<NoticeClock>({ remainingMs: 0, runningSince: null });
  const previous = useRef<{ identity: string; delayMs: number | null } | null>(null);
  const paused = hovered || focused || detailsOpen || hidden;
  const dismissible = onDismiss !== undefined;

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const now = performance.now();
    if (previous.current?.identity !== identity || previous.current?.delayMs !== delayMs) {
      clock.current = { remainingMs: Math.max(0, delayMs ?? 0), runningSince: null };
      previous.current = { identity, delayMs };
    }
    if (!visible || delayMs === null || !dismissible || paused) return;
    clock.current = resumeNoticeClock(clock.current, now);
    const timer = setTimeout(() => {
      clock.current = { remainingMs: 0, runningSince: null };
      callback.current?.();
    }, remainingNoticeTime(clock.current, now));
    return () => {
      clearTimeout(timer);
      clock.current = pauseNoticeClock(clock.current, performance.now());
    };
  }, [identity, visible, delayMs, dismissible, paused]);

  return {
    events: {
      onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') setHovered(true); },
      onPointerLeave: () => setHovered(false),
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      },
    },
    setDetailsOpen,
  };
}
