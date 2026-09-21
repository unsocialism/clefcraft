import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Two taps closer together than this, in time and space, are a double tap. */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DISTANCE = 32;
/** A finger that moves further than this is scrolling, not tapping. */
const TAP_SLOP = 12;
/** How far to pull down, from the top of the sheet, to bring the controls back. */
const PULL_DISTANCE = 70;
/** Mouse wheel equivalent: this much upward scrolling while already at the top. */
const WHEEL_DISTANCE = 140;
/**
 * The sheet must have been sitting at the top this long before a wheel
 * counts as a pull. Without it, the same flick that scrolls you back up to
 * the first line would carry on and pop the controls open.
 */
const SETTLED_MS = 350;
const HINT_MS = 2600;

/** Taps on these are for the control itself, never a double tap. */
const INTERACTIVE =
  'button, a, input, select, textarea, label, summary, [role="button"], .note-popover';

export interface Immersive {
  readonly on: boolean;
  /** Briefly true after hiding, while the "how to get them back" hint shows. */
  readonly hint: boolean;
  set(on: boolean): void;
  toggle(): void;
}

/**
 * Hide the controls so only the music and the keyboard are left — for a
 * phone on the music stand, in landscape, where the controls would
 * otherwise take half the height.
 *
 * Double-tap the sheet to hide them; double-tap again, or pull down when the
 * sheet is already at its top, to bring them back. Scrolling up to reread
 * an earlier line deliberately does not: that would pop the controls in
 * every time you glanced back.
 */
export function useImmersive(
  scrollerRef: RefObject<HTMLElement | null>,
  { allowDoubleTap }: { allowDoubleTap: boolean },
): Immersive {
  const [on, setOn] = useState(false);
  const [hint, setHint] = useState(false);
  const onRef = useRef(on);
  onRef.current = on;
  const allowRef = useRef(allowDoubleTap);
  allowRef.current = allowDoubleTap;

  const set = useCallback((next: boolean) => {
    setOn(next);
    setHint(next);
  }, []);
  const toggle = useCallback(() => set(!onRef.current), [set]);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    // ---- double tap ----
    let down: { x: number; y: number; id: number } | null = null;
    let lastTap: { x: number; y: number; at: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button > 0) return;
      down = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const onPointerCancel = () => {
      down = null;
      lastTap = null;
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) {
        lastTap = null;
        return;
      }
      const target = event.target as Element | null;
      if (!allowRef.current || target?.closest(INTERACTIVE)) {
        lastTap = null;
        return;
      }
      const now = performance.now();
      if (
        lastTap &&
        now - lastTap.at < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_DISTANCE
      ) {
        lastTap = null;
        // A double-click also selects the word under it; not wanted here.
        globalThis.getSelection?.()?.removeAllRanges();
        set(!onRef.current);
        return;
      }
      lastTap = { x: event.clientX, y: event.clientY, at: now };
    };

    // ---- pull down at the top, by touch ----
    let pull: { y: number; atTop: boolean } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Only a gesture that *starts* at the top counts; one that scrolls up
      // to the top and keeps going is still reading.
      pull = touch && event.touches.length === 1 ? { y: touch.clientY, atTop: el.scrollTop <= 0 } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!onRef.current || !pull?.atTop || !touch) return;
      if (el.scrollTop > 0) {
        pull = null;
        return;
      }
      if (touch.clientY - pull.y > PULL_DISTANCE) {
        pull = null;
        set(false);
      }
    };
    const onTouchEnd = () => {
      pull = null;
    };

    // ---- the same, by mouse wheel or trackpad ----
    let atTopSince: number | null = el.scrollTop <= 0 ? performance.now() : null;
    let wheelPull = 0;
    const onScroll = () => {
      if (el.scrollTop <= 0) atTopSince ??= performance.now();
      else {
        atTopSince = null;
        wheelPull = 0;
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!onRef.current || event.deltaY >= 0 || el.scrollTop > 0) {
        wheelPull = 0;
        return;
      }
      if (atTopSince === null || performance.now() - atTopSince < SETTLED_MS) return;
      wheelPull += -event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      if (wheelPull > WHEEL_DISTANCE) {
        wheelPull = 0;
        set(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onRef.current) set(false);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [scrollerRef, set]);

  return { on, hint, set, toggle };
}
