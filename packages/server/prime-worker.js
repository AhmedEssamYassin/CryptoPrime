import { parentPort, workerData } from 'worker_threads';
import { PrimeCore } from '@cryptoprime/core/prime-core.js';
import { NodeCryptoProvider } from '@cryptoprime/core/crypto-providers.js';
import crypto from 'crypto';

const core = new PrimeCore(new NodeCryptoProvider(crypto));

async function start() {
    try {
        const { digitLength, count } = workerData;
        
        await core.generatePrimesProgressive(
            digitLength,
            count,
            (prime) => {
                parentPort.postMessage({
                    type: 'prime',
                    prime: prime.toString()
                });
            },
            null // No need to yield inside the worker thread
        );

        parentPort.postMessage({ type: 'complete' });
    } catch (error) {
        parentPort.postMessage({ type: 'error', error: error.message });
    }
}

start();
