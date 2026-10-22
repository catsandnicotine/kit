import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { CardTurnBindings, CardTurnController, CardTurnGesture, CardTurnOptions, CardTurnSpring } from '../types/cardTurn';
import { cardTurnAxis, cardTurnDragAngle, cardTurnFace, cardTurnFaceAngle, cardTurnReleaseAngle, cardTurnRevealAngle, cardTurnTravel, stepCardTurnSpring } from '../lib/cardTurn';

const INTERACTIVE = 'button,a,input,textarea,select,summary,audio,video,[contenteditable="true"],[data-hold-edit-actions]';

/** Coordinate drag, tap and direct side changes on one retained pair of card faces.
 * @param options - Controlled face, card identity, interaction guard and existing flip/hold actions.
 * @returns Frame refs, gesture bindings, motion state and a shared direct flip action.
 */
export function useCardTurn(options: CardTurnOptions): CardTurnController {
  const latest = useRef(options);
  latest.current = options;
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const angle = useRef(options.face === 'front' ? 0 : 180);
  const gesture = useRef<CardTurnGesture | null>(null);
  const spring = useRef<CardTurnSpring | null>(null);
  const frame = useRef(0);
  const previousTime = useRef(0);
  const startedTime = useRef(0);
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const expectedFace = useRef<typeof options.face | null>(null);
  const suppressClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [moving, setMoving] = useState(false);
  const [layoutFace, setLayoutFace] = useState(options.face);

  const paint = useCallback((next: number) => {
    angle.current = next;
    const plane = planeRef.current;
    if (!plane) return;
    const reduced = reducedMotion.current;
    plane.style.transform = reduced ? 'none' : `rotateY(${next}deg)`;
    viewportRef.current?.classList.toggle('card-turn-frame--reduced', reduced);
    const face = cardTurnFace(next);
    if (frontRef.current) frontRef.current.style.visibility = reduced && face === 'back' ? 'hidden' : '';
    if (backRef.current) backRef.current.style.visibility = reduced && face === 'front' ? 'hidden' : '';
    const facing = Math.cos(next * Math.PI / 180);
    frontRef.current?.style.setProperty('--card-turn-shade', String(reduced ? 0 : (1 - Math.max(0, facing)) * .16));
    backRef.current?.style.setProperty('--card-turn-shade', String(reduced ? 0 : (1 - Math.max(0, -facing)) * .16));
  }, []);

  const cancelAnimation = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    spring.current = null;
  }, []);

  const finish = useCallback((target: number) => {
    cancelAnimation();
    paint(target);
    // Reconcile scroll/footer geometry only after the retained card is flat.
    // Re-grabbing a spring keeps this last flat layout throughout the next turn.
    setLayoutFace(cardTurnFace(target));
    setMoving(false);
  }, [cancelAnimation, paint]);

  const settle = useCallback((target: number, velocity = 0) => {
    cancelAnimation();
    if (reducedMotion.current || document.hidden || Math.abs(target - angle.current) < .01) {
      finish(target);
      return;
    }
    // A cancelled, unseen front must not coast through the readable back during return.
    const safeVelocity = latest.current.face === 'front' && cardTurnFace(target) === 'front'
      && (target - angle.current) * velocity < 0 ? 0 : velocity;
    spring.current = { angle:angle.current, target, velocity:Math.max(-620, Math.min(620, safeVelocity)) };
    previousTime.current = performance.now();
    startedTime.current = previousTime.current;
    setMoving(true);
    const tick = (now: number) => {
      const active = spring.current;
      if (!active) return;
      const next = stepCardTurnSpring(active, (now - previousTime.current) / 1000);
      previousTime.current = now;
      spring.current = next;
      paint(next.angle);
      if (next.done || now - startedTime.current > 480) { finish(target); return; }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [cancelAnimation, finish, paint]);

  const commit = useCallback((target: number, velocity = 0) => {
    const current = latest.current;
    if (current.disabled || expectedFace.current) return;
    const nextFace = cardTurnFace(target);
    if (nextFace !== current.face) {
      expectedFace.current = nextFace;
      // The session owns its one haptic, preview calculations and controlled phase.
      current.onFlip();
    }
    settle(target, velocity);
  }, [settle]);

  const flip = useCallback(() => {
    if (latest.current.locked) return;
    if (latest.current.disabled) {
      // A direct control is also a tap-away from a hold offer: dismiss it first,
      // preserving all rating/editor guards and leaving the current face alone.
      latest.current.onGestureStart();
      return;
    }
    if (gesture.current || expectedFace.current) return;
    const basis = cardTurnFaceAngle(latest.current.face, spring.current?.target ?? angle.current);
    commit(basis + (latest.current.face === 'front' ? 180 : -180));
  }, [commit]);

  const sync = useCallback(() => { paint(angle.current); }, [paint]);

  const suppressFollowingClick = useCallback(() => {
    suppressClick.current = true;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => { suppressClick.current = false; clickTimer.current = null; }, 450);
  }, []);

  useLayoutEffect(() => {
    gesture.current = null;
    expectedFace.current = null;
    suppressClick.current = false;
    finish(latest.current.face === 'front' ? 0 : 180);
  }, [options.identity, finish]);

  useLayoutEffect(() => {
    if (expectedFace.current === options.face) { expectedFace.current = null; return; }
    // Changes from undo or another direct control must still agree with the visible face.
    if (!gesture.current && cardTurnFace(spring.current?.target ?? angle.current) !== options.face) {
      settle(cardTurnFaceAngle(options.face, angle.current));
    }
  }, [options.face, settle]);

  useEffect(() => {
    if (!options.disabled) return;
    const target = gesture.current?.revealTarget !== null && gesture.current?.revealTarget !== undefined
      ? cardTurnFaceAngle('back', angle.current)
      : cardTurnFaceAngle(expectedFace.current ?? latest.current.face, angle.current);
    gesture.current = null;
    expectedFace.current = null;
    finish(target);
  }, [options.disabled, finish]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      reducedMotion.current = preference.matches;
      if (preference.matches) finish(spring.current?.target ?? cardTurnFaceAngle(latest.current.face, angle.current));
      else paint(angle.current);
    };
    const hide = () => {
      if (!document.hidden) return;
      const target = gesture.current?.revealTarget !== null && gesture.current?.revealTarget !== undefined
        ? cardTurnFaceAngle('back', angle.current)
        : cardTurnFaceAngle(expectedFace.current ?? latest.current.face, spring.current?.target ?? angle.current);
      gesture.current = null;
      finish(target);
    };
    preference.addEventListener('change', change);
    document.addEventListener('visibilitychange', hide);
    return () => {
      preference.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', hide);
      cancelAnimation();
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, [cancelAnimation, finish, paint]);

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    if (active.axis !== 'horizontal') {
      if (active.axis === 'vertical') suppressFollowingClick();
      settle(cardTurnFaceAngle(latest.current.face, angle.current));
      return;
    }
    event.preventDefault();
    suppressFollowingClick();
    if (active.revealTarget !== null) {
      // Reversing the finger cannot un-see an exposed answer. Choose the nearby
      // congruent back so reversing across zero never produces a long extra spin.
      const velocity = !cancelled && event.timeStamp - active.lastMoved < 85 ? active.velocity : 0;
      settle(cardTurnFaceAngle('back', angle.current), velocity);
      return;
    }
    if (cancelled || latest.current.disabled) {
      settle(cardTurnFaceAngle(latest.current.face, angle.current));
      return;
    }
    const target = cardTurnReleaseAngle(active.basis, angle.current);
    commit(target, event.timeStamp - active.lastMoved < 85 ? active.velocity : 0);
  };

  const bindings: CardTurnBindings = {
    onPointerDown: event => {
      // A new physical press is a new intention, not the previous drag's synthetic click.
      suppressClick.current = false;
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = null;
      if (latest.current.disabled || expectedFace.current || !event.isPrimary || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
      cancelAnimation();
      gesture.current = {
        id:event.pointerId, x:event.clientX, y:event.clientY,
        basis:Math.round(angle.current / 180) * 180, startAngle:angle.current,
        axis:'pending', width:viewportRef.current?.clientWidth ?? event.currentTarget.clientWidth,
        revealTarget:null, previousX:event.clientX, previousTime:event.timeStamp,
        lastMoved:event.timeStamp, velocity:0,
      };
    },
    onPointerMove: event => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId || latest.current.disabled) return;
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (active.axis === 'vertical') return;
      if (active.axis === 'pending') {
        active.axis = cardTurnAxis(dx, dy);
        if (active.axis === 'pending') return;
        if (active.axis === 'vertical') {
          suppressFollowingClick();
          settle(cardTurnFaceAngle(latest.current.face, angle.current));
          return;
        }
        latest.current.onGestureStart();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch (error) {
          // Native scrolling may already have cancelled this pointer. Without
          // capture its eventual release could land outside the card entirely.
          gesture.current = null;
          suppressFollowingClick();
          settle(cardTurnFaceAngle(latest.current.face, angle.current));
          if (!(error instanceof DOMException)
            || !['NotFoundError', 'InvalidStateError'].includes(error.name)) throw error;
          return;
        }
        setMoving(true);
      }
      event.preventDefault();
      const width = active.width;
      const delta = event.timeStamp - active.previousTime;
      if (delta > 0 && width > 0) {
        const velocity = (event.clientX - active.previousX) / cardTurnTravel(width) * 180 / delta * 1000;
        active.velocity = active.velocity * .35 + velocity * .65;
      }
      active.previousX = event.clientX;
      active.previousTime = event.timeStamp;
      active.lastMoved = event.timeStamp;
      const nextAngle = active.startAngle + cardTurnDragAngle(dx, width);
      const revealTarget = cardTurnRevealAngle(latest.current.face, nextAngle, active.revealTarget !== null);
      if (revealTarget !== null) {
        const firstReveal = active.revealTarget === null;
        active.revealTarget = revealTarget;
        if (firstReveal) {
          expectedFace.current = 'back';
          // Register the reveal before a frame can expose readable answer pixels.
          latest.current.onFlip();
        }
      }
      paint(nextAngle);
    },
    onPointerUp:event => endDrag(event, false),
    onPointerLeave:event => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId || active.axis === 'horizontal') return;
      gesture.current = null;
      if (active.axis === 'vertical') suppressFollowingClick();
      settle(cardTurnFaceAngle(latest.current.face, angle.current));
    },
    onPointerCancel:event => endDrag(event, true),
    onLostPointerCapture:event => {
      // Touch starts with implicit capture on the hit image/text node. Transferring
      // it to this frame emits a bubbling child loss; that is not our capture ending.
      if (event.target === event.currentTarget) endDrag(event, true);
    },
    onClickCapture:event => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onClick:event => {
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
      if (latest.current.face === 'front') flip();
    },
    onKeyDown:event => {
      if (event.target !== event.currentTarget) return;
      if (!['ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        && !gesture.current && !latest.current.disabled && !expectedFace.current) {
        const basis = cardTurnFaceAngle(latest.current.face, spring.current?.target ?? angle.current);
        commit(basis + (event.key === 'ArrowLeft' ? -180 : 180));
        return;
      }
      flip();
    },
  };

  return { viewportRef, planeRef, frontRef, backRef, bindings, moving, face:options.face, layoutFace, flip, sync };
}
