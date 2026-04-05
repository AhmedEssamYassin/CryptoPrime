import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class PrimeGeneratorServer {
    async generatePrimesProgressive(digitLength, count, onPrimeFound) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(path.join(__dirname, 'prime-worker.js'), {
                workerData: { digitLength, count }
            });

            worker.on('message', (msg) => {
                if (msg.type === 'prime') {
                    if (onPrimeFound) onPrimeFound(msg.prime);
                } else if (msg.type === 'complete') {
                    resolve();
                } else if (msg.type === 'error') {
                    reject(new Error(msg.error));
                }
            });

            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }

    async generatePrimes(digitLength, count) {
        const primes = [];
        await this.generatePrimesProgressive(digitLength, count, (prime) => {
            primes.push(prime);
        });
        return primes;
    }
}
