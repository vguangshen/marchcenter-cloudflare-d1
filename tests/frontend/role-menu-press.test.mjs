import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoleMenuPress } from '../../src/utils/roleMenuPress.js';

function gestureHarness() {
    const pending = new Map();
    const opened = [];
    let nextId = 0;
    const gesture = createRoleMenuPress(role => opened.push(role), {
        schedule(callback, delay) {
            assert.equal(delay, 500);
            const id = ++nextId;
            pending.set(id, callback);
            return id;
        },
        cancel(id) { pending.delete(id); }
    });
    return {
        gesture, opened, pending,
        hold() {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach(callback => callback());
        }
    };
}

test('short touch taps and ordinary mouse clicks still launch the selected role', () => {
    const { gesture, opened, hold, pending } = gestureHarness();
    gesture.start('teacher', 'touch');
    gesture.cancel('touch');
    hold();
    assert.deepEqual(opened, []);
    assert.equal(gesture.consumeClick('teacher'), false);
    gesture.start('student', 'mouse');
    assert.equal(pending.size, 0);
    assert.equal(gesture.consumeClick('student'), false);
});

test('a 500ms touch hold expands its menu and consumes exactly its synthetic click', () => {
    const { gesture, opened, hold } = gestureHarness();
    gesture.start('teacher', 'touch');
    hold();
    gesture.cancel('touch');
    assert.deepEqual(opened, ['teacher']);
    assert.equal(gesture.consumeClick('student'), false);
    assert.equal(gesture.consumeClick('teacher'), true);
    assert.equal(gesture.consumeClick('teacher'), false);
});

test('pen gestures use the same long-press contract and cancelled gestures do not expand', () => {
    const { gesture, opened, hold } = gestureHarness();
    gesture.start('teacher', 'pen');
    gesture.cancel('pen');
    hold();
    assert.deepEqual(opened, []);
    gesture.start('student', 'pen');
    hold();
    assert.deepEqual(opened, ['student']);
    assert.equal(gesture.consumeClick('student'), true);
});

test('switching triggers cancels the old timer and closing/unmounting resets suppression', () => {
    const { gesture, opened, hold, pending } = gestureHarness();
    gesture.start('teacher', 'touch');
    gesture.start('student', 'touch');
    assert.equal(pending.size, 1);
    hold();
    assert.deepEqual(opened, ['student']);
    gesture.reset();
    assert.equal(gesture.consumeClick('student'), false);
    gesture.start('teacher', 'touch');
    gesture.reset();
    hold();
    assert.deepEqual(opened, ['student']);
});
