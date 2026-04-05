// Works in BOTH browser and Node.js

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

    generateRandomOddNumber(digitLength) {
        const min = 10n ** BigInt(digitLength - 1);
        const max = 10n ** BigInt(digitLength) - 1n;
        let candidate = this.randomBigIntInRange(min, max);
        if (!(candidate & 1n)) candidate += 1n;
        return candidate;
    }

    modMult(a, b, mod) {
        return a * b % mod;
    }

    bitWidth(n) {
        return BigInt(n.toString(2).length);
    }

    /**
     * Build a reusable Montgomery reduction context for a given odd modulus.
     * Precomputes k, R, Nprime, and R² exactly once so they can be shared
     * across every modular multiplication for the same modulus.
     *
     * Key identity: all of add(a, b), sub(a, b), div2(a) commute with the
     * Montgomery representation, so intermediate values can stay in the
     * Montgomery domain throughout multi-step algorithms (Miller-Rabin,
     * Lucas sequences) without extra toMont/fromMont round-trips.
     */
    buildMontContext(mod) {
        const k = this.bitWidth(mod);
        const R = 1n << k;
        const Rmask = R - 1n;

        // Hensel's lemma: compute mod^{-1} mod R via Newton iterations
        let inv = 1n;
        for (let i = 1; i < k; i <<= 1)
            inv = (inv * (2n - mod * inv)) & Rmask;
        const Nprime = (R - inv) & Rmask;

        // R² under modulo — used to enter the Montgomery domain
        const R2 = (R * R) % mod;

        // Core Montgomery multiplication: returns (a * b * R⁻¹) under modulo
        const montMult = (a, b) => {
            const t = a * b;
            const m = (t * Nprime) & Rmask;
            let u = (t + m * mod) >> k;
            if (u >= mod) u -= mod;
            return u;
        };

        // Convert x from regular domain → Montgomery domain  (x * R under modulo)
        const toMont = (x) => montMult(x % mod, R2);

        // Convert x from Montgomery domain → regular domain  (x * R⁻¹ under modulo)
        const fromMont = (x) => montMult(x, 1n);

        return { mod, k, R, Rmask, Nprime, R2, montMult, toMont, fromMont };
    }

    /**
     * Internal: compute N^power, returning the result in Montgomery domain.
     * Callers that need to continue multiplying with the same modulus can skip
     * the fromMont call and pass the result straight into montMult.
     */
    _modPowMont(N, power, ctx) {
        let res = ctx.toMont(1n);
        let base = ctx.toMont(N % ctx.mod);
        while (power) {
            if (power & 1n) res = ctx.montMult(res, base);
            base = ctx.montMult(base, base);
            power >>= 1n;
        }
        return res;
    }

    /**
     * Public modular exponentiation.
     * Accepts an optional pre-built MontgomeryContext; when omitted one is
     * built internally.  Pass the shared context from isPrime() to avoid
     * redundant precomputation across multiple calls on the same modulus.
     */
    modPow(N, power, mod, ctx = null) {
        if (N % mod === 0n || N === 0n) return 0n;
        if (N === 1n || power === 0n) return 1n;

        if (mod % 2n === 0n) {
            // Montgomery requires an odd modulus; fall back to naive binary exp
            let res = 1n;
            while (power) {
                if (power & 1n) res = this.modMult(res, N, mod);
                N = this.modMult(N, N, mod);
                power >>= 1n;
            }
            return res;
        }

        const c = ctx ?? this.buildMontContext(mod);
        return c.fromMont(this._modPowMont(N, power, c));
    }

    iSqrt(n) {
        if (n < 2n) return n;
        let xk = 1n << ((this.bitWidth(n) + 1n) >> 1n);
        let nxt = (xk + n / xk) >> 1n;
        while (nxt < xk) {
            xk = nxt;
            nxt = (xk + n / xk) >> 1n;
        }
        return xk;
    }

    isPerfectSquare(n) {
        if (n === 0n || n === 1n) return true;
        const MASK = 0x0202021202030213n;
        if (((MASK >> (n & 63n)) & 1n) === 0n) return false;
        const r = this.iSqrt(n);
        return r * r === n;
    }

    /**
     * Miller-Rabin witness test for base `a` mod N.
     *
     * Operates entirely in Montgomery domain using the shared context so the
     * squaring loop never rebuilds the precomputed parameters.
     *
     * Mathematical note: add(a, b), sub(a, b), and comparison with 0n all
     * behave identically on Montgomery-domain values because:
     *   add(a·R, b·R) = (a + b)·R mod n  is ok
     *   sub(a·R, b·R) = (a − b)·R mod n  is ok
     *   0·R mod n     = 0                is ok  (so comparing with 0n is safe)
     */
    millerRabinBase(N, a, ctx) {
        const { montMult, toMont } = ctx;

        let d = N - 1n;
        let s = 0n;
        while (!(d & 1n)) {
            d >>= 1n;
            s++;
        }

        // Precompute Montgomery forms of the two "good" residues
        const mont1 = toMont(1n);
        const montNm1 = toMont(N - 1n);

        // First exponentiation stays in Montgomery domain
        let p = this._modPowMont(a % N, d, ctx);
        let i = s;

        // Squaring loop: no modPow rebuild — just one montMult per iteration
        while (p !== mont1 && p !== montNm1 && (a % N) !== 0n && i > 0n) {
            p = montMult(p, p);
            i--;
        }

        if (p !== montNm1 && i !== s) return false;
        return true;
    }

    jacobi(D, n) {
        let t = 1;
        D %= n;
        while (D !== 0n) {
            let r = 0n;
            while (!(D & 1n)) {
                D >>= 1n;
                r++;
            }
            if (r & 1n) {
                let nm = n & 7n;
                if (nm === 3n || nm === 5n) t = -t;
            }
            let temp = D;
            D = n;
            n = temp;
            if ((D & 3n) === 3n && (n & 3n) === 3n) t = -t;
            D %= n;
        }
        return (n === 1n) ? t : 0;
    }

    /**
     * Lucas sequence doubling/addition, fully in Montgomery domain.
     *
     * All intermediate arithmetic uses the shared Montgomery context so no
     * modulo divisions occur inside the loop.  The following identities
     * justify operating directly on Montgomery-domain values:
     *
     *   montMult(a·R, b·R) = a·b·R mod n            is ok  (standard CIOS)
     *   add(a·R, b·R)      = (a + b)·R mod n        is ok  (linear)
     *   sub(a·R, b·R)      = (a − b)·R mod n        is ok  (linear)
     *   div2(a·R)          = (a·2⁻¹)·R mod n        is ok  (2⁻¹ commutes with R)
     *
     * Returns { U, V, Qk } all in Montgomery domain.
     */
    calcLucas(exp, n, d, p, q, ctx) {
        const { montMult, toMont } = ctx;

        const add = (a, b) => (a + b >= n) ? a + b - n : a + b;
        const sub = (a, b) => (a >= b) ? a - b : a + n - b;
        const div2 = (a) => (a & 1n) ? (a + n) >> 1n : a >> 1n;

        // Normalize parameters to [0, n)
        const P = (p < 0n) ? n - (-p) % n : p % n;
        const Q = (q < 0n) ? n - (-q) % n : q % n;
        const D = (d < 0n) ? n - (-d) % n : d % n;

        if (exp === 0n) {
            return { U: 0n, V: toMont(2n), Qk: toMont(1n) };
        }

        // Convert seeds to Montgomery domain once
        const P_m = toMont(P);
        const Q_m = toMont(Q);
        const D_m = toMont(D);

        const bits = Number(this.bitWidth(exp));
        let U_m = toMont(1n);  // U₁ = 1
        let V_m = P_m;         // V₁ = P
        let Qk_m = Q_m;        // Q^1

        for (let i = bits - 2; i >= 0; i--) {
            // Double step
            U_m = montMult(U_m, V_m);
            V_m = sub(montMult(V_m, V_m), add(Qk_m, Qk_m));
            Qk_m = montMult(Qk_m, Qk_m);

            // Addition step when the bit is set
            if ((exp >> BigInt(i)) & 1n) {
                const nU_m = div2(add(montMult(P_m, U_m), V_m));
                const nV_m = div2(add(montMult(D_m, U_m), montMult(P_m, V_m)));
                U_m = nU_m;
                V_m = nV_m;
                Qk_m = montMult(Qk_m, Q_m);
            }
        }

        return { U: U_m, V: V_m, Qk: Qk_m };
    }

    /**
     * Strong Lucas primality test (Selfridge parameters).
     * Receives the shared Montgomery context from isPrime() so calcLucas
     * and the squaring loop never rebuild precomputed values.
     */
    strongLucasSelfridge(n, ctx) {
        const { montMult, toMont, fromMont } = ctx;

        // Find the first D in 5, −7, 9, −11, … with jacobi(D, n) = −1
        let Dval = 5n;
        let sign = 1n;
        let curD;
        while (true) {
            curD = Dval * sign;
            let jacD = (curD < 0n) ? (n - (-curD) % n) % n : curD % n;
            let j = this.jacobi(jacD, n);
            if (j === -1) { Dval = curD; break; }
            if (j === 0) { return n === (curD < 0n ? -curD : curD); }
            Dval += 2n;
            sign = -sign;
        }

        const Pval = 1n;
        const Qval = (1n - Dval) / 4n; // may be negative

        let d = n + 1n;
        let s = 0n;
        while (!(d & 1n)) { d >>= 1n; s++; }

        // calcLucas returns U, V, Qk in Montgomery domain
        let { U, V, Qk } = this.calcLucas(d, n, Dval, Pval, Qval, ctx);

        // 0 is identical in both domains, so these comparisons are correct
        let isSlprp = (U === 0n || V === 0n);

        const add = (a, b) => (a + b >= n) ? a + b - n : a + b;
        const sub = (a, b) => (a >= b) ? a - b : a + n - b;

        // Squaring loop — stays in Montgomery domain
        for (let r = 1n; r < s; r++) {
            V = sub(montMult(V, V), add(Qk, Qk));
            Qk = montMult(Qk, Qk);
            if (V === 0n) isSlprp = true;
        }
        if (!isSlprp) return false;

        // Final checks: convert back to regular domain for comparison
        const vNext = sub(montMult(V, V), add(Qk, Qk));
        const expectedV = (Qval < 0n) ? (n - (-Qval * 2n) % n) % n : (Qval * 2n) % n;
        if (fromMont(vNext) !== expectedV) return false;

        const qMod = (Qval < 0n) ? (n - (-Qval) % n) % n : Qval % n;
        const jacQ = this.jacobi(qMod, n);
        const expectedQ = (jacQ === -1) ? n - qMod : qMod;
        if (fromMont(Qk) !== expectedQ) return false;

        return true;
    }

    /**
     * Deterministic BPSW primality test with optional extra Miller-Rabin
     * rounds for n > 2^64 (satisfies FIPS 186-4 guidelines).
     *
     * A single Montgomery context is built once for candidate n and shared
     * across every sub-call, eliminating all redundant precomputation.
     */
    isPrime(n) {
        if (n < 64n) {
            const MASK = 0x28208A20A08A28ACn;
            return ((MASK >> n) & 1n) === 1n;
        }

        const x = n % 30n;
        const WHEEL30 = 0x208A2882n;
        if (!((WHEEL30 >> x) & 1n)) return false;

        // Build the Montgomery context once for this candidate
        const ctx = this.buildMontContext(n);

        if (!this.millerRabinBase(n, 2n, ctx)) return false;
        if (this.isPerfectSquare(n)) return false;
        if (!this.strongLucasSelfridge(n, ctx)) return false;

        // Extra random-base Miller-Rabin rounds for n > 2^64 (FIPS 186-4)
        if (n > 2n ** 64n) {
            for (let i = 0; i < 5; i++) {
                const a = this.randomBigIntInRange(2n, n - 2n);
                if (!this.millerRabinBase(n, a, ctx)) return false;
            }
        }

        return true;
    }

    async generatePrimesProgressive(digitLength, count, onPrimeFound, yieldStrategy) {
        const primesSet = new Set();
        const maxAttempts = digitLength > 100 ? 500000 : 10000;
        let foundCount = 0;

        while (foundCount < count) {
            let attempts = 0;
            let candidate;

            do {
                candidate = this.generateRandomOddNumber(digitLength);
                attempts++;

                if (attempts > maxAttempts) {
                    throw new Error(`Could not find ${count} primes with ${digitLength} digits after ${maxAttempts} attempts`);
                }

                if (yieldStrategy && yieldStrategy.shouldYield(attempts)) {
                    await yieldStrategy.yield();
                }
            } while (!this.isPrime(candidate) || primesSet.has(candidate));

            primesSet.add(candidate);
            foundCount++;

            if (onPrimeFound) onPrimeFound(candidate);

            if (yieldStrategy) await yieldStrategy.yield();
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

export { PrimeCore };