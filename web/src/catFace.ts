// catFace.ts — tiny flat SVG faces of the office's agent cats (same coats as the
// 3D cats in scene3d.ts): the Kiro calico, the Claude orange tabby, the Codex
// tuxedo. `worried` droops the ears (CSS animates the change).

import type { Source } from './socket.js';

const NS = 'http://www.w3.org/2000/svg';

interface Coat { fur: string; ear: string; patch?: string; patch2?: string; stripe?: string; muzzle: string; eye: string }
const COATS: Record<Source, Coat> = {
  kiro: { fur: '#f3efe9', ear: '#f3efe9', patch: '#d98a4e', patch2: '#2a2622', muzzle: '#fbf8f4', eye: '#2f4a38' },
  claude: { fur: '#e8946f', ear: '#d97757', stripe: '#d97757', muzzle: '#fbeee6', eye: '#3b2f2a' },
  codex: { fur: '#2f3237', ear: '#25282c', muzzle: '#f7f6f3', eye: '#7fd1a8' },
};

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export function catFace(source: Source, worried = false, size = 22): SVGSVGElement {
  const c = COATS[source];
  const svg = node('svg', { viewBox: '0 0 32 32', width: size, height: size, class: `cat-face${worried ? ' worried' : ''}`, 'aria-hidden': 'true' });
  const line = 'rgba(40, 30, 25, 0.28)';
  // ears pivot at their base so they can droop
  const earL = node('g', { class: 'cat-ear left' });
  earL.append(node('path', { d: 'M5 15 L7 3 L15 9 Z', fill: c.ear, stroke: line, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
  if (source === 'kiro') earL.append(node('path', { d: 'M6.6 12 L7.6 5.5 L12 9 Z', fill: c.patch! }));
  const earR = node('g', { class: 'cat-ear right' });
  earR.append(node('path', { d: 'M27 15 L25 3 L17 9 Z', fill: source === 'kiro' ? c.patch2! : c.ear, stroke: line, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
  svg.append(earL, earR);

  svg.append(node('ellipse', { cx: 16, cy: 18.5, rx: 12, ry: 10.5, fill: c.fur, stroke: line, 'stroke-width': 1 }));
  if (source === 'kiro') {
    svg.append(node('path', { d: 'M6 14 Q8 9 14 10 Q13 16 8 19 Q5.5 17.5 6 14 Z', fill: c.patch! }));
    svg.append(node('path', { d: 'M20 9.5 Q25 9.5 27 14 Q24 14.5 21.5 13 Z', fill: c.patch2! }));
  }
  if (source === 'claude') {
    for (const x of [13.5, 16, 18.5]) svg.append(node('path', { d: `M${x} 8.6 L${x} 12`, stroke: c.stripe!, 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
  }
  // muzzle (the tuxedo's is a white blaze)
  if (source === 'codex') svg.append(node('path', { d: 'M16 14 Q21.5 18 21 24 Q16 28.5 11 24 Q10.5 18 16 14 Z', fill: c.muzzle }));
  else svg.append(node('ellipse', { cx: 16, cy: 23, rx: 5, ry: 3.6, fill: c.muzzle }));

  // eyes + nose + mouth
  svg.append(node('ellipse', { class: 'cat-eye', cx: 11.5, cy: 18, rx: 1.5, ry: 1.9, fill: c.eye }));
  svg.append(node('ellipse', { class: 'cat-eye', cx: 20.5, cy: 18, rx: 1.5, ry: 1.9, fill: c.eye }));
  svg.append(node('path', { d: 'M14.8 21.4 L17.2 21.4 L16 22.7 Z', fill: '#e58f9a' }));
  svg.append(node('path', { d: 'M13.8 24 Q15 25 16 23.6 Q17 25 18.2 24', fill: 'none', stroke: 'rgba(40,30,25,0.5)', 'stroke-width': 0.9, 'stroke-linecap': 'round' }));
  return svg;
}
