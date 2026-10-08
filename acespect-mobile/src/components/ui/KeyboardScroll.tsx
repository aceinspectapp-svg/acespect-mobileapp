import { createContext, useCallback, useEffect, useMemo, useRef } from 'react';
import { Keyboard, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

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
 * Keeps the text box being typed in visible above the keyboard. The screen puts `scrollRef` and `onScroll` on its
 * ScrollView and wraps the form in `<ScrollIntoViewContext.Provider value={value}>`. Together with a
 * KeyboardAvoidingView (which shrinks the visible area when the keyboard opens), the form scrolls the focused box
 * into the space that is left.
 */
export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const offset = useRef(0);
  const target = useRef<Measurable | null>(null);

  const run = useCallback(() => {
    const input = target.current;
    const sv = scrollRef.current as unknown as (ScrollView & Measurable) | null;
    if (!input || !sv) return;
    sv.measureInWindow((_x, sy, _w, sh) => {
      input.measureInWindow((_ix, iy, _iw, ih) => {
        const hiddenBelow = iy + ih + MARGIN - (sy + sh);
        const hiddenAbove = sy + MARGIN - iy;
        if (hiddenBelow > 0) sv.scrollTo({ y: offset.current + hiddenBelow, animated: true });
        else if (hiddenAbove > 0) sv.scrollTo({ y: Math.max(0, offset.current - hiddenAbove), animated: true });
      });
    });
  }, []);

  // The visible area only reaches its final size once the keyboard has finished opening, so measure again then.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => setTimeout(run, 120));
    return () => sub.remove();
  }, [run]);

  const ensureVisible = useCallback((input: Measurable | null) => {
    target.current = input;
    setTimeout(run, 120);
    setTimeout(run, 400);
  }, [run]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const value = useMemo<ScrollIntoView>(() => ({ ensureVisible }), [ensureVisible]);
  return { scrollRef, onScroll, value };
}

export type { Measurable };
