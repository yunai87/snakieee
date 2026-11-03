// tslint:disable
/* eslint-disable */
/**
 * @fileoverview Android TV / Google TV remote helpers for Playground games.
 *
 * Part of the 2D game template (copied to the game root). Import only in
 * TV-compatible games: `import {...} from './tv';`
 *
 * Conventions:
 * - Give every focus target a stable `data-tv-id` (for example
 *   `data-tv-id="start-howto"`). Focus restore uses this id, so it works when
 *   React re-mounts the element.
 * - Put `data-tv-scope` on the root element of each modal. The focus rover
 *   uses the last visible scope in DOM order, so render modals after screens.
 * - An element key handler that consumes an Arrow key must call
 *   `e.preventDefault()`. The rover then ignores that key.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const BACK_KEYS = ['Escape', 'Back', 'BrowserBack', 'GoBack'];
const OK_KEYS = ['Enter', 'Select', 'Go', 'Ok', ' '];

/** True for the remote Back key (the TV host sends it as `Escape`). */
export function isBackKey(e: KeyboardEvent): boolean {
  return BACK_KEYS.includes(e.key) || e.keyCode === 27;
}

/** True for the remote OK / center key. */
export function isOkKey(e: KeyboardEvent): boolean {
  return OK_KEYS.includes(e.key) || e.keyCode === 13;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return (
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    !el.closest('[inert]')
  );
}

function canScroll(el: HTMLElement, direction: 1 | -1): boolean {
  return direction > 0
    ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
    : el.scrollTop > 1;
}

/** Visible focus targets in the topmost `data-tv-scope`, else in the page. */
export function getTvFocusables(): HTMLElement[] {
  const scopes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-tv-scope]'),
  ).filter(isVisible);
  const root = scopes.length ? scopes[scopes.length - 1] : document.body;
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [data-tv-focusable]',
    ),
  ).filter(isVisible);
}

// Short focus lock set by `useTvModalStack.close()` (opener) and
// `TvScrollArea` (on mount). While it is active, `focusTvId` ignores other
// targets, so a game's own autofocus effect cannot override the helper. The
// next key press clears it.
let focusLock: {
  id?: string | null;
  el?: HTMLElement | null;
  until: number;
} | null = null;

function setFocusLock(target: {
  id?: string | null;
  el?: HTMLElement | null;
}): void {
  if (!focusLock) {
    window.addEventListener('keydown', () => (focusLock = null), {
      capture: true,
      once: true,
    });
  }
  focusLock = {...target, until: performance.now() + 500};
}

function isLockedOut(id: string, el: HTMLElement): boolean {
  if (!focusLock) return false;
  if (performance.now() > focusLock.until) {
    focusLock = null;
    return false;
  }
  return focusLock.el ? focusLock.el !== el : focusLock.id !== id;
}

/**
 * Focuses the element with `data-tv-id={id}`. Retries for a few frames so the
 * element can re-mount after a state change.
 */
export function focusTvId(id: string | null | undefined, frames = 8): void {
  if (!id) return;
  const attempt = (left: number) => {
    const el = document.querySelector<HTMLElement>(
      `[data-tv-id="${CSS.escape(id)}"]`,
    );
    if (el && isLockedOut(id, el)) return;
    if (el && isVisible(el)) {
      el.focus();
      return;
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(frames);
}

/** `window` with the TV host interop property. */
interface TvWindow extends Window {
  canHandleBackKey?: boolean;
}

/**
 * Tells the TV host whether the game handles the Back key. Set it to `true`
 * everywhere except the START screen with no modal open.
 */
export function useTvBackHandshake(canHandleBack: boolean): void {
  useEffect(() => {
    (window as TvWindow).canHandleBackKey = canHandleBack;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {type: 'PLAYGROUND_CAN_HANDLE_BACK_KEY', value: canHandleBack},
        '*',
      );
    }
  }, [canHandleBack]);
}

/**
 * Calls `onBack` for each remote Back press. If `onBack` returns true, the
 * event is consumed (`preventDefault`). Return false only on the START screen
 * with no modal open, so the TV host can exit the game.
 */
