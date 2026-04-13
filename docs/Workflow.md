# CryptoPrime — Full System Workflow

This document explains the complete end-to-end workflow of the CryptoPrime application: how a user request flows from a button click in the browser all the way down to the mathematical core, and how each file communicates with every other file in the system.

---

## Table of Contents

1. [System Design](#1-system-design)
2. [Monorepo Architecture](#2-monorepo-architecture)
3. [Startup Sequence](#3-startup-sequence)
4. [End-to-End Request Flow](#4-end-to-end-request-flow)
5. [Execution Mode Selection](#5-execution-mode-selection)
6. [Mode A — Browser Web Worker](#6-mode-a--browser-web-worker)
7. [Mode B — Server (Node.js Worker Threads)](#7-mode-b--server-nodejs-worker-threads)
8. [Mode C — Main Thread Fallback](#8-mode-c--main-thread-fallback)
9. [The Core Mathematical Pipeline (BPSW)](#9-the-core-mathematical-pipeline-bpsw)
10. [Montgomery Domain Optimization](#10-montgomery-domain-optimization)
11. [Yield Strategy Pattern](#11-yield-strategy-pattern)
12. [Crypto Provider Pattern](#12-crypto-provider-pattern)
13. [Progressive Streaming Protocol](#13-progressive-streaming-protocol)
14. [Pagination & Display](#14-pagination--display)
15. [Cancellation & Cleanup](#15-cancellation--cleanup)
16. [File-by-File Reference](#16-file-by-file-reference)

**Deep-Dive Appendices:**

- [Appendix A — Understanding Web Workers & Worker Threads](#appendix-a--understanding-web-workers--worker-threads)
- [Appendix B — Understanding Yielding & the Event Loop](#appendix-b--understanding-yielding--the-event-loop)

---

## 1. System Design

![System Design UML](System%20design%20UML.svg)

---

## 2. Monorepo Architecture

The project is an **npm workspaces** monorepo. The root `package.json` declares:

```json
"workspaces": ["packages/*"]
```

This allows three packages to **share code without symlinks or file duplication**:

| Package | Name | Purpose |
|---|---|---|
| `packages/core` | `@cryptoprime/core` | Pure math library, zero dependencies, runs identically in Node.js and the browser |
| `packages/client` | `client` | Vite-based frontend (Single Page Application) SPA |
| `packages/server` | `server` | Express.js HTTP API |

Both `client` and `server` declare `@cryptoprime/core` as a dependency:

```json
"dependencies": { "@cryptoprime/core": "*" }
```

npm resolves this to the local `packages/core` folder via the workspace symlink. All imports use the package specifier:

```js
import { PrimeCore } from '@cryptoprime/core/prime-core.js';
```

The `@cryptoprime/core` `package.json` declares an `exports` map, ensuring only three files are publicly importable: `prime-core.js`, `crypto-providers.js`, and `yield-strategies.js`.

---

## 3. Startup Sequence

Running `npm run dev` from the root executes (via `concurrently`):

```
npm run dev -w client   →  vite  (serves frontend at :5173)
npm start -w server     →  node server.js  (starts Express at :3000)
```

### Vite Dev Server (Client)

1. Vite serves `index.html` from `packages/client/`.
2. `index.html` references `<script type="module" src="./src/main.js">`.
3. Vite resolves `@cryptoprime/core/*` imports via the workspace symlink.
4. The Vite proxy forwards any `/api/*` request to `http://localhost:3000`.

### Express Server

1. `server.js` imports `PrimeGeneratorServer` → instantiates it (which creates a `PrimeCore` instance with `NodeCryptoProvider`).
2. Registers `POST /api/primes` route with strict input validation.
3. Listens on port 3000.

---

## 4. End-to-End Request Flow

Below is the complete call chain from button click to displayed prime number.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                          BROWSER                                    │
 │                                                                     │
 │  User clicks "Generate Primes"                                      │
 │       │                                                             │
 │       ▼                                                             │
 │  main.js: CryptoPrime.handlePrimeGeneration()                       │
 │       │  1. Validates form (digitLength, primeCount)                │
 │       │  2. Sets isGenerating = true, disables button               │
 │       │  3. Resets PaginationController                             │
 │       │  4. Shows loading animation                                 │
 │       │  5. Starts performance.now() timer                          │
 │       │                                                             │
 │       ▼                                                             │
 │  prime-client.js: PrimeClient.generatePrimesProgressive()           │
 │       │  Calls selectMode(digitLength, count)                       │
 │       │  Computes: complexity = digitLength³ × count                │
 │       │                                                             │
 │       ├──── complexity > 1,000,000 ──────► Mode B (Server)          │
 │       ├──── Worker available ────────────► Mode A (Web Worker)      │
 │       └──── fallback ───────────────────► Mode C (Main Thread)      │
 │                                                                     │
 │  ◄─── Each found prime fires onPrimeFound(prime) callback ────►     │
 │       │                                                             │
 │       ▼                                                             │
 │  main.js: callback in handlePrimeGeneration                         │
 │       │  1. PaginationController.addItem(prime)                     │
 │       │  2. If on page 1 and under limit → displayPrimes()          │
 │       │  3. Otherwise → updatePaginationUI()                        │
 │       │                                                             │
 │       ▼                                                             │
 │  On completion: stops timer, shows results, shows Export button     │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Execution Mode Selection

`PrimeClient.selectMode()` in [prime-client.js](../packages/client/src/prime-client.js) chooses the optimal execution environment:

```js
selectMode(digitLength, count) {
    if (this.mode !== 'auto') return this.mode;

    const complexity = (digitLength ** 3) * count;

    if (complexity > 1_000_000)        return 'server';
    if (typeof Worker !== 'undefined') return 'worker';
    return 'mainthread';
}
```

**Why `digitLength³`?** The dominant cost is modular exponentiation (`modPow`), which requires `O(k)` squarings where each squaring operates on `k`-bit numbers. BigInt multiplication is `O(k²)` (schoolbook) or `O(k^1.58)` (Karatsuba), making the total cost per `isPrime` call approximately `O(k³)` — hence the cubic heuristic.

**Fallback chain:** Server → Worker → Main Thread. Each layer catches errors and cascades down:

```
generateViaServer  ──fail──►  generateViaWorker  ──fail──►  generateViaMainThread
```

---

## 6. Mode A — Browser Web Worker

This is the **default mode** for all requests where Workers are available and complexity is under the server threshold.

### Communication Flow

```
 main.js                prime-client.js           prime-generator.js              prime-worker.js (Worker thread)
    │                        │                          │                                 │
    │  generatePrimesProgr.  │                          │                                 │
    │───────────────────────►│  generateViaWorker()     │                                 │
    │                        │─────────────────────────►│  initWorker()                   │
    │                        │                          │  new Worker('./prime-worker.js')│
    │                        │                          │───────────────────────────────► │
    │                        │                          │                                 │
    │                        │                          │  postMessage({type:'generate'}) │
    │                        │                          │───────────────────────────────► │
    │                        │                          │                                 │
    │                        │                          │                  PrimeCore.generatePrimesProgressive()
    │                        │                          │                  with WorkerYieldStrategy (no-op)
    │                        │                          │                                 │
    │                        │                          │  ◄── postMessage({type:'prime', │
    │                        │                          │       prime: '...'})            │
    │                        │                          │                                 │
    │  onPrimeFound(BigInt)  │  ◄── callback ─────────  │  messageHandler: BigInt(prime)  │
    │◄───────────────────────│                          │                                 │
    │                        │                          │  ◄── postMessage({type:'complete'})
    │                        │  ◄── resolve() ────────  │  removeEventListener, resolve   │
    │◄───────────────────────│                          │                                 │
```

### Key Details

1. **`PrimeGenerator.initWorker()`** lazily creates the Worker using Vite's `new URL()` pattern for proper bundling:
   ```js
   new Worker(new URL('./prime-worker.js', import.meta.url), { type: 'module' })
   ```

2. **`prime-worker.js`** (browser) constructs its own `PrimeCore` with `BrowserCryptoProvider` and `WorkerYieldStrategy`. The Worker yield strategy is a **no-op** — since the Worker thread has no event loop to share, yielding is unnecessary.

3. **Serialization boundary:** BigInt cannot be serialized via `postMessage`. Primes are sent as **strings** (`prime.toString()`) and converted back to `BigInt` on the main thread.

4. **`workerBusy` flag** prevents re-entrant use of the same Worker instance. If the Worker is busy, `PrimeGenerator` falls back to main thread execution.

---

## 7. Mode B — Server (Node.js Worker Threads)

Activated when `complexity > 1,000,000` (e.g., 100+ digit primes, or many primes).

### Communication Flow

```
 BROWSER                                           SERVER
 ───────                                           ──────
 prime-server-api.js                               server.js
        │                                              │
        │  POST /api/primes                            │
        │  {digitLength, count}                        │
        │  fetch(..., {signal: AbortController})       │
        │─────────────────────────────────────────────►│
        │                                              │  Validate: 1≤digitLength≤500, 1≤count≤100
        │                                              │  res.setHeader('Content-Type', 'application/x-ndjson')
        │                                              │
        │                                              │  prime-generator-server.js
        │                                              │         │
        │                                              │         │  Spawns worker_threads Worker
        │                                              │         │  ──────────────────────►  prime-worker.js (Node)
        │                                              │         │                               │
        │                                              │         │                   PrimeCore.generatePrimesProgressive()
        │                                              │         │                   with yieldStrategy = null (dedicated thread)
        │                                              │         │                               │
        │                                              │         │  ◄── parentPort.postMessage   │
        │                                              │         │      {type:'prime',prime:'…'} │
        │                                              │  ◄──────│                               │
        │  ◄─── res.write(JSON + '\n') ──────────────  │  Stream each prime as NDJSON            │
        │  reader.read() → parse line → onPrimeFound   │                                         │
        │                                              │         │  ◄── {type:'complete'}        │
        │  ◄─── res.write({type:'complete'}) ────────  │  ◄──────│                               │
        │  reader done                                 │  res.end()                              │
```

### Key Details

1. **`PrimeGeneratorServer.generatePrimesProgressive()`** does NOT run the math on the Express event loop. It spawns a **fresh `worker_threads.Worker`** per request, passing `{digitLength, count}` as `workerData`.

2. **`prime-worker.js` (server)** is a short-lived script: it reads `workerData`, runs the math, posts each prime via `parentPort.postMessage()`, posts `{type:'complete'}`, and the process exits.

3. **No yield strategy** is needed because `worker_threads` runs on a dedicated OS thread. The `null` parameter to `generatePrimesProgressive` causes the yield check to be skipped.

4. **NDJSON streaming:** The Express route writes each prime as a newline-delimited JSON object (`{"type":"prime","prime":"…"}\n`). The response uses `Transfer-Encoding: chunked` so primes arrive in real time.

5. **Client-side parsing:** `PrimeServerAPI` reads the fetch response body as a `ReadableStream`, accumulates bytes in a buffer, splits on `\n`, and processes each complete line as JSON. Partial lines stay in the buffer until the next chunk arrives.

6. **AbortController:** The `PrimeServerAPI` creates an `AbortController` per request. The `signal` is wired into `fetch()`. Calling `PrimeClient.cleanup()` → `serverAPI.abort()` cancels the in-flight request and the stream reader stops.

---

## 8. Mode C — Main Thread Fallback

Only used if `Worker` is not defined (server-side rendering environments, very old browsers).

```
prime-generator.js
       │
       │ generatePrimesProgressiveMainThread()
       │
       ▼
PrimeCore.generatePrimesProgressive(digitLength, count, onPrimeFound, BrowserYieldStrategy)
       │
       │  Every 1000 attempts → await setTimeout(0) → yields to browser event loop
       │  Each found prime → onPrimeFound(candidate)
```

The `BrowserYieldStrategy` calls `await new Promise(resolve => setTimeout(resolve, 0))` every 1000 iterations, giving the browser a chance to repaint and handle user input.

---

## 9. The Core Mathematical Pipeline (BPSW)

Every call to `PrimeCore.isPrime(n)` executes the following pipeline:

```
isPrime(n)
    │
    ├─ n < 64?  → Bitmask lookup (O(1))
    │              MASK = 0x28208A20A08A28AC
    │              Bit n of MASK == 1 means prime
    │
    ├─ Wheel-30 sieve
    │   n % 30 checked against WHEEL30 bitmask
    │   Eliminates multiples of 2, 3, 5 instantly
    │
    ├─ ★ Build MontgomeryContext once ★
    │   ctx = buildMontContext(n)
    │   Precomputes: k, R, Rmask, Nprime, R²
    │
    ├─ Miller-Rabin base 2
    │   millerRabinBase(n, 2, ctx)
    │   Uses ctx for ALL squarings — zero redundant precomputation
    │
    ├─ Perfect square check
    │   isPerfectSquare(n)  (Newton's integer sqrt)
    │   Catches the one case BPSW can't: n = p²
    │
    ├─ Strong Lucas-Selfridge
    │   strongLucasSelfridge(n, ctx)
    │       └── calcLucas(d, n, D, P, Q, ctx)
    │           ALL multiplications use ctx.montMult
    │
    └─ (if n > 2⁶⁴) Extra 5 random-base Miller-Rabin rounds
        Each round uses the SAME ctx
        Satisfies (Federal Information Processing Standards) FIPS 186-4 guidelines
```

### The BPSW Guarantee

BPSW (Baillie–PSW) combines a base-2 Miller-Rabin test with a Strong Lucas test. **No known BPSW pseudoprime has ever been found** — the test is considered deterministically correct for all practical inputs. The extra 5 random MR rounds for large numbers is defense-in-depth for cryptographic applications.

---

## 10. Montgomery Domain Optimization

### The Problem

Naively, every modular multiplication is:
```js
a * b % mod    // creates a 2k-bit intermediate, then divides — O(k²)
```

Division is far more expensive than multiplication. For a single `modPow` call with a `k`-bit modulus, you execute `~2k` multiplications, meaning `~2k` divisions.

### The Solution

**Montgomery reduction** replaces division with bitwise shifts. The `buildMontContext(mod)` function precomputes:

| Value | Meaning |
|---|---|
| `k` | Bit-width of `mod` |
| `R = 2^k` | The Montgomery radix |
| `Rmask = R - 1` | Bitmask for modular reduction |
| `Nprime` | `-mod⁻¹ mod R` (computed via Hensel lifting) |
| `R²` | `R² mod mod` (domain entry helper) |

Once precomputed, `montMult(a, b)` replaces the `%` operator:

```js
const montMult = (a, b) => {
    const t = a * b;
    const m = (t * Nprime) & Rmask;     // bitwise AND instead of %
    let u = (t + m * mod) >> k;         // right-shift instead of /
    if (u >= mod) u -= mod;
    return u;
};
```

### Why Context Sharing Matters

Without sharing, every `modPow(_, _, n)` call rebuilds the context from scratch. In a single `isPrime(n)` call, the context would be rebuilt:

- 1× for base-2 Miller-Rabin initial `a^d mod n`
- `s` times for squarings inside Miller-Rabin (each was a `modPow(p, 2n, N)` before)
- `~log₂(n + 1)` times inside `calcLucas` (for every `modMult`)
- 5× for extra MR rounds (large primes)

**Total: 10–20+ redundant rebuilds per candidate.**

With context sharing, it's built **exactly once**. The `ctx` object is threaded through:
```
isPrime ──ctx──► millerRabinBase ──ctx──► _modPowMont
         │
         └─ctx──► strongLucasSelfridge ──ctx──► calcLucas
```

### Domain Conversion

- **Entering:** `toMont(x)` = `montMult(x % mod, R²)` — converts a regular integer into Montgomery form (`x·R mod n`)
- **Exiting:** `fromMont(x)` = `montMult(x, 1)` — converts back (`x·R⁻¹ mod n`)
- **Key property:** `add`, `sub`, and `div2` all commute with the Montgomery representation, so the Lucas sequence can operate entirely in-domain without extra conversions

---

## 11. Yield Strategy Pattern

The yield strategy is a **Strategy Pattern** that decouples the math engine from its execution environment.

```
                    ┌──────────────────────┐
                    │  «interface»         │
                    │  YieldStrategy       │
                    ├──────────────────────┤
                    │ shouldYield(attempts)│
                    │ yield()              │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
   ┌──────────▼──────┐ ┌───────▼────────┐ ┌─────▼──────────┐
   │ BrowserYield    │ │ ServerYield    │ │ WorkerYield    │
   │ every 1000 iters│ │ every 5000     │ │ never yields   │
   │ setTimeout(0)   │ │ setImmediate   │ │ (no-op)        │
   └─────────────────┘ └────────────────┘ └────────────────┘
```

`PrimeCore.generatePrimesProgressive()` calls the strategy at two points:
1. **Inside the candidate search loop** — every N attempts (controlled by `shouldYield`)
2. **After each prime is found** — unconditionally

This ensures:
- **Browser main thread:** UI stays responsive (repaints, input handling)
- **Node.js express thread:** Event loop briefly unblocks for I/O (unlikely to be hit since we use worker_threads, but defense-in-depth)
- **Dedicated worker threads:** Zero overhead from unnecessary yields

---

## 12. Crypto Provider Pattern

Another Strategy Pattern to abstract platform-specific secure random number generation.

```
                    ┌──────────────────────┐
                    │  «interface»         │
                    │  CryptoProvider      │
                    ├──────────────────────┤
                    │ getRandomBytes(n)    │
                    │ bufferToHex(buf)     │
                    └──────────┬───────────┘
                               │
              ┌────────────────┴──────────────────┐
              │                                   │
   ┌──────────▼────────────┐          ┌───────────▼──────────┐
   │ BrowserCryptoProvider │          │ NodeCryptoProvider   │
   │ crypto.getRandomValues│          │ crypto.randomBytes() │
   │ manual hex conversion │          │ buf.toString('hex')  │
   └───────────────────────┘          └──────────────────────┘
```

**Browser:** Uses the Web Crypto API (`crypto.getRandomValues`) with manual byte-to-hex conversion.

**Node.js:** Uses Node's `crypto.randomBytes()` with native `Buffer.toString('hex')`.

`PrimeCore` is constructed with a crypto provider, making it completely environment-agnostic:

```js
// Browser
new PrimeCore(new BrowserCryptoProvider());

// Node.js
new PrimeCore(new NodeCryptoProvider(crypto));
```

---

## 13. Progressive Streaming Protocol

Both the browser Worker and the server use the same three-message protocol:

| Message | Direction | Payload |
|---|---|---|
| `{type: 'prime', prime: '…'}` | Worker → Caller | String representation of found prime |
| `{type: 'complete'}` | Worker → Caller | All requested primes found |
| `{type: 'error', error: '…'}` | Worker → Caller | Error message string |

**Browser Workers** use `self.postMessage()` / `addEventListener('message')`.

**Node.js Workers** use `parentPort.postMessage()` / `worker.on('message')`.

**Server streaming** uses the same payload format over HTTP as NDJSON (newline-delimited JSON), with each message on its own line:

```
{"type":"prime","prime":"104729"}\n
{"type":"prime","prime":"104743"}\n
{"type":"complete"}\n
```

---

## 14. Pagination & Display

`PaginationController` manages all generated primes in memory and provides a windowed view.

```
 main.js callback                    PaginationController
      │                                   │
      │  addItem(prime)                   │
      │──────────────────────────────────►│  allItems.push(prime)
      │                                   │  totalPages = ceil(len / 5)
      │                                   │
      │  getState()                       │
      │──────────────────────────────────►│  returns {currentPage, totalPages, hasNext, ...}
      │                                   │
      │  getCurrentPageItemsWithIndices() │
      │──────────────────────────────────►│  slices allItems for current page
      │                                   │  returns [{item, globalIndex}, ...]
      │                                   │
      │  nextPage() / previousPage()      │
      │──────────────────────────────────►│  updates currentPage
      │                                   │  fires onPageChangeCallback(state)
      │                                   │
      │  ◄── handlePaginationChange(state)│
      │       displayPrimes(items)        │
      │       updatePaginationUI(state)   │
```

**Progressive display:** During generation, `main.js` checks if we're on page 1 and under the per-page limit. If so, it calls `displayPrimes()` immediately — so the user sees primes appear one by one in real time.

**Click-to-copy:** Each prime element has a click handler that uses `navigator.clipboard.writeText()`, with a `document.execCommand('copy')` fallback.

**Export:** `exportPrimes()` builds a `Blob` with a header and all primes, creates a temporary `<a>` element, triggers a download, then revokes the Object URL.

---

## 15. Cancellation & Cleanup

```
 PrimeClient.cleanup()
      │
      ├── workerGenerator.terminateWorker()
      │       worker.terminate()     ← kills the browser Web Worker
      │       worker = null
      │       workerBusy = false
      │
      └── serverAPI.abort()
              _abortController.abort()  ← sends AbortSignal to fetch()
              _abortController = null      ← stream reader stops, returns gracefully
```

The `AbortController` is wired into `fetch()` via the `signal` option. When aborted:
1. The `fetch` Promise rejects with an `AbortError`
2. `PrimeServerAPI` catches `AbortError` specifically and returns silently (not an error)
3. The `_abortController` is nulled out in the `finally` block

**UI locking:** `main.js` sets `this.isGenerating = true` and disables the generate button at the start of each job. The `finally` block re-enables everything regardless of success or failure.

---

## 16. File-by-File Reference

### `packages/core/prime-core.js`

The **mathematical heart** of the entire application. Contains:

- `randomBigIntInRange(min, max)` — Rejection-sampled CSPRNG integer generation
- `generateRandomOddNumber(digitLength)` — Generates a random odd number with exactly `digitLength` decimal digits
- `buildMontContext(mod)` — Constructs a reusable Montgomery reduction context
- `_modPowMont(N, power, ctx)` — Internal modular exponentiation, returns result in Montgomery domain
- `modPow(N, power, mod, ctx?)` — Public modular exponentiation with optional context sharing
- `millerRabinBase(N, a, ctx)` — Single-base Miller-Rabin witness test, fully in Montgomery domain
- `jacobi(D, n)` — Jacobi symbol computation via quadratic reciprocity
- `calcLucas(exp, n, d, p, q, ctx)` — Lucas sequence via doubling/addition, fully in Montgomery domain
- `strongLucasSelfridge(n, ctx)` — Strong Lucas primality test with Selfridge parameter selection
- `isPrime(n)` — Full BPSW test: wheel sieve → MR base 2 → perfect square check → Strong Lucas → (optional extra MR rounds)
- `generatePrimesProgressive(digitLength, count, onPrimeFound, yieldStrategy)` — Async prime search loop with yield support and progressive callbacks
- `generatePrimes(digitLength, count, yieldStrategy)` — Convenience wrapper that collects primes into an array

### `packages/core/crypto-providers.js`

Exports `BrowserCryptoProvider` and `NodeCryptoProvider`. Each implements `getRandomBytes(n)` and `bufferToHex(buf)`.

### `packages/core/yield-strategies.js`

Exports `BrowserYieldStrategy`, `ServerYieldStrategy`, and `WorkerYieldStrategy`. Each implements `shouldYield(attempts)` and `async yield()`.

---

### `packages/client/src/main.js`

The **UI controller**. The `CryptoPrime` class manages:
- DOM element references (centralized in the `DOM` object)
- Debounced input validation (digit length, prime count)
- Form validation with error display and ARIA attributes
- `handlePrimeGeneration()` — the main async flow that coordinates PrimeClient, PaginationController, loading states, timing, and error handling
- `displayPrimes()` — renders prime elements with click-to-copy
- `exportPrimes()` — downloads all primes as a `.txt` file

### `packages/client/src/prime-client.js`

The **mode dispatcher**. `PrimeClient` owns three sub-generators:
- `workerGenerator` — a `PrimeGenerator(useWorker=true)`
- `mainThreadGenerator` — a `PrimeGenerator(useWorker=false)`
- `serverAPI` — a `PrimeServerAPI`

`selectMode()` computes `(digitLength ** 3) * count` and routes to the appropriate backend. Each `generateVia*` method catches errors and cascades to the next fallback tier.

### `packages/client/src/prime-generator.js`

**Browser-side worker/main-thread bridge.** `PrimeGenerator` either:
1. Lazily initializes a Web Worker and communicates via `postMessage`
2. Runs `PrimeCore.generatePrimesProgressive()` directly on the main thread with `BrowserYieldStrategy`

### `packages/client/src/prime-worker.js`

**Browser Web Worker entry point.** Runs in a dedicated thread. Creates its own `PrimeCore` + `BrowserCryptoProvider` + `WorkerYieldStrategy`. Listens for `{type:'generate'}` messages, runs the math, posts results back via `self.postMessage()`.

### `packages/client/src/prime-server-api.js`

**HTTP client for server-side generation.** Sends a `POST` to `/api/primes`, reads the NDJSON stream via `ReadableStream`, converts prime strings back to `BigInt`, and fires the `onPrimeFound` callback per prime. Supports cancellation via `AbortController`.

### `packages/client/src/pagination-controller.js`

**Stateful paginator.** Stores all items, computes page boundaries, supports `nextPage()` / `previousPage()` / `goToPage()`, and fires a registered callback on page changes.

---

### `packages/server/server.js`

**Express HTTP entry point.** Configures CORS + JSON middleware, enforces strict input validation (`1 ≤ digitLength ≤ 500`, `1 ≤ count ≤ 100`), sets NDJSON streaming headers, and delegates to `PrimeGeneratorServer`.

### `packages/server/prime-generator-server.js`

**Server-side worker spawner.** For each `generatePrimesProgressive` call, spawns a fresh `worker_threads.Worker` running `prime-worker.js`. Listens for `'message'` events and forwards primes to the Express response callback. Resolves/rejects the Promise on `'complete'`/`'error'`/`'exit'`.

### `packages/server/prime-worker.js`

**Node.js worker_threads entry point.** Reads `workerData`, constructs `PrimeCore` + `NodeCryptoProvider`, runs `generatePrimesProgressive` with `yieldStrategy = null`, and posts results via `parentPort.postMessage()`.

---

## Appendix A — Understanding Web Workers & Worker Threads

This appendix explains the threading model behind both the browser and server execution paths.

### A.1 — The Single-Threaded Problem

JavaScript is **single-threaded by default**. Both the browser and Node.js run all JavaScript on a single thread called the **main thread** (or "event loop thread"). This thread is responsible for:

| Browser Main Thread | Node.js Main Thread |
|---|---|
| Parsing & executing JS | Parsing & executing JS |
| DOM rendering & layout | Handling incoming HTTP requests |
| Handling user events (clicks, input) | File/network I/O callbacks |
| CSS animations & repaints | Timer callbacks (setTimeout, etc.) |
| `setTimeout` / `requestAnimationFrame` | `setImmediate` / `process.nextTick` |

**The problem:** If a long-running computation (like testing if a 500-digit number is prime) runs on the main thread, **everything else stops**. In the browser, the page freezes — no scrolling, no button clicks, no animations. In Node.js, the server stops accepting new HTTP requests.

Prime generation involves testing thousands of random candidates, each requiring a BPSW primality test with heavy BigInt arithmetic. A single `isPrime()` call on a 200-digit number can take tens of milliseconds. Generating 50 such primes can take seconds — more than enough to make a UI feel completely dead.

### A.2 — Browser Web Workers

The Web Workers API solves this by creating **true OS-level threads** that run JavaScript in parallel.

```
 ┌────────────────────────────────┐    ┌────────────────────────────────┐
 │         MAIN THREAD            │    │         WORKER THREAD          │
 │                                │    │                                │
 │  • DOM access                  │    │  • No DOM access               │
 │  • window object               │    │  • self object (not window)    │
 │  • User event handling         │    │  • crypto.getRandomValues      │
 │  • UI rendering                │    │  • importScripts/import        │
 │  • Can create Workers          │    │  • Can create sub-Workers      │
 │                                │    │                                │
 │  postMessage({...}) ──────────────────► addEventListener('message')  │
 │  addEventListener('message') ◄────────── postMessage({...})          │
 │                                │    │                                │
 └────────────────────────────────┘    └────────────────────────────────┘
```

**Key properties:**

1. **Memory isolation:** Workers have their own heap. They cannot access the main thread's variables, DOM, or any shared state. All communication is via `postMessage()`.

2. **Structured Clone Algorithm:** When you call `postMessage(data)`, the data is **deep-copied** (serialized and deserialized). This means:
   - Primitives (numbers, strings, booleans) ✓
   - Objects and arrays ✓ (deep-cloned)
   - `BigInt` ✗ — **cannot be cloned**. This is why CryptoPrime serializes primes as strings (`prime.toString()`) before posting them, and converts back with `BigInt(prime)` on the receiving end.

3. **Module Workers:** CryptoPrime creates workers with `{ type: 'module' }`, enabling ES `import` statements inside the Worker. Vite handles the bundling of these imports at build time.

4. **Lifecycle:** A Worker thread exists until `.terminate()` is called or the page is closed. CryptoPrime reuses a single Worker instance across multiple generation runs (lazy initialization via `initWorker()`), and only terminates it on explicit `cleanup()`.

#### How CryptoPrime Uses Browser Workers

In `prime-generator.js`, when `useWorker = true`:

```js
async initWorker() {
    // Lazy: only creates the Worker the first time it's needed
    if (!this.worker && this.useWorker && typeof Worker !== 'undefined') {
        this.worker = new Worker(
            new URL('./prime-worker.js', import.meta.url),  // Vite resolves this at build time
            { type: 'module' }                              // enables import statements
        );
    }
}
```

The `new URL('./prime-worker.js', import.meta.url)` pattern is a Vite convention. It tells the bundler: "this file is a separate entry point — bundle it independently and give me its URL at runtime."

Inside the Worker (`prime-worker.js`), the code is fully self-contained:

```js
// This runs in a completely separate thread
const generator = new PrimeGeneratorWorker();  // has its own PrimeCore + BrowserCryptoProvider

self.addEventListener('message', async (e) => {
    if (e.data.type === 'generate') {
        await generator.generatePrimes(e.data.digitLength, e.data.count);
        // Each found prime is posted back via self.postMessage()
    }
});
```

The main thread receives results asynchronously via an event listener wrapped in a Promise:

```js
async generatePrimesProgressiveWorker(digitLength, count, onPrimeFound) {
    this.workerBusy = true;
    return new Promise((resolve, reject) => {
        const messageHandler = (e) => {
            if (e.data.type === 'prime')    onPrimeFound(BigInt(e.data.prime));
            if (e.data.type === 'complete') { resolve(); /* cleanup */ }
            if (e.data.type === 'error')    { reject(new Error(e.data.error)); }
        };
        this.worker.addEventListener('message', messageHandler);
        this.worker.postMessage({ type: 'generate', digitLength, count });
    });
}
```

### A.3 — Node.js `worker_threads`

Node.js has its own parallelism API: the `worker_threads` module. It serves the same purpose as browser Web Workers but with Node-specific features.

```
 ┌─────────────────────────────────────┐    ┌───────────────────────────────────┐
 │        EXPRESS MAIN THREAD          │    │       WORKER THREAD               │
 │                                     │    │                                   │
 │  • HTTP request handling            │    │  • No HTTP handling               │
 │  • Middleware execution             │    │  • Full Node.js API               │
 │  • res.write() for streaming        │    │  • crypto module                  │
 │  • Event loop for I/O               │    │  • Own V8 isolate + event loop    │
 │                                     │    │                                   │
 │  new Worker('prime-worker.js',      │    │  workerData = {digitLength, count}│
 │    { workerData: {...} })           │    │                                   │
 │                                     │    │                                   │
 │  worker.on('message') ◄───────────────── parentPort.postMessage({...})       │
 │  worker.on('error')                 │    │                                   │
 │  worker.on('exit')                  │    │  (thread exits when start() ends) │
 └─────────────────────────────────────┘    └───────────────────────────────────┘
```

**Key differences from browser Workers:**

| Feature | Browser Web Worker | Node.js `worker_threads` |
|---|---|---|
| Created via | `new Worker(url)` | `new Worker(filePath, { workerData })` |
| Initial data | `postMessage()` after creation | `workerData` (available immediately) |
| Communication | `self.postMessage()` / `self.addEventListener()` | `parentPort.postMessage()` / `parentPort.on()` |
| Global scope | `self` (DedicatedWorkerGlobalScope) | Standard Node.js `global` |
| Lifecycle | Long-lived (reusable) | Short-lived in CryptoPrime (one per request) |
| Can share memory | `SharedArrayBuffer` | `SharedArrayBuffer` |
| Module support | `{ type: 'module' }` | Inherits from package.json `"type": "module"` |

In `prime-generator-server.js`, each incoming request spawns a fresh Worker:

```js
async generatePrimesProgressive(digitLength, count, onPrimeFound) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            path.join(__dirname, 'prime-worker.js'),
            { workerData: { digitLength, count } }  // data available immediately via workerData
        );

        worker.on('message', (msg) => {
            if (msg.type === 'prime')    onPrimeFound(msg.prime);
            if (msg.type === 'complete') resolve();
            if (msg.type === 'error')    reject(new Error(msg.error));
        });

        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
        });
    });
}
```

The server Worker script (`prime-worker.js`) starts immediately upon creation (no "wait for message" pattern):

```js
import { parentPort, workerData } from 'worker_threads';

const core = new PrimeCore(new NodeCryptoProvider(crypto));

async function start() {
    const { digitLength, count } = workerData;  // available immediately
    await core.generatePrimesProgressive(digitLength, count, (prime) => {
        parentPort.postMessage({ type: 'prime', prime: prime.toString() });
    }, null);  // null = no yield strategy needed
    parentPort.postMessage({ type: 'complete' });
}

start();  // runs as soon as the Worker is created
```

### A.4 — Why Two Different Worker Files?

CryptoPrime has two separate worker files that look similar:

| File | Location | Runtime | Crypto Provider | Yield Strategy | Lifecycle |
|---|---|---|---|---|---|
| `prime-worker.js` | `packages/client/src/` | Browser | `BrowserCryptoProvider` | `WorkerYieldStrategy` (no-op) | Long-lived, reused |
| `prime-worker.js` | `packages/server/` | Node.js | `NodeCryptoProvider` | `null` (skipped) | Short-lived, one per request |

They can't be the same file because:
1. **Different crypto APIs:** The browser uses `crypto.getRandomValues()` while Node.js uses `crypto.randomBytes()`
2. **Different communication APIs:** `self.postMessage()` vs `parentPort.postMessage()`
3. **Different initialization:** Browser Workers listen for a `'generate'` message; Node Workers read `workerData` and start immediately
4. **Different bundling:** Browser Workers are bundled by Vite; Node Workers are loaded directly from the filesystem

However, the `PrimeCore` class they both use is **identical** — this is the isomorphic core.

---
---

## Appendix B — Understanding Yielding & the Event Loop

This appendix explains why yielding exists, how the JavaScript event loop works at a low level, and how each yield strategy interacts with the runtime.

### B.1 — The Event Loop Model

JavaScript runtimes (both V8 in browsers and Node.js) use a **cooperative multitasking** model. There is one thread, and it runs a loop:

```
┌──────────────────────────────────────────────────┐
│                   EVENT LOOP                     │
│                                                  │
│  ┌────────────┐                                  │
│  │ Call Stack │ ◄── Currently executing code     │
│  └─────┬──────┘                                  │
│        │ (empty? pick next task)                 │
│        ▼                                         │
│  ┌──────────────┐                                │
│  │ Macrotask    │ setTimeout, setInterval,       │
│  │ Queue        │ setImmediate, I/O callbacks    │
│  └──────┬───────┘                                │
│         │ (between macrotasks)                   │
│         ▼                                        │
│  ┌──────────────┐                                │
│  │ Microtask    │ Promise.then, queueMicrotask,  │
│  │ Queue        │ MutationObserver               │
│  └──────┬───────┘                                │
│         │ (browser only, between tasks)          │
│         ▼                                        │
│  ┌──────────────┐                                │
│  │ Render Steps │ Style calc, layout, paint      │
│  └──────────────┘                                │
└──────────────────────────────────────────────────┘
```

**The critical insight:** JavaScript code runs **synchronously** until the call stack is empty. While your code is running, **nothing else happens** — no rendering, no event handling, no I/O callbacks. The event loop only picks up the next task when the current one finishes.

### B.2 — The Problem Without Yielding

Consider the prime search loop without any yielding:

```js
do {
    candidate = this.generateRandomOddNumber(digitLength);
    attempts++;
} while (!this.isPrime(candidate));
```

For a 100-digit prime, statistically:
- By the Prime Number Theorem, roughly 1 in `ln(10^100) ≈ 230` odd numbers is prime
- Each `isPrime()` call does heavy BigInt arithmetic (Montgomery modPow, Lucas sequences)
- Each call takes ~1–50ms depending on the digit length
- **Total time to find one prime:** potentially seconds of continuous, synchronous execution

During this entire time on the main thread:
- ❌ The browser cannot repaint (the loading animation is frozen)
- ❌ Click events are queued but not processed
- ❌ CSS animations stop
- ❌ The page appears "Not Responding" in the browser tab

### B.3 — How Yielding Solves It

Yielding inserts **voluntary pause points** into the computation, allowing the event loop to process other tasks:

```
  ┌──────────────────────────────────────────────────────┐
  │ Time ──────────────────────────────────────────────► │
  │                                                      │
  │ WITHOUT YIELDING:                                    │
  │ ██████████████████████████████████████████████████   │
  │ ^--- isPrime loop (3 seconds, no breaks) ---^        │
  │                                                      │
  │ WITH YIELDING (every 1000 attempts):                 │
  │ ████████░████████░████████░████████░██████████░      │
  │         ^        ^        ^        ^                 │
  │         │        │        │        │                 │
  │      render   events   render   events               │
  │      + paint            + paint                      │
  └──────────────────────────────────────────────────────┘

  █ = JavaScript executing (isPrime loop)
  ░ = Yielded — event loop runs render, events, I/O
```

### B.4 — The Three Yield Strategies In Detail

#### `BrowserYieldStrategy` — `setTimeout(resolve, 0)`

```js
class BrowserYieldStrategy {
    shouldYield(attempts) {
        return attempts % 1000 === 0;   // yield every 1000 candidates tested
    }
    async yield() {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}
```

**How `setTimeout(resolve, 0)` works at the runtime level:**

1. `setTimeout(resolve, 0)` schedules `resolve` as a **macrotask** in the event loop queue
2. The `await` suspends the async function, returning control to the event loop
3. The event loop is now free to:
   - Process pending DOM events (clicks, scrolls)
   - Run CSS animation frames
   - Execute `requestAnimationFrame` callbacks
   - Run the rendering pipeline (style → layout → paint)
4. After all higher-priority work is done, the event loop picks up the `setTimeout` macrotask
5. `resolve()` is called, the Promise resolves, and `await` resumes the isPrime loop

**Why every 1000 attempts?** This is a tuned trade-off. Yielding too often (every 1 attempt) adds significant overhead — each yield involves a microtask transition, a macrotask queue insertion, and a full event loop cycle (~4ms minimum due to browser timer clamping). Yielding too rarely (every 100,000 attempts) defeats the purpose. 1000 attempts typically takes ~10–50ms of CPU time, which keeps the UI feeling responsive (the human perceptual threshold for "lag" is ~100ms).

#### `ServerYieldStrategy` — `setImmediate(resolve)`

```js
class ServerYieldStrategy {
    shouldYield(attempts) {
        return attempts % 5000 === 0;   // yield less often — no UI to keep responsive
    }
    async yield() {
        if (typeof setImmediate !== 'undefined') {
            await new Promise(resolve => setImmediate(resolve));
        } else {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
}
```

**`setImmediate` vs `setTimeout(0)` in Node.js:**

`setImmediate` is a Node.js-specific API that fires at the **end of the current event loop iteration**, after I/O callbacks but before timers. It's faster than `setTimeout(0)` because:

```
  Node.js Event Loop Phases:
  ┌───────────────────────────────┐
  │   timers (setTimeout)         │ ◄── setTimeout(0) fires HERE
  ├───────────────────────────────┤
  │   pending callbacks           │
  ├───────────────────────────────┤
  │   idle, prepare               │
  ├───────────────────────────────┤
  │   poll (I/O)                  │
  ├───────────────────────────────┤
  │   check (setImmediate)        │ ◄── setImmediate fires HERE (earlier in next iteration)
  ├───────────────────────────────┤
  │   close callbacks             │
  └───────────────────────────────┘
```

`setImmediate` has lower overhead because it doesn't require timer management. The higher yield interval (5000 vs 1000) reflects that there's no UI to keep responsive on the server — the only concern is allowing I/O callbacks to fire.

**Note:** In CryptoPrime's current architecture, the server yield strategy is **defense-in-depth**. Since `PrimeGeneratorServer` spawns a `worker_threads` Worker for each request, the heavy math never runs on the Express event loop. The `ServerYieldStrategy` exists for cases where `PrimeCore` might be used directly on the main Node.js thread (e.g., in a future CLI tool or test script).

#### `WorkerYieldStrategy` — No-op

```js
class WorkerYieldStrategy {
    shouldYield() {
        return false;   // never yields
    }
    async yield() {
        // intentionally empty
    }
}
```

**Why Workers don't need to yield:**

Both browser Web Workers and Node.js `worker_threads` run on **dedicated OS threads**. They have their own call stack, their own event loop (mostly unused for CPU-bound work), and they're not shared with any UI rendering or HTTP request handling. Blocking the Worker thread is **perfectly fine** — that's exactly what it's for.

Yielding inside a Worker would only slow things down with no benefit.

### B.5 — Yield Integration Points in `generatePrimesProgressive`

The yield strategy is called at exactly **two points** inside `PrimeCore.generatePrimesProgressive()`:

```js
async generatePrimesProgressive(digitLength, count, onPrimeFound, yieldStrategy) {
    while (foundCount < count) {
        let attempts = 0;
        do {
            candidate = this.generateRandomOddNumber(digitLength);
            attempts++;

            // ┌─────────────────────────────────────────────────┐
            // │  YIELD POINT 1: Inside the search loop          │
            // │  Purpose: prevent freezing during long searches │
            // │  Frequency: every N candidates (1000 or 5000)   │
            // └─────────────────────────────────────────────────┘
            if (yieldStrategy && yieldStrategy.shouldYield(attempts)) {
                await yieldStrategy.yield();
            }

        } while (!this.isPrime(candidate) || primesSet.has(candidate));

        primesSet.add(candidate);
        foundCount++;
        if (onPrimeFound) onPrimeFound(candidate);

        // ┌─────────────────────────────────────────────────────┐
        // │  YIELD POINT 2: After each prime is found           │
        // │  Purpose: let the caller process the result         │
        // │  Frequency: always (once per found prime)           │
        // └─────────────────────────────────────────────────────┘
        if (yieldStrategy) await yieldStrategy.yield();
    }
}
```

**Yield Point 1** is conditional — it only fires every N attempts. This is the main anti-freeze mechanism. Between yields, the loop runs synchronously at full speed.

**Yield Point 2** is unconditional — it fires after every found prime. This gives the caller (e.g., `main.js`) a chance to update the UI with the newly found prime before the search for the next one begins. Without this yield, the UI update from the `onPrimeFound` callback would be batched and only rendered after all primes are found.

### B.6 — The `async/await` Mechanism

The yield pattern depends on `async/await`. Here's what happens at the runtime level when a yield occurs:

```
 Call Stack                         Event Loop Queue
 ──────────                         ────────────────
 ┌────────────────────────────┐
 │ generatePrimesProgressive  │
 │   └── await yieldStrategy  │
 │         .yield()           │
 │         └── new Promise(   │
 │              setTimeout(   │     ┌──────────────────────┐
 │               resolve, 0)) ├────►│ resolve (macrotask)  │
 └────────────────────────────┘     └──────────────────────┘
                                            │
  (call stack now empty!)                   │
                                            │
 ┌────────────────────────────┐             │
 │ Browser renders frame      │             │
 │ Processes queued events    │             │
 └────────────────────────────┘             │
                                            │
 ┌────────────────────────────┐             │
 │ resolve() fires            │◄────────────┘
 │ Promise resolves           │
 │ await resumes              │
 │ generatePrimesProgressive  │
 │ continues from where it    │
 │ left off (same local vars) │
 └────────────────────────────┘
```

The beauty of `async/await` is that the function **preserves all local state** (loop counters, the current candidate, the attempts count) across the yield. When it resumes, it continues exactly where it left off — the developer writes sequential code that behaves as if it never paused.

### B.7 — When `yieldStrategy` is `null`

When `null` is passed (as in the server Worker), both yield checks short-circuit:

```js
if (yieldStrategy && yieldStrategy.shouldYield(attempts))  // null is falsy → skipped
if (yieldStrategy) await yieldStrategy.yield();            // null is falsy → skipped
```

The entire loop runs **synchronously without interruption** — maximum performance on a dedicated thread.
