import { act } from 'react';
import { createRoot } from 'react-dom/client';
const mounted = [];
export function render(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(element));
  return { container };
}
export function cleanup() {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
}
function find(selector, value, optional = false) {
  const found = [...document.querySelectorAll(selector)].find(el => selector === '[data-testid]' ? el.getAttribute('data-testid') === value : el.textContent === value);
  if (!found && !optional) throw new Error(`Missing element ${value}`);
  return found || null;
}
export const screen = {
  getByText: text => { const elements = [...document.querySelectorAll('a,span')].filter(el => el.textContent === text); return elements[elements.length - 1] || find('a,span', text); },
  getByTestId: id => find('[data-testid]', id),
  queryByTestId: id => find('[data-testid]', id, true)
};
export const fireEvent = { click: element => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))) };
