import type { CardTurnFrameProps } from '../types/cardTurn';
import { useLayoutEffect } from 'react';
import { useStudySelectionGuard } from '../hooks/useStudySelectionGuard';
import './CardTurnFrame.css';

/** Retain the real front/back content and its scroll positions on one turning plane.
 * @param props - Shared controller, existing face renderers and hold-to-edit feedback.
 * @returns A native-scroll-friendly perspective frame with accessible direct alternatives.
 */
export function CardTurnFrame({ controller, front, back, children, className = '', holdBindings, onEdit, locked }: CardTurnFrameProps) {
  const { bindings, face } = controller;
  const sync = controller.sync;
  // A loading branch may have run the controller before its DOM frame existed.
  useLayoutEffect(() => { sync(); }, [sync]);
  useStudySelectionGuard(controller.planeRef);
  return <div
    ref={controller.viewportRef}
    className={`card-turn-frame ${controller.moving ? 'card-turn-frame--moving' : ''} ${locked ? 'card-turn-frame--locked' : ''} ${className}`}
    data-card-face={face}
    tabIndex={locked ? -1 : 0}
    role="group"
    aria-label="Current card"
    aria-keyshortcuts="F2 ArrowLeft ArrowRight"
    onPointerDown={event => { holdBindings.onPointerDown(event); bindings.onPointerDown(event); }}
    onPointerMove={event => { bindings.onPointerMove(event); holdBindings.onPointerMove(event); }}
    onPointerUp={event => { bindings.onPointerUp(event); holdBindings.onPointerUp(event); }}
    onPointerCancel={event => { bindings.onPointerCancel(event); holdBindings.onPointerCancel(event); }}
    onPointerLeave={event => { bindings.onPointerLeave(event); holdBindings.onPointerLeave(event); }}
    onLostPointerCapture={bindings.onLostPointerCapture}
    onDragStart={event => { event.preventDefault(); }}
    onClickCapture={event => { holdBindings.onClickCapture(event); if (!event.isPropagationStopped()) bindings.onClickCapture(event); }}
    onClick={bindings.onClick}
    onContextMenu={holdBindings.onContextMenu}
    onKeyDown={event => {
      if (event.key === 'F2') { event.preventDefault(); onEdit(); return; }
      bindings.onKeyDown(event);
    }}
  >
    <div ref={controller.planeRef} className="card-turn-plane" inert={locked}>
      <div ref={controller.frontRef} className="card-turn-surface card-turn-surface--front study-question-content" role="region" aria-label="Question" aria-hidden={face !== 'front'} inert={face !== 'front'}>{front}</div>
      <div ref={controller.backRef} className="card-turn-surface card-turn-surface--back" role="region" aria-label="Answer" aria-hidden={face !== 'back'} inert={face !== 'back'}>{back}</div>
    </div>
    {children}
  </div>;
}
