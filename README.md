# CryptoPrime

A web application for generating cryptographically secure large prime numbers. It runs in the browser and optionally offloads heavy work to a Node.js backend, picking the best execution path automatically based on how expensive the job looks.

The UI has a dark "matrix" theme with particle animations, live results streaming, pagination, click-to-copy, and text file export.

## Key Features

- **BPSW Primality Test**: Uses the Baillie-PSW test — a base-2 Miller-Rabin followed by a Strong Lucas-Selfridge test. No known BPSW pseudoprime has ever been found. For primes larger than 2^64, five extra random-base Miller-Rabin rounds are added to satisfy FIPS 186-4 guidelines.

- **Montgomery Reduction**: All hot-path modular arithmetic replaces expensive BigInt division with bitwise shifts and multiplications. A single Montgomery context is built per candidate and shared across every sub-call (Miller-Rabin squarings, Lucas sequence steps), so the precomputation only happens once.

- **Cryptographically Secure**: Uses `crypto.getRandomValues()` (browser) and `crypto.randomBytes()` (Node.js) for random number generation.

- **Hybrid Architecture**: Automatically selects the best execution environment:
  - **Web Worker**: Default for most jobs — runs in a dedicated browser thread, UI never freezes.
  - **Server**: For heavy jobs — the Express backend spawns a `worker_threads` Worker and streams results back as newline-delimited JSON.
  - **Main Thread**: Fallback if Workers are unavailable — yields periodically to keep the UI responsive.

- **Progressive Loading**: Streams results in real-time using chunked transfer encoding (NDJSON).

- **Responsive UI**: Cyber-themed interface with particle animations, pagination, and click-to-copy.

- **Export**: Generated primes can be downloaded as `.txt` files.

## Tech Stack

**Frontend:**
- Vanilla JavaScript (ES Modules)
- Vite (build tool and dev server)
- Web Workers (multi-threading)
- CSS3 (custom animations and responsiveness)

**Backend:**
- Node.js
- Express.js
- `worker_threads` (offloads math from the event loop)

**Shared:**
- `@cryptoprime/core` — isomorphic math library, pure BigInt, zero dependencies

**Tooling:**
- npm workspaces (monorepo)
- Concurrently (runs client and server simultaneously)

## System Design

![UML Diagram](./docs/system%20design%20UML.svg)

## Getting Started

### Prerequisites

- Node.js v18+
- npm

### Installation

```bash
git clone https://github.com/AhmedEssamYassin/CryptoPrime.git
cd CryptoPrime
npm install      # installs all three workspaces at once
```

The project is an npm workspaces monorepo (`packages/core`, `packages/client`, `packages/server`). A single `npm install` at the root handles everything — no symlinks or manual copying needed.

### Running the Application

To run both the frontend (Vite) and backend (Express) simultaneously:

```bash
npm run dev
```

- **Frontend**: `http://localhost:5173` (or the port assigned by Vite)
- **Backend**: `http://localhost:3000`

The Vite dev server proxies `/api/*` requests to the backend, so everything works on a single origin during development.

### Other Commands

```bash
npm run build    # production build of the client
npm run preview  # serve the production build locally
npm start        # start just the server
```

## How It Works

### The Core Logic (PrimeCore)

The mathematical core is isomorphic — runs identically in Node.js and the browser. It generates random odd numbers of the requested digit length and validates them using the BPSW primality test (base-2 Miller-Rabin + Strong Lucas-Selfridge), with all modular exponentiation accelerated by Montgomery reduction.

For a detailed walkthrough of every file, the Montgomery math, and how all the pieces communicate, see [docs/Workflow.md](./docs/Workflow.md).

### Yield Strategies

When the math runs on a thread shared with other work, the search loop periodically yields control so the runtime can handle rendering, events, or I/O:

- **Browser main thread**: yields every 1000 candidates via `setTimeout(0)`
- **Server main thread**: yields every 5000 candidates via `setImmediate`
- **Dedicated worker threads**: never yields — the thread is exclusively ours

### Adaptive Execution

The `PrimeClient` estimates complexity as `digitLength³ × count` (approximating the O(k³) cost of modular exponentiation on k-bit numbers) and picks a mode:

- **Low/Medium Complexity**: Spawns a Web Worker.
- **High Complexity** (`> 1,000,000`): Sends a request to the Express server.
- **Fallback**: Main thread (only if Workers are unavailable).

Each mode falls back to the next one down if it fails.

## License

This project is licensed under the MIT License — see [LICENSE](./LICENSE).