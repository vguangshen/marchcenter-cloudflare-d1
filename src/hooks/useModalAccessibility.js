import { useEffect, useRef } from 'react';

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
    'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

export function useModalAccessibility(isOpen, onClose, { initialFocusRef } = {}) {
    const dialogRef = useRef(null);
    const triggerRef = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (!isOpen) return undefined;
        triggerRef.current = document.activeElement;
        const dialog = dialogRef.current;
        const frame = window.requestAnimationFrame(() => {
            const target = initialFocusRef?.current || dialog?.querySelector(FOCUSABLE) || dialog;
            target?.focus?.();
        });

        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current?.();
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;
            const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter(element => (
                !element.hasAttribute('disabled') && element.getClientRects().length > 0
            ));
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            triggerRef.current?.focus?.();
        };
    }, [initialFocusRef, isOpen]);

    return dialogRef;
}
