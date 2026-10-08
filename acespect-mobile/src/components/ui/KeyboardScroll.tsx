import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, KeyboardEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

/** Anything the keyboard can sit on top of: a text box we can measure on screen. */
interface Measurable {
  measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
}

interface ScrollIntoView {
  /** Scrolls the form just enough that this text box is not hidden behind the keyboard. */
  ensureVisible: (input: Measurable | null) => void;
}

/** Text boxes call this when focused or while they grow; outside a screen that provides it, it does nothing. */
export const ScrollIntoViewContext = createContext<ScrollIntoView>({ ensureVisible: () => undefined });

const MARGIN = 24;

/**
 * Keeps the text box being typed in visible above the keyboard, whether or not Android resizes the screen for it.
 * The screen puts `scrollRef` and `onScroll` on its ScrollView, adds a spacer of `extraBottom` at the end of the
 * content, and wraps the form in `<ScrollIntoViewContext.Provider value={value}>`.
 *
 *  - If the screen was shrunk above the keyboard (KeyboardAvoidingView / adjustResize worked), nothing extra is added.
 *  - If the keyboard is covering the bottom of the scroll area, `extraBottom` grows by exactly that much, so even the
 *    last field on the form can be scrolled up above the keyboard.
 *  - The focused text box is then scrolled to sit above the top of the keyboard.
 */
export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const offset = useRef(0);
  const target = useRef<Measurable | null>(null);
  const keyboardTop = useRef<number | null>(null);
  const [extraBottom, setExtraBottom] = useState(0);

  const run = useCallback(() => {
    const input = target.current;
    const sv = scrollRef.current as unknown as (ScrollView & Measurable) | null;
    if (!input || !sv) return;
    sv.measureInWindow((_x, sy, _w, sh) => {
      input.measureInWindow((_ix, iy, _iw, ih) => {
        // The visible area ends at the keyboard if the screen was not shrunk, otherwise at the bottom of the scroll area.
        const visibleBottom = keyboardTop.current != null ? Math.min(sy + sh, keyboardTop.current) : sy + sh;
        const hiddenBelow = iy + ih + MARGIN - visibleBottom;
        const hiddenAbove = sy + MARGIN - iy;
        if (hiddenBelow > 0) sv.scrollTo({ y: offset.current + hiddenBelow, animated: true });
        else if (hiddenAbove > 0) sv.scrollTo({ y: Math.max(0, offset.current - hiddenAbove), animated: true });
      });
    });
  }, []);

  const settle = useCallback(() => {
    const sv = scrollRef.current as unknown as (ScrollView & Measurable) | null;
    if (!sv || keyboardTop.current == null) return;
    sv.measureInWindow((_x, sy, _w, sh) => {
      const covered = sy + sh - (keyboardTop.current ?? Number.MAX_SAFE_INTEGER);
      setExtraBottom(covered > 0 ? covered + MARGIN : 0);
      setTimeout(run, 60);
    });
  }, [run]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
      const c = e.endCoordinates;
      keyboardTop.current = c.screenY && c.screenY > 0 ? c.screenY : Dimensions.get('window').height - c.height;
      // Let the screen finish moving (if it is going to) before measuring how much the keyboard still covers.
      setTimeout(settle, 150);
      setTimeout(settle, 450);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setExtraBottom(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, [settle]);

  const ensureVisible = useCallback((input: Measurable | null) => {
    target.current = input;
    setTimeout(run, 120);
    setTimeout(run, 500);
  }, [run]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const value = useMemo<ScrollIntoView>(() => ({ ensureVisible }), [ensureVisible]);
  return { scrollRef, onScroll, value, extraBottom };
}

export type { Measurable };
