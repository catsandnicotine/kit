import { describe, expect, it } from 'vitest';
import { hasMeaningfulCardContent } from './cardContent';

describe('hasMeaningfulCardContent', () => {
  it.each(['', '   ', '<br>', '<div><br></div>', '<p>&nbsp;</p>'])(
    'rejects visually empty markup: %s',
    html => expect(hasMeaningfulCardContent(html)).toBe(false),
  );

  it.each([
    'Question',
    '<strong>Question</strong>',
    '<img src="cat.png">',
    '<svg viewBox="0 0 1 1"></svg>',
    '[sound:answer.mp3]',
    '<math><mi>x</mi></math>',
  ])('accepts perceivable card content: %s', html => {
    expect(hasMeaningfulCardContent(html)).toBe(true);
  });
});
