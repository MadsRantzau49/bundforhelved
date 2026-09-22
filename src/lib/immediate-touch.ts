import type { MouseEvent, MutableRefObject, PointerEvent, TouchEvent } from "react";

const compatibilityEventWindowMs = 1_000;

export function activateOnTouchPointer(event: PointerEvent<HTMLElement>, guard: MutableRefObject<number>, action: () => void) {
  if (!event.isPrimary || event.button !== 0 || event.pointerType === "mouse") return;
  event.preventDefault();
  guard.current = Date.now();
  action();
}

export function activateOnTouchStart(event: TouchEvent<HTMLElement>, guard: MutableRefObject<number>, action: () => void) {
  event.preventDefault();
  const now = Date.now();
  if (now - guard.current < compatibilityEventWindowMs) return;
  guard.current = now;
  action();
}

export function activateOnClick(event: MouseEvent<HTMLElement>, guard: MutableRefObject<number>, action: () => void) {
  if (event.detail !== 0 && Date.now() - guard.current < compatibilityEventWindowMs) {
    event.preventDefault();
    return;
  }
  action();
}
