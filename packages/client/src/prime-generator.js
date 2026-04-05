// uses the shared core
import { PrimeCore } from '../shared/prime-core.js';
import { BrowserCryptoProvider } from '../shared/crypto-providers.js';
import { BrowserYieldStrategy } from '../shared/yield-strategies.js';

export class PrimeGenerator {
    constructor(useWorker = true) {
        this.useWorker = useWorker;
        this.worker = null;
        this.workerBusy = false;

        // Initialize core with browser crypto
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

    // Expose core methods for direct access if needed
    randomBigIntInRange(min, max) {
        return this.core.randomBigIntInRange(min, max);
    }

    generateRandomOddNumber(digitLength) {
        return this.core.generateRandomOddNumber(digitLength);
    }

    mult64(a, b, mod) {
        return this.core.mult64(a, b, mod);
    }

    modPow(N, power, mod) {
        return this.core.modPow(N, power, mod);
    }

    isPrime(N) {
        return this.core.isPrime(N);
    }

    // Function to generate primes with progressive callback
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
                    // Call callback with found prime
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

            // Send generation request to worker
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