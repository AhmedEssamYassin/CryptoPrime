import { PrimeCore } from '@cryptoprime/core/prime-core.js';
import { BrowserCryptoProvider } from '@cryptoprime/core/crypto-providers.js';
import { BrowserYieldStrategy } from '@cryptoprime/core/yield-strategies.js';

export class PrimeGenerator {
    constructor(useWorker = true) {
        this.useWorker = useWorker;
        this.worker = null;
        this.workerBusy = false;

        this.core = new PrimeCore(new BrowserCryptoProvider());
        this.yieldStrategy = new BrowserYieldStrategy();
    }

    async initWorker() {
        if (!this.worker && this.useWorker && typeof Worker !== 'undefined') {
            // Create worker from separate file or inline
            // Vite can serve files from root and `public` folder
            this.worker = new Worker(
                new URL('./prime-worker.js', import.meta.url),
                { type: 'module' }
            );
        }
    }

    terminateWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.workerBusy = false;
        }
    }

    // Public API pass-through — useful for direct primality checks in tests
    isPrime(N) {
        return this.core.isPrime(N);
    }

    async generatePrimesProgressive(digitLength, count, onPrimeFound) {
        // Use worker if available and not busy
        if (this.useWorker && !this.workerBusy) {
            await this.initWorker();
            if (this.worker) {
                return this.generatePrimesProgressiveWorker(digitLength, count, onPrimeFound);
            }
        }

        // Fallback to main thread
        return this.generatePrimesProgressiveMainThread(digitLength, count, onPrimeFound);
    }

    async generatePrimesProgressiveWorker(digitLength, count, onPrimeFound) {
        this.workerBusy = true;

        return new Promise((resolve, reject) => {
            const messageHandler = (e) => {
                const { type, prime, error } = e.data;

                if (type === 'prime') {
                    if (onPrimeFound) {
                        onPrimeFound(BigInt(prime));
                    }
                } else if (type === 'complete') {
                    this.worker.removeEventListener('message', messageHandler);
                    this.workerBusy = false;
                    resolve();
                } else if (type === 'error') {
                    this.worker.removeEventListener('message', messageHandler);
                    this.workerBusy = false;
                    reject(new Error(error));
                }
            };

            this.worker.addEventListener('message', messageHandler);

            this.worker.postMessage({
                type: 'generate',
                digitLength,
                count
            });
        });
    }

    async generatePrimesProgressiveMainThread(digitLength, count, onPrimeFound) {
        // Delegate to core with browser yield strategy
        await this.core.generatePrimesProgressive(
            digitLength,
            count,
            onPrimeFound,
            this.yieldStrategy
        );
    }

    // Legacy function for backward compatibility
    async generatePrimes(digitLength, count) {
        const primes = [];
        await this.generatePrimesProgressive(digitLength, count, (prime) => {
            primes.push(prime);
        });
        return primes;
    }
}