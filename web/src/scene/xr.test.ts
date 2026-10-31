import { expect, it, vi } from 'vitest';
import { referenceSpaceType } from './xr';

it('requests local-floor when available', async () => {
  const requestReferenceSpace = vi.fn().mockResolvedValue({});
  expect(await referenceSpaceType({ requestReferenceSpace })).toBe('local-floor');
  expect(requestReferenceSpace).toHaveBeenCalledWith('local-floor');
});

it('falls back to local when local-floor is unavailable', async () => {
  const requestReferenceSpace = vi.fn().mockRejectedValueOnce(new Error('NotSupportedError')).mockResolvedValueOnce({});
  expect(await referenceSpaceType({ requestReferenceSpace })).toBe('local');
  expect(requestReferenceSpace.mock.calls).toEqual([['local-floor'], ['local']]);
});

it('reports failure if neither placement reference space is available', async () => {
  const requestReferenceSpace = vi.fn().mockRejectedValue(new Error('NotSupportedError'));
  await expect(referenceSpaceType({ requestReferenceSpace })).rejects.toThrow('NotSupportedError');
});
