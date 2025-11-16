// yield-strategies.js - Works in BOTH browser and Node.js

// Browser main thread - yield frequently for UI responsiveness
class BrowserYieldStrategy {
    shouldYield(attempts) {
        return attempts % 1000 === 0;
    }

    async yield() {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

// Server - yield less frequently, only for I/O
class ServerYieldStrategy {
    shouldYield(attempts) {
        return attempts % 5000 === 0;
    }

    async yield() {
        // Use setImmediate if available (Node.js), otherwise setTimeout
        if (typeof setImmediate !== 'undefined') {
            await new Promise(resolve => setImmediate(resolve));
        } else {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
}

// Worker - no yielding needed (separate thread)
class WorkerYieldStrategy {
    shouldYield() {
        return false;
    }

    async yield() {
        // No-op
    }
}

// Universal export
if (typeof module !== 'undefined' && module.exports) {
    // Node.js (CommonJS)
    module.exports = { BrowserYieldStrategy, ServerYieldStrategy, WorkerYieldStrategy };
}

export { BrowserYieldStrategy, ServerYieldStrategy, WorkerYieldStrategy };