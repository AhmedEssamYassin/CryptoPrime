// prime-core.js - Works in BOTH browser and Node.js
// Use: import in browser, require in Node.js
// To make symbolic link: New-Item -ItemType Junction -Path "shared" -Target "..\client\shared"

class PrimeCore {
    constructor(cryptoProvider) {
        this.cryptoProvider = cryptoProvider;
    }

    randomBigIntInRange(min, max) {
        const range = max - min;
        const bytes = Math.ceil(range.toString(2).length / 8);
        let rnd;
        do {
            const buf = this.cryptoProvider.getRandomBytes(bytes);
            rnd = BigInt('0x' + this.cryptoProvider.bufferToHex(buf));
        } while (rnd > range);
        return min + rnd;
    }

    // Function to generate random number with specific digit length
    generateRandomOddNumber(digitLength) {
        const min = 10n ** BigInt(digitLength - 1);
        const max = 10n ** BigInt(digitLength) - 1n;
        let candidate = this.randomBigIntInRange(min, max);
        // Ensure it's odd
        if (!(candidate & 1n)) {
            candidate += 1n;
        }
        return candidate;
    }

    mult64(a, b, mod) {
        return a * b % mod;
    }

    modPow(N, power, mod) {
        if (N % mod === 0n || N === 0n)
            return 0n;
        if (N === 1n || power === 0n)
            return 1n;

        let res = 1n;
        while (power) {
            if (power & 1n)
                res = this.mult64(res, N, mod);
            N = this.mult64(N, N, mod);
            power >>= 1n;
        }
        return res;
    }

    isPrime(N) {
        if (N < 2n || N % 6n % 4n !== 1n)
            return (N | 1n) === 3n;

        let d = N - 1n;
        let s = 0n;
        while (!(d & 1n))
            d >>= 1n, ++s;
        for (let a of [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n]) {
            let p = this.modPow(a % N, d, N), i = s;
            while (p !== 1n && p !== N - 1n && a % N && i--)
                p = this.mult64(p, p, N);
            if (p !== N - 1n && i !== s)
                return false;
        }
        for (let j = 0; j < 20; ++j) {
            // Generate random base
            let a = this.randomBigIntInRange(2n, N - 2n);
            let p = this.modPow(a % N, d, N), i = s;
            while (p !== 1n && p !== N - 1n && a % N && i--)
                p = this.mult64(p, p, N);
            if (p !== N - 1n && i !== s)
                return false;
        }
        return true;
    }

    async generatePrimesProgressive(digitLength, count, onPrimeFound, yieldStrategy) {
        const primesSet = new Set(); // For fast duplicate checking
        const maxAttempts = digitLength > 100 ? 500000 : 10000; // Prevent infinite loops
        let foundCount = 0;

        while (foundCount < count) {
            let attempts = 0;
            let candidate;

            do {
                candidate = this.generateRandomOddNumber(digitLength);
                if (!(candidate & 1n)) candidate += 1n; // Make odd
                attempts++;

                if (attempts > maxAttempts) {
                    throw new Error(`Could not find ${count} primes with ${digitLength} digits after ${maxAttempts} attempts`);
                }

                // Yield based on strategy
                if (yieldStrategy && yieldStrategy.shouldYield(attempts)) {
                    await yieldStrategy.yield();
                }
            } while (!this.isPrime(candidate) || primesSet.has(candidate));

            primesSet.add(candidate);
            foundCount++;

            // Call callback with found prime
            if (onPrimeFound) {
                onPrimeFound(candidate);
            }

            // Yield after each prime found
            if (yieldStrategy) {
                await yieldStrategy.yield();
            }
        }
    }

    async generatePrimes(digitLength, count, yieldStrategy) {
        const primes = [];
        await this.generatePrimesProgressive(digitLength, count, (prime) => {
            primes.push(prime);
        }, yieldStrategy);
        return primes;
    }
}

// Universal export: works with both ES modules and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    // Node.js (CommonJS)
    module.exports = { PrimeCore };
} else {
    // Browser (ES modules) - will be handled by export statement below
}

export { PrimeCore };