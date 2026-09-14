/** Helpers for tests that need geometry jsdom cannot compute. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gives an element a fixed bounding rectangle, as if it had been laid out. */
export function fakeRect(el: Element, rect: Rect): void {
  el.getBoundingClientRect = () => new DOMRect(rect.x, rect.y, rect.width, rect.height);
}

/** Makes `document.elementFromPoint` return the given element until restored. */
export function underPointer(el: Element | null): () => void {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => el;
  return () => {
    document.elementFromPoint = original;
  };
}

/** Dispatches a pointer event with screen coordinates and optional modifiers. */
export function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  init: { button?: number; shiftKey?: boolean; pointerId?: number } = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: init.button ?? 0,
      shiftKey: init.shiftKey ?? false,
      pointerId: init.pointerId ?? 1,
    }),
  );
}

/** Dispatches a keydown on the window, as the canvas shortcuts listen there. */
export function keydown(key: string, init: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
