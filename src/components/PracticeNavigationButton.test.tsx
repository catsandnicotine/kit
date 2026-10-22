import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PracticeNavigationButton } from './PracticeNavigationButton';
import { StudyFooter } from './StudyFooter';
import { PracticeFinishNavigation } from './PracticeFinishNavigation';
import { ReviewChoices } from './ReviewChoices';

describe('persistent practice navigation', () => {
  it.each(['front', 'back'] as const)('keeps Previous and Next outside the %s action crossfade', face => {
    const html = renderToStaticMarkup(<StudyFooter face={face} onFlip={() => undefined}
      frontActions={<span>Reveal artwork</span>} backActions={<span>Choice artwork</span>}
      leading={<PracticeNavigationButton direction="previous" disabled onNavigate={() => undefined} />}
      trailing={<PracticeNavigationButton direction="next" disabled={false} onNavigate={() => undefined} />}
    />);
    const tools = html.slice(html.indexOf('class="study-tools"'));
    expect(tools).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous card"/);
    expect(tools).toMatch(/<button[^>]*aria-label="Next card"/);
    expect(tools.indexOf('Previous card')).toBeLessThan(tools.indexOf('Card sides'));
    expect(tools.indexOf('Next card')).toBeGreaterThan(tools.indexOf('Card sides'));
    expect(html.slice(0, html.indexOf('class="study-tools"'))).not.toContain('Previous card');
  });

  it('keeps locked controls visible and disabled without adding a frame or visible label', () => {
    const html = renderToStaticMarkup(<PracticeNavigationButton direction="next" disabled onNavigate={() => undefined} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('disabled:opacity-30');
    expect(html).not.toContain('invisible');
    expect(html).not.toContain('<span');
  });

  it.each([false, true])('keeps both arrows on the finish screen with previous availability %s', canPrevious => {
    const html = renderToStaticMarkup(<PracticeFinishNavigation canPrevious={canPrevious} onPrevious={() => undefined} />);
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next card"/);
    const previous = html.match(/<button[^>]*aria-label="Previous card"/)?.[0] ?? '';
    expect(previous.includes('disabled=""')).toBe(!canPrevious);
  });

  it('clearly dims past choices while leaving their meaning and the navigation available', () => {
    const html = renderToStaticMarkup(<ReviewChoices onRepeat={() => undefined} onPutAside={() => undefined} selected={null} pending={false} readOnly />);
    expect(html).toContain('opacity-40');
    expect(html).toContain('Practice choice already recorded');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
