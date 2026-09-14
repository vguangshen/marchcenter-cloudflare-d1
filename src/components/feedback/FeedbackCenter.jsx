import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { feedbackEvents } from '../../utils/uiFeedback';

const ICONS = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info
};

export default function FeedbackCenter() {
    const [toasts, setToasts] = useState([]);
    const [confirmation, setConfirmation] = useState(null);
    const confirmationRef = useRef(null);
    const confirmationDialogRef = useRef(null);
    const confirmationTriggerRef = useRef(null);

    useEffect(() => {
        const handleNotify = (event) => {
            const id = `${Date.now()}-${Math.random()}`;
            const toast = {
                id,
                type: ICONS[event.detail?.type] ? event.detail.type : 'info',
                message: event.detail?.message || ''
            };
            setToasts((current) => [...current.slice(-3), toast]);
            window.setTimeout(() => {
                setToasts((current) => current.filter((item) => item.id !== id));
            }, 3600);
        };
        const handleConfirm = (event) => {
            if (confirmationRef.current?.resolve) confirmationRef.current.resolve(false);
            confirmationRef.current = event.detail;
            setConfirmation(event.detail);
        };
        window.addEventListener(feedbackEvents.notify, handleNotify);
        window.addEventListener(feedbackEvents.confirm, handleConfirm);
        return () => {
            window.removeEventListener(feedbackEvents.notify, handleNotify);
            window.removeEventListener(feedbackEvents.confirm, handleConfirm);
            if (confirmationRef.current?.resolve) confirmationRef.current.resolve(false);
        };
    }, []);

    useEffect(() => {
        if (!confirmation) return undefined;
        confirmationTriggerRef.current = document.activeElement;
        const dialog = confirmationDialogRef.current;
        const frame = window.requestAnimationFrame(() => dialog?.querySelector('button')?.focus());
        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeConfirmation(false);
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;
            const buttons = [...dialog.querySelectorAll('button:not([disabled])')];
            if (!buttons.length) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
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
            confirmationTriggerRef.current?.focus?.();
        };
    }, [confirmation]);

    const closeConfirmation = (accepted) => {
        confirmationRef.current?.resolve?.(accepted);
        confirmationRef.current = null;
        setConfirmation(null);
    };

    return (
        <>
            <div className="feedback-toast-stack" aria-live="polite" aria-atomic="false">
                {toasts.map((toast) => {
                    const Icon = ICONS[toast.type];
                    return (
                        <div key={toast.id} className={`feedback-toast feedback-toast--${toast.type}`} role="status">
                            <Icon />
                            <span>{toast.message}</span>
                            <button
                                type="button"
                                aria-label="关闭提示"
                                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                            >
                                <X />
                            </button>
                        </div>
                    );
                })}
            </div>

            {confirmation && (
                <div className="feedback-confirm-backdrop" role="presentation" onMouseDown={() => closeConfirmation(false)}>
                    <section
                        ref={confirmationDialogRef}
                        className="feedback-confirm-card"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="feedback-confirm-title"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <span className="feedback-confirm-icon"><AlertTriangle /></span>
                        <div>
                            <h2 id="feedback-confirm-title">{confirmation.title || '请确认操作'}</h2>
                            <p>{confirmation.message || '确定继续吗？'}</p>
                        </div>
                        <div className="feedback-confirm-actions">
                            <button type="button" onClick={() => closeConfirmation(false)}>
                                {confirmation.cancelText || '取消'}
                            </button>
                            <button
                                type="button"
                                className={confirmation.danger === false ? 'primary' : 'danger'}
                                onClick={() => closeConfirmation(true)}
                                autoFocus
                            >
                                {confirmation.confirmText || '确认'}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}
