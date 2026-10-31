import pages from '../../.github/workflows/pages.yml?raw';
import ci from '../../.github/workflows/ci.yml?raw';
import { expect, it } from 'vitest';

it('installs a pinned and checksum-verified gitleaks before the publish check', () => {
  const job = pages.slice(pages.indexOf('  publish-check:'), pages.indexOf('  deploy:'));
  expect(job).toMatch(/gitleaks.*8\.30\.1/);
  expect(job).toMatch(/[a-f0-9]{64}/);
  expect(job.indexOf('sha256sum --check')).toBeGreaterThan(0);
  expect(job.indexOf('install -m 755')).toBeLessThan(job.indexOf('python tools/publish_check.py'));
});

it('runs Python 3.12 pipeline tests and the web suite on pushes and pull requests', () => {
  expect(ci).toMatch(/push:/);
  expect(ci).toMatch(/pull_request:/);
  expect(ci).toMatch(/python-version: '3\.12'/);
  expect(ci).toContain('pytest -q pipeline/tests pipeline-lite');
  expect(ci).toContain('npm ci && npm test && npm run build');
  expect(ci).toContain('working-directory: web');
});
