const NOTIFY_EVENT = 'marchcenter:notify';
const CONFIRM_EVENT = 'marchcenter:confirm';

export const notify = (message, type = 'info') => {
    window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, {
        detail: { message: String(message || ''), type }
    }));
};

export const confirmAction = (options) => new Promise((resolve) => {
    const detail = typeof options === 'string'
        ? { message: options }
        : { ...(options || {}) };
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, {
        detail: { ...detail, resolve }
    }));
});

export const feedbackEvents = Object.freeze({
    notify: NOTIFY_EVENT,
    confirm: CONFIRM_EVENT
});
