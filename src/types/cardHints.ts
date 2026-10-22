export interface CardHintBoundary {
  start: number;
  end: number;
}

export interface CardHintReplacement extends CardHintBoundary {
  html: string;
}
