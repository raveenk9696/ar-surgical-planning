import { expect, it, vi } from 'vitest';
import { noteTime } from './notesList';
import { runSteps } from './steps';
it('formats the verifier date poison without throwing', () => {
  expect(noteTime(1e16)).toEqual({ text: 'Time unavailable', datetime: '' });
});
it('still updates pins and status if an earlier subscriber step throws', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const pins = vi.fn();
  const status = vi.fn();
  runSteps(() => { throw new RangeError('Invalid time value'); }, pins, status);
  expect(pins).toHaveBeenCalledOnce();
  expect(status).toHaveBeenCalledOnce();
  error.mockRestore();
});
