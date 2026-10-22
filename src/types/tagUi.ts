import type { CSSProperties } from 'react';

export interface TagLabelProps {
  name: string;
  color?: string | undefined;
  compact?: boolean;
}

export interface TagLabelStyle extends CSSProperties {
  '--tag-pigment': string;
}

export interface CardTagRowProps {
  tags: readonly string[];
  colors: ReadonlyMap<string, string>;
}
