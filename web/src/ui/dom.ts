export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id} in index.html`);
  return e as T;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  o: { class?: string; text?: string; attrs?: Record<string, string> } = {},
  ...children: Array<Node | null>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (o.class) e.className = o.class;
  if (o.text !== undefined) e.textContent = o.text;
  for (const [k, v] of Object.entries(o.attrs ?? {})) e.setAttribute(k, v);
  for (const c of children) if (c) e.append(c);
  return e;
}

export function setLabel(button: HTMLElement, text: string): void {
  const label = button.querySelector('.label');
  if (label) label.textContent = text;
}

export function setIcon(button: HTMLElement, icon: Element | null): void {
  button.querySelector(':scope > svg.icon')?.remove();
  if (icon) button.prepend(icon);
}
