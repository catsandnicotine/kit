/**
 * KitLogo — "Kit" rendered in bold system font. Uses useTheme() for color.
 */

import { useTheme } from '../hooks/useTheme';

interface KitLogoProps {
  /** Font size / height in pixels. Default 16. */
  height?: number;
}

/**
 * @param height - Font size in pixels.
 */
export function KitLogo({ height = 16 }: KitLogoProps) {
  const { resolvedTheme } = useTheme();
  const color = resolvedTheme === 'dark' ? '#E5E5E5' : '#1c1c1e';

  return (
    <span
      aria-label="Kit logo"
      style={{
        fontSize: height,
        fontWeight: 700,
        color,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        letterSpacing: '-0.02em',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      Kit
    </span>
  );
}
