import type { KeyboardEventHandler, MouseEventHandler, PointerEventHandler, ReactNode, RefObject } from 'react';
import type { CardFace, HoldToEditBindings } from './editorUi';

export interface CardTurnSpring {
  angle: number;
  velocity: number;
  target: number;
}

export interface CardTurnSpringStep extends CardTurnSpring {
  done: boolean;
}

export interface CardTurnOptions {
  face: CardFace;
  identity: string;
  disabled: boolean;
  locked: boolean;
  /** Existing session flip owns the phase change and its one light haptic. */
  onFlip: () => void;
  /** Cancel pending hold feedback once a horizontal turn is intentional. */
  onGestureStart: () => void;
}

export interface CardTurnGesture {
  id: number;
  x: number;
  y: number;
  basis: number;
  startAngle: number;
  axis: CardTurnAxis;
  width: number;
  revealTarget: number | null;
  previousX: number;
  previousTime: number;
  lastMoved: number;
  velocity: number;
}

export type CardTurnAxis = 'pending' | 'horizontal' | 'vertical';

export interface CardTurnBindings {
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerLeave: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
  onClickCapture: MouseEventHandler<HTMLDivElement>;
  onClick: MouseEventHandler<HTMLDivElement>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

export interface CardTurnController {
  viewportRef: RefObject<HTMLDivElement | null>;
  planeRef: RefObject<HTMLDivElement | null>;
  frontRef: RefObject<HTMLDivElement | null>;
  backRef: RefObject<HTMLDivElement | null>;
  bindings: CardTurnBindings;
  moving: boolean;
  face: CardFace;
  /** Last flat face; geometry stays stable through a turn and rapid re-grabs. */
  layoutFace: CardFace;
  flip: () => void;
  sync: () => void;
}

export interface CardTurnFrameProps {
  controller: CardTurnController;
  front: ReactNode;
  back: ReactNode;
  children?: ReactNode;
  className?: string;
  holdBindings: HoldToEditBindings;
  onEdit: () => void;
  locked: boolean;
}
