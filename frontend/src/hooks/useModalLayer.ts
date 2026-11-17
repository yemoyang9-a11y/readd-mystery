import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const layers: symbol[] = [];
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

/** NFR-USE: 가장 위 확인 창만 키보드를 처리하고 닫힐 때 원래 초점을 복원한다. */
export function useModalLayer({
  active,
  dialogRef,
  returnFocusRef,
  initialFocusRef,
  onClose,
}: {
  active: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  returnFocusRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = returnFocusRef.current;
    const layer = Symbol('modal');
    layers.push(layer);
    (initialFocusRef?.current ?? dialog).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (layers[layers.length - 1] !== layer) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.tabIndex >= 0 && !el.matches(':disabled') &&
          !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
          getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (!focusable.includes(current as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const wasTop = layers[layers.length - 1] === layer;
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      if (wasTop && returnFocus?.isConnected) returnFocus.focus();
    };
  }, [active, dialogRef, returnFocusRef, initialFocusRef]);
}
