// A held role trigger expands its extra entries instead of launching a login.
// Keep that decision separate from React so cancelled gestures and the browser's
// synthetic click after a long press follow the same path on touch and pen.
export function createRoleMenuPress(onLongPress, {
    schedule = setTimeout,
    cancel = clearTimeout,
    delay = 500
} = {}) {
    let timer = null;
    let activeRole = null;
    let held = false;

    const cancelPending = () => {
        if (timer !== null) cancel(timer);
        timer = null;
    };

    return {
        start(role, pointerType) {
            if (pointerType === 'mouse') return;
            cancelPending();
            activeRole = role;
            held = false;
            timer = schedule(() => {
                timer = null;
                held = true;
                onLongPress(role);
            }, delay);
        },
        cancel(pointerType) {
            if (pointerType !== 'mouse') cancelPending();
        },
        consumeClick(role) {
            if (!held || activeRole !== role) return false;
            held = false;
            activeRole = null;
            return true;
        },
        reset() {
            cancelPending();
            activeRole = null;
            held = false;
        }
    };
}
