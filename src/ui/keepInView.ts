/**
 * Scroll an element into view only if it is not already comfortably
 * visible, and centre it when it has to move.
 *
 * `scrollIntoView({ block: 'nearest' })` would park the element at the very
 * edge of the screen, so every new note would drag the page one line at a
 * time; centring on every note would keep the page in constant motion.
 * Moving only when the note nears an edge, and then far enough to show what
 * comes next, is how a page turner would do it.
 */
export function keepInView(element: Element | null | undefined, margin = 48): void {
  if (!element) return;
  const scroller = element.closest('.app__main') ?? document.scrollingElement;
  if (!scroller) return;
  const box = element.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const outside =
    box.top < view.top + margin ||
    box.bottom > view.bottom - margin ||
    box.left < view.left ||
    box.right > view.right;
  if (outside) element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}