export function useTvBackKey(onBack: () => boolean): void {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isBackKey(e) && handlerRef.current()) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Window `keydown` listener that always calls the latest `handler`, so the
 * handler never reads stale React state. Use it for every custom key handler.
 */
export function useTvKeyDown(
  handler: (e: KeyboardEvent) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** Remote actions for {@link useTvGameInput}. */
export type TvAction = 'left' | 'right' | 'up' | 'down' | 'ok';

/** Gameplay input from {@link useTvGameInput}. */
export interface TvGameInput {
  /** True while the key is held (movement). */
  readonly isDown: (action: TvAction) => boolean;
  /**
   * True once per press, even if the press started and ended between two
   * frames (jump, fire, select). Clears the press.
   */
  readonly consumePress: (action: TvAction) => boolean;
}

function toTvAction(e: KeyboardEvent): TvAction | null {
  switch (e.key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return isOkKey(e) ? 'ok' : null;
  }
}

/**
 * Gameplay input for the game loop. Read `isDown` for held movement and
 * `consumePress` for one-shot actions. Calls `preventDefault()` on Arrow keys
 * only while `enabled` (during `PLAYING`).
 */
export function useTvGameInput(enabled: boolean): TvGameInput {
  const downRef = useRef(new Set<TvAction>());
  const pendingRef = useRef(new Map<TvAction, number>());

  useEffect(() => {
    downRef.current.clear();
    pendingRef.current.clear();
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const action = toTvAction(e);
      if (!action) return;
      if (ARROW_KEYS.includes(e.key)) e.preventDefault();
      if (!e.repeat) {
        pendingRef.current.set(
          action,
          (pendingRef.current.get(action) ?? 0) + 1,
        );
      }
      downRef.current.add(action);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const action = toTvAction(e);
      if (action) downRef.current.delete(action);
    };
    const onBlur = () => {
      downRef.current.clear();
      pendingRef.current.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);

  const input = useRef<TvGameInput>({
    isDown: (action) => downRef.current.has(action),
    consumePress: (action) => {
      const count = pendingRef.current.get(action) ?? 0;
      if (count > 0) pendingRef.current.set(action, count - 1);
      return count > 0;
    },
  });
  return input.current;
}

/** A modal in the LIFO stack. */
export interface TvModalEntry<T extends string> {
  readonly id: T;
  readonly openerTvId: string | null;
}

/** LIFO modal stack with focus restore to the opener `data-tv-id`. */
export interface TvModalStack<T extends string> {
  /** Opens a modal and saves the focused element's `data-tv-id`. */
  readonly open: (id: T) => void;
  /** Closes the topmost modal and refocuses its opener. False if empty. */
  readonly close: () => boolean;
  /** Closes all modals without moving focus. */
  readonly clear: () => void;
  readonly isOpen: (id: T) => boolean;
  readonly top: T | null;
  readonly anyOpen: boolean;
}

/**
 * LIFO modal stack. `close()` restores focus by `data-tv-id`, so focus
 * returns to the opener even if React removed and re-created it.
 */
export function useTvModalStack<T extends string>(): TvModalStack<T> {
  const stackRef = useRef<Array<TvModalEntry<T>>>([]);
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  const open = useCallback((id: T) => {
    const openerTvId =
      document.activeElement?.getAttribute('data-tv-id') ?? null;
    stackRef.current = [...stackRef.current, {id, openerTvId}];
    rerender();
  }, []);

  const close = useCallback(() => {
    const stack = stackRef.current;
    if (!stack.length) return false;
    const top = stack[stack.length - 1];
    stackRef.current = stack.slice(0, -1);
    rerender();
    focusLock = null;
    focusTvId(top.openerTvId);
    if (top.openerTvId) setFocusLock({id: top.openerTvId});
    return true;
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    rerender();
  }, []);

  const stack = stackRef.current;
  return {
    open,
    close,
    clear,
    isOpen: (id: T) => stack.some((m) => m.id === id),
    top: stack.length ? stack[stack.length - 1].id : null,
    anyOpen: stack.length > 0,
  };
}

/**
 * Moves focus between visible focus targets with all four Arrow keys. The TV
 * WebView does not move focus between buttons natively. Enable it in menus
 * and modals; disable it during active gameplay.
 */
export function useTvFocusRover(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !ARROW_KEYS.includes(e.key)) return;
      const items = getTvFocusables();
      if (!items.length) return;
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const next =
        index < 0
          ? items[0]
          : items[(index + step + items.length) % items.length];
      e.preventDefault();
      next.focus();
      next.scrollIntoView({block: 'nearest'});
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * Refocuses the primary target when focus is outside the current focus
 * targets (on `<body>`, on the canvas, or behind a modal) while a menu is
 * visible. Runs on keydown (capture phase), window focus, and visibility
 * change.
 */
export function useTvFocusWatchdog(
  enabled: boolean,
  primaryTvId?: string,
): void {
  useEffect(() => {
    if (!enabled) return;
    // Recovers when focus is outside the current focus targets: on <body>, on
    // the gameplay canvas after PLAYING ends, or behind an open modal scope.
    // Respects the focus lock and focuses only inside the active scope.
    const recover = (): boolean => {
      const items = getTvFocusables();
      if (!items.length) return false;
      const active = document.activeElement;
      if (active instanceof HTMLElement && items.includes(active)) return false;
      if (primaryTvId) {
        const primary = items.find(
          (el) => el.getAttribute('data-tv-id') === primaryTvId,
        );
        if (primary && !isLockedOut(primaryTvId, primary)) {
          primary.focus();
          return true;
        }
      }
      if (isLockedOut('', items[0])) return false;
      items[0].focus();
      return true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (recover() && ARROW_KEYS.includes(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', recover);
    const timer = window.setTimeout(recover, 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', recover);
      window.clearTimeout(timer);
    };
  }, [enabled, primaryTvId]);
}

/**
 * Resumes a suspended custom AudioContext on remote key presses. TV remotes
 * fire no `click` or `pointerdown`. `gameAudio` from `./helper` already does
 * this; use this hook only for other AudioContexts.
 */
export function useTvAudioUnlock(
  getContext: () => AudioContext | null | undefined,
): void {
  const getRef = useRef(getContext);
  getRef.current = getContext;
  useEffect(() => {
    const onKeyDown = () => {
      const ctx = getRef.current();
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}

/** Props for {@link TvScrollArea}. */
export interface TvScrollAreaProps {
  readonly children: React.ReactNode;
  /** CSS max-height, for example `'50vh'`. */
  readonly maxHeight?: string;
  readonly className?: string;
  /** Focus the area when it mounts (default true). */
  readonly autoFocus?: boolean;
  readonly tvId?: string;
}

/**
 * Focusable text area that scrolls with ArrowUp / ArrowDown and shows ▲ / ▼
 * cues. At the top or bottom edge, the Arrow key goes to the focus rover, so
 * the user can reach the Close button. Do not put it inside another
 * scrollable container.
 */
export function TvScrollArea({
  children,
  maxHeight = '50vh',
  className = '',
  autoFocus = true,
  tvId,
}: TvScrollAreaProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [cues, setCues] = useState({up: false, down: false});

  const updateCues = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCues({up: canScroll(el, -1), down: canScroll(el, 1)});
  }, []);

  useEffect(() => {
    updateCues();
    if (autoFocus && ref.current) {
      ref.current.focus();
      setFocusLock({el: ref.current});
    }
  }, [autoFocus, updateCues]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!direction) return;
    const el = e.currentTarget;
    if (canScroll(el, direction)) {
      e.preventDefault();
      el.scrollBy({top: direction * el.clientHeight * 0.6});
    }
  };

  return (
    <div className="relative w-full">
      <div aria-hidden className="h-6 text-center text-lg leading-6">
        {cues.up ? '▲' : ''}
      </div>
      <div
        ref={ref}
        tabIndex={0}
        role="document"
        data-tv-focusable=""
        data-tv-id={tvId}
        onKeyDown={onKeyDown}
        onScroll={updateCues}
        className={`overflow-y-auto focus:outline-none focus:ring-4 focus:ring-yellow-400 ${className}`}
        style={{maxHeight}}>
        {children}
      </div>
      <div aria-hidden className="h-6 text-center text-lg leading-6">
        {cues.down ? '▼' : ''}
      </div>
    </div>
  );
}
