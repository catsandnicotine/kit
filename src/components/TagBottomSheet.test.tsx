import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { TagBottomSheet } from './TagBottomSheet';

const runtime = vi.hoisted(() => ({ cursor:0, slots:[] as unknown[] }));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [runtime.slots[index] as T, (next: T | ((previous: T) => T)) => {
      runtime.slots[index] = typeof next === 'function' ? (next as (previous: T) => T)(runtime.slots[index] as T) : next;
    }];
  },
  useRef<T>(initial: T) {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = { current:initial };
    return runtime.slots[index] as { current:T };
  },
  useCallback:<T,>(callback: T) => callback,
  useEffect:() => {},
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function find(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> {
  const visit = (value: unknown): ReactElement<Record<string, unknown>> | null => {
    if (Array.isArray(value)) { for (const child of value) { const found = visit(child); if (found) return found; } return null; }
    if (typeof value !== 'object' || value === null || !('props' in value)) return null;
    const element = value as ReactElement<Record<string, unknown>>;
    return predicate(element) ? element : visit(element.props.children);
  };
  const result = visit(node); if (!result) throw new Error('Test control not found'); return result;
}
function fixture() {
  const props = { tag:{ tag:'Bio', color:'', count:1 }, onClose:vi.fn(), onRename:vi.fn(async () => true), onColorChange:vi.fn(), onDelete:vi.fn<() => void | Promise<void>>(), onTagUpdated:vi.fn() };
  const render = () => { runtime.cursor = 0; return TagBottomSheet(props); };
  const click = (text: string) => { (find(render(), element => element.type === 'button' && element.props.children === text).props.onClick as () => void)(); };
  const rename = () => {
    click('Bio');
    (find(render(), element => element.type === 'input').props.onChange as (event: unknown) => void)({ target:{ value:'Science' } });
    const input = find(render(), element => element.type === 'input');
    (input.props.onKeyDown as (event: unknown) => void)({ key:'Enter', preventDefault:vi.fn() });
    return input;
  };
  return { props, render, click, rename };
}

beforeEach(() => { runtime.cursor = 0; runtime.slots = []; });
describe('tag detail awaits real mutation results', () => {
  it('publishes a renamed label only after successful completion and coalesces blur/Enter', async () => {
    const test = fixture(), pending = deferred<boolean>();
    test.props.onRename.mockImplementation(() => pending.promise);
    const input = test.rename();
    (input.props.onBlur as () => void)();
    expect(test.props.onRename).toHaveBeenCalledTimes(1);
    expect(test.props.onTagUpdated).not.toHaveBeenCalled();
    expect(find(test.render(), element => element.type === 'fieldset').props.disabled).toBe(true);
    pending.resolve(true); await settle();
    expect(test.props.onTagUpdated).toHaveBeenCalledExactlyOnceWith('Science');
    expect(find(test.render(), element => element.type === 'fieldset').props.disabled).toBe(false);
  });

  it.each(['false', 'rejected'])('keeps the old label and shows a retryable error after %s rename', async result => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const test = fixture();
    if (result === 'false') test.props.onRename.mockResolvedValue(false);
    else test.props.onRename.mockRejectedValue(new Error('Storage locked'));
    test.rename(); await settle();
    expect(test.props.onTagUpdated).not.toHaveBeenCalled(); expect(test.props.onClose).not.toHaveBeenCalled();
    expect(find(test.render(), element => element.props.role === 'alert').props.children).toContain('try again');
    expect(find(test.render(), element => element.type === 'input').props.value).toBe('Science');
    warning.mockRestore();
  });

  it('keeps a failed deletion open and does not dismiss before durable completion', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const test = fixture(), pending = deferred<void>();
    test.props.onDelete.mockImplementation(() => pending.promise);
    test.click('Delete tag'); test.click('Delete');
    expect(test.props.onClose).not.toHaveBeenCalled();
    pending.reject(new Error('Disk full')); await settle();
    expect(test.props.onClose).not.toHaveBeenCalled();
    expect(find(test.render(), element => element.props.role === 'alert').props.children).toContain('try again');
    warning.mockRestore();
  });
});
