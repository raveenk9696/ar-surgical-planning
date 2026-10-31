const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  plus: ['M12 5v14', 'M5 12h14'],
  reset: ['M4 12a8 8 0 1 0 2.6-5.9', 'M4 4v5h5'],
  cube: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M12 12l8-4.5', 'M12 12v9', 'M12 12L4 7.5'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  spinner: ['M12 3a9 9 0 1 0 9 9'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  move: ['M12 3v18', 'M3 12h18', 'M9 6l3-3 3 3', 'M9 18l3 3 3-3', 'M6 9l-3 3 3 3', 'M18 9l3 3-3 3'],
  size: ['M4 14v6h6', 'M20 10V4h-6', 'M4 20l7-7', 'M20 4l-7 7'],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', name === 'spinner' ? 'icon spin' : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
