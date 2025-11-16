import { PrimeGenerator } from './prime-generator.js';
import { PrimeServerAPI } from './prime-server-api.js';

export class PrimeClient {
    constructor(config = {}) {
        this.mode = config.mode || 'auto'; // 'auto', 'worker', 'mainthread', 'server'
        this.serverUrl = config.serverUrl || '/api/primes';

        // Initialize generators
        this.workerGenerator = new PrimeGenerator(true);
        this.mainThreadGenerator = new PrimeGenerator(false);
        this.serverAPI = new PrimeServerAPI(this.serverUrl);
    }

    async generatePrimesProgressive(digitLength, count, onPrimeFound) {
        const mode = this.selectMode(digitLength, count);

        switch (mode) {
            case 'server':
                console.log('generating primes on server');
                return this.generateViaServer(digitLength, count, onPrimeFound);

            case 'worker':
                console.log('generating primes on worker');
                return this.generateViaWorker(digitLength, count, onPrimeFound);

            case 'mainthread':
            default:
                console.log('generating primes on main thread');
                return this.generateViaMainThread(digitLength, count, onPrimeFound);
        }
    }

    selectMode(digitLength, count) {
        // Return explicit mode if set
        if (this.mode !== 'auto') {
            return this.mode;
        }

        // Auto-select based on complexity
        const complexity = digitLength * count;

        // For very large jobs, prefer server if available
        if (complexity > 1000) {
            return 'server';
        }

        // For medium jobs, prefer worker
        if (complexity > 200 && typeof Worker !== 'undefined') {
            return 'worker';
        }

        // For small jobs, main thread is fine
        return 'mainthread';
    }

    async generateViaServer(digitLength, count, onPrimeFound) {
        try {
            await this.serverAPI.generatePrimesProgressive(digitLength, count, onPrimeFound);
        } catch (error) {
            console.warn('Server generation failed, falling back to worker:', error);
            // Fallback to worker
            await this.generateViaWorker(digitLength, count, onPrimeFound);
        }
    }

    async generateViaWorker(digitLength, count, onPrimeFound) {
        try {
            await this.workerGenerator.generatePrimesProgressive(digitLength, count, onPrimeFound);
        } catch (error) {
            console.warn('Worker generation failed, falling back to main thread:', error);
            // Fallback to main thread
            await this.generateViaMainThread(digitLength, count, onPrimeFound);
        }
    }

    async generateViaMainThread(digitLength, count, onPrimeFound) {
        await this.mainThreadGenerator.generatePrimesProgressive(digitLength, count, onPrimeFound);
    }

    async generatePrimes(digitLength, count) {
        const primes = [];
        await this.generatePrimesProgressive(digitLength, count, (prime) => {
            primes.push(prime);
        });
        return primes;
    }

    cleanup() {
        this.workerGenerator.terminateWorker();
    }
}