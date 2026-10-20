import { describe, expect, it } from 'vitest';
import { getStudyProgress } from './studyProgress';

describe('session progress', () => {
  it('starts empty without claiming completed work', () => {
    expect(getStudyProgress([], 0)).toEqual({ completed: 0, total: 0, remaining: 0, percent: 0 });
  });
  it('counts only cards no longer pending, including repeated cards', () => {
    expect(getStudyProgress(['a', 'b', 'c', 'a'], 1)).toEqual({ completed: 0, total: 3, remaining: 3, percent: 0 });
    expect(getStudyProgress(['a', 'b', 'c', 'a'], 3)).toEqual({ completed: 2, total: 3, remaining: 1, percent: 2 / 3 * 100 });
  });
  it('returns unfinished work when undo moves the position back', () => {
    expect(getStudyProgress(['a', 'b', 'c'], 2).completed).toBe(2);
    expect(getStudyProgress(['a', 'b', 'c'], 1).completed).toBe(1);
  });
  it('finishes without counting repeated encounters twice', () => {
    expect(getStudyProgress(['a', 'b', 'a'], 2, true)).toEqual({ completed: 2, total: 2, remaining: 0, percent: 100 });
  });
});
