import { useCallback, useEffect, useRef, useState } from 'react';
import { getLibrarySwipeDistance, getLibrarySwipeOffset, getLibrarySwipeTarget, LIBRARY_SWIPE_HORIZONTAL_RATIO, LIBRARY_SWIPE_SETTLE_MS } from '../lib/librarySwipe';
import { getLibraryPageProgress } from '../lib/libraryPagePosition';
import { createLibrarySwipeHaptics, hapticNavigate } from '../lib/platform/haptics';
import type { LibrarySwipeMode } from '../types/librarySwipe';
import type { LibrarySwipeHapticFeedback } from '../types/haptics';

/** Track a deliberate horizontal library drag while preserving vertical browsing.
 * @param mode - Current scheduled-study or free-practice library.
 * @param onChange - Commit a deliberate mode selection.
 * @param enabled - Disable touch navigation while loading or searching.
 * @returns Content ref, direct drag presentation, clamped page progress, return transition, event handlers and dot navigation.
 */
export function useLibrarySwipe(mode: LibrarySwipeMode, onChange: (mode: LibrarySwipeMode) => void, enabled: boolean) {
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active:false, startX:0, startY:0, startTime:0, dx:0, dy:0, width:0, decided:false, horizontal:false, thresholdCrossed:false });
  const current = useRef({ mode, onChange, enabled });
  current.current = { mode, onChange, enabled };
  const blockedClickUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const feedback = useRef<LibrarySwipeHapticFeedback | null>(null);
  const [offset, setOffset] = useState(0);
  const [returning, setReturning] = useState(false);
  const [pageProgress, setPageProgress] = useState(mode === 'learn' ? 0 : 1);
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const reset = useCallback(() => {
    drag.current.active = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    feedback.current?.cancel();
    feedback.current = null;
    setOffset(0);
    setReturning(false);
    setPageProgress(current.current.mode === 'learn' ? 0 : 1);
  }, []);

  const settle = useCallback((next: LibrarySwipeMode, committed = false) => {
    drag.current.active = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const landing = committed ? feedback.current : null;
    if (!landing) {
      feedback.current?.cancel();
      feedback.current = null;
    }
    setOffset(0);
    setPageProgress(next === 'learn' ? 0 : 1);
    setReturning(!reducedMotion.current);
    if (!reducedMotion.current) timer.current = setTimeout(() => {
      timer.current = undefined;
      setReturning(false);
      if (landing && feedback.current === landing) {
        feedback.current = null;
        if (current.current.enabled && current.current.mode === next && !document.hidden) void landing.land();
        else landing.cancel();
      }
    }, LIBRARY_SWIPE_SETTLE_MS);
    else if (landing) {
      feedback.current = null;
      void landing.land();
    }
  }, []);

  const trackDetents = useCallback((dx: number, width: number) => {
    if (!current.current.enabled || document.hidden) return;
    const inward = current.current.mode === 'learn' ? dx < 0 : dx > 0;
    const distance = getLibrarySwipeDistance(width);
    if (!inward || distance === 0) return;
    if (!feedback.current) {
      feedback.current = createLibrarySwipeHaptics();
      void feedback.current.lift();
    }
    if (!drag.current.thresholdCrossed && Math.abs(dx) >= distance) {
      drag.current.thresholdCrossed = true;
      void feedback.current.threshold();
    }
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotion.current = preference.matches;
      if (preference.matches) reset();
    };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, [reset]);
  useEffect(() => {
    if (!drag.current.active) setPageProgress(mode === 'learn' ? 0 : 1);
  }, [mode]);
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  useEffect(() => {
    const onVisibilityChange = () => { if (document.hidden) reset(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', reset);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', reset);
      if (timer.current) clearTimeout(timer.current);
      feedback.current?.cancel();
      feedback.current = null;
    };
  }, [reset]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element || !enabled) return;
    const move = (event: TouchEvent) => {
      const state = drag.current;
      if (!state.active) return;
      if (event.touches.length !== 1) {
        if (state.decided) blockedClickUntil.current = performance.now() + 250;
        settle(current.current.mode);
        return;
      }
      const touch = event.touches[0]!;
      state.dx = touch.clientX - state.startX;
      state.dy = touch.clientY - state.startY;
      if (!state.decided && Math.max(Math.abs(state.dx), Math.abs(state.dy)) > 10) {
        state.decided = true;
        state.horizontal = Math.abs(state.dx) >= Math.abs(state.dy) * LIBRARY_SWIPE_HORIZONTAL_RATIO;
      }
      if (!state.horizontal) return;
      event.preventDefault();
      trackDetents(state.dx, state.width);
      setOffset(getLibrarySwipeOffset(current.current.mode, state.dx, state.width));
      if (!reducedMotion.current) setPageProgress(getLibraryPageProgress(current.current.mode, state.dx, state.width));
    };
    element.addEventListener('touchmove', move, { passive:false });
    return () => element.removeEventListener('touchmove', move);
  }, [enabled, settle, trackDetents]);
  const onTouchStart = useCallback((event: React.TouchEvent) => {
    if (!current.current.enabled || event.touches.length !== 1) return;
    blockedClickUntil.current = 0;
    reset();
    const touch = event.touches[0]!;
    drag.current = { active:true, startX:touch.clientX, startY:touch.clientY, startTime:performance.now(), dx:0, dy:0, width:contentRef.current?.clientWidth ?? 0, decided:false, horizontal:false, thresholdCrossed:false };
  }, [reset]);

  const onTouchEnd = useCallback((event: React.TouchEvent) => {
    const state = drag.current;
    if (!state.active) return;
    const touch = event.changedTouches[0];
    if (touch) {
      state.dx = touch.clientX - state.startX;
      state.dy = touch.clientY - state.startY;
    }
    // Refresh this at release: a long scroll must not become a delayed deck tap.
    if (state.decided || Math.max(Math.abs(state.dx), Math.abs(state.dy)) > 10) {
      blockedClickUntil.current = performance.now() + 250;
    }
    if (!state.horizontal) { reset(); return; }
    state.active = false;
    const next = current.current.enabled ? getLibrarySwipeTarget({
      mode:current.current.mode,
      dx:state.dx,
      dy:state.dy,
      durationMs:performance.now() - state.startTime,
      width:state.width,
      horizontalLocked:true,
    }) : null;
    if (next) trackDetents(state.dx, state.width);
    settle(next ?? current.current.mode, next !== null);
    if (next) current.current.onChange(next);
  }, [reset, settle, trackDetents]);

  const onTouchCancel = useCallback(() => {
    const state = drag.current;
    if (state.decided || Math.max(Math.abs(state.dx), Math.abs(state.dy)) > 10) {
      blockedClickUntil.current = performance.now() + 250;
    }
    settle(current.current.mode);
  }, [settle]);

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (performance.now() >= blockedClickUntil.current) return;
    blockedClickUntil.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const changeMode = useCallback((next: LibrarySwipeMode) => {
    if (next === current.current.mode) { reset(); return; }
    settle(next);
    hapticNavigate();
    current.current.onChange(next);
  }, [reset, settle]);

  return { contentRef, offset, returning, pageProgress, onTouchStart, onTouchEnd, onTouchCancel, onClickCapture, changeMode };
}
