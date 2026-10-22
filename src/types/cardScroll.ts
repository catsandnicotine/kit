import type { ReactNode, RefObject } from 'react';
import type { CardTurnAxis } from './cardTurn';

export interface CardScrollFrameProps {
  children: ReactNode;
  contentKey: string;
  visible: boolean;
}

export interface CardEdgeMetrics {
  top: number;
  height: number;
  contentHeight: number;
}

export interface CardEdgeDrag {
  x: number;
  y: number;
  previousY: number;
  axis: CardTurnAxis;
  offset: number;
}

export interface CardEdgeTouch {
  id: number;
  drag: CardEdgeDrag;
}

export interface CardEdgeFeedbackOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentKey: string;
  visible: boolean;
}
