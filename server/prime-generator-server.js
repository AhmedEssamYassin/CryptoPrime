// uses the shared core
const { PrimeCore } = require('./shared/prime-core.js');
const { NodeCryptoProvider } = require('./shared/crypto-providers.js');
const { ServerYieldStrategy } = require('./shared/yield-strategies.js');
const crypto = require('crypto');

class PrimeGeneratorServer {
    constructor() {
        // Initialize core with Node.js crypto
        this.core = new PrimeCore(new NodeCryptoProvider(crypto));
        this.yieldStrategy = new ServerYieldStrategy();
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

    async generatePrimesProgressive(digitLength, count, onPrimeFound) {
        // Delegate to core with server yield strategy
        await this.core.generatePrimesProgressive(
            digitLength,
            count,
            onPrimeFound,
            this.yieldStrategy
        );
    }

    async generatePrimes(digitLength, count) {
        const primes = [];
        await this.generatePrimesProgressive(digitLength, count, (prime) => {
            primes.push(prime);
        });
        return primes;
    }
}

module.exports = PrimeGeneratorServer;