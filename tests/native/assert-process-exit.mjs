import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

// SIGKILL and pipe closure need not coincide with the OS reaping the descendant.
// Observe actual exit with a bounded deadline rather than assuming instant ESRCH.
export async function assertProcessExited(pid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    assert.ok(Date.now() < deadline, 'Test descendant still exists after cancellation grace');
    await setTimeout(10);
  }
}
