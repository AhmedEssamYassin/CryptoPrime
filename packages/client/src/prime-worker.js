import { PrimeCore } from '@cryptoprime/core/prime-core.js';
import { BrowserCryptoProvider } from '@cryptoprime/core/crypto-providers.js';
import { WorkerYieldStrategy } from '@cryptoprime/core/yield-strategies.js';

class PrimeGeneratorWorker {
    constructor() {
        this.core = new PrimeCore(new BrowserCryptoProvider());
        this.yieldStrategy = new WorkerYieldStrategy();
    }

    async generatePrimes(digitLength, count) {
        try {
            await this.core.generatePrimesProgressive(
                digitLength,
                count,
                (prime) => {
                    // Send prime back to main thread
                    self.postMessage({
                        type: 'prime',
                        prime: prime.toString()
                    });
                },
                this.yieldStrategy
            );

            // Signal completion
            self.postMessage({ type: 'complete' });
        } catch (error) {
            self.postMessage({
                type: 'error',
                error: error.message
            });
        }
    }
}

const generator = new PrimeGeneratorWorker();

// Listen for messages from main thread
self.addEventListener('message', async (e) => {
    const { type, digitLength, count } = e.data;

    if (type === 'generate') {
        await generator.generatePrimes(digitLength, count);
    }
});