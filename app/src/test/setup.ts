import '@testing-library/jest-dom/vitest';
import { cleanup } from '@solidjs/testing-library';
import { afterEach } from 'vitest';

/**
 * Test environment. jsdom has no layout engine and lacks a few browser APIs
 * the canvas relies on. These are deterministic stand-ins for the environment,
 * not mocks of any unit under test.
 */

// Text measurement: 7 px per character, so sizes derived from labels are predictable.
Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
  configurable: true,
  value(this: SVGElement): number {
    return (this.textContent ?? '').length * 7;
  },
});

// Pointer capture only affects event routing in real browsers; jsdom routes nothing anyway.
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.setPointerCapture ??= () => undefined;
proto.releasePointerCapture ??= () => undefined;
proto.hasPointerCapture ??= () => false;

// Hit-testing needs layout. Tests that drop an edge set this to the element they want under the pointer.
document.elementFromPoint ??= () => null;

afterEach(() => cleanup());

// jsdom has no layout, so scrollIntoView does not exist; record the calls so tests can observe them.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: boolean | ScrollIntoViewOptions) {
    this.dispatchEvent(new CustomEvent('scroll-into-view', { bubbles: true, detail: options }));
  };
}
