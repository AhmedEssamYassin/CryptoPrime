# CryptoPrime

CryptoPrime is a hybrid web application designed to generate cryptographically secure large prime numbers. It features an intelligent architecture that dynamically delegates computational tasks between the browser (using Main Thread or Web Workers) and a Node.js server based on the complexity of the request.

Built with a "Matrix-style" cyber-aesthetic, it ensures UI responsiveness while performing heavy mathematical operations.

## System Design (UML Diagram)
![UML Diagram](./docs/system%20design%20UML.svg)

## 🚀 Key Features

- **Cryptographically Secure**: Uses `crypto.getRandomValues()` (Browser) and Node.js crypto module for secure random number generation.

- **Miller-Rabin Primality Test**: Implements robust probabilistic primality testing for high accuracy.

- **Hybrid Architecture**: Automatically selects the best execution environment:
  - **Main Thread**: For small, instant calculations.
  - **Web Workers**: For medium loads (prevents UI freezing).
  - **Server-Side**: For heavy computational loads (delegated to Node.js backend).

- **Progressive Loading**: Streams results in real-time using chunked transfer encoding.

- **Responsive UI**: Cyber-themed interface with particle animations, pagination, and "click-to-copy" functionality.

- **Export Data**: Ability to export generated primes to `.txt` files.

## 🛠️ Tech Stack

**Frontend:**
- Vanilla JavaScript (ES Modules)
- Vite (Build tool & Dev Server)
- Web Workers (Multi-threading)
- CSS3 (Custom animations & responsiveness)

**Backend:**
- Node.js
- Express.js
- Shared Logic (Core math logic shared between client/server)

**Utilities:**
- Concurrently (Running client/server simultaneously)

## ⚡ Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/ahmedessamyassin/cryptoprime.git
cd cryptoprime
```

2. **Install Dependencies:**

You need to install dependencies for the root, the client, and the server.
```bash
# Install root dependencies
npm install

# Install Client dependencies
cd client
npm install

# Install Server dependencies
cd ../server
npm install
```

3. **Link Shared Logic:**

The client relies on the logic inside `server/shared`.

**Note:** Ensure the `client/shared` folder contains the files from `server/shared`. If they are missing, copy them manually or create a symbolic link.

### Running the Application

To run both the frontend (Vite) and backend (Express) simultaneously, run the following command from the root directory:
```bash
npm run dev
```

- **Frontend**: Accessible at `http://localhost:5173` (or the port assigned by Vite)
- **Backend**: Running at `http://localhost:3000`

## 🧠 How It Works

### The Core Logic (PrimeCore)

The mathematical core is isomorphic (runs in both Node and Browser). It generates random odd numbers based on the requested digit length and validates them using the Miller-Rabin primality test.

### Yield Strategies

To prevent the application from freezing during intensive loops, the system uses "Yield Strategies":

- **Browser**: Yields to the event loop every 1000 attempts (using `setTimeout`).
- **Server**: Yields every 5000 attempts (using `setImmediate`).
- **Worker**: Does not yield (dedicated thread).

### Adaptive Execution

The `PrimeClient` determines where to execute the code based on complexity (`digitLength * count`):

- **Low Complexity**: Runs on Main Thread.
- **Medium Complexity**: Spawns a Web Worker.
- **High Complexity**: Sends a request to the Express Server.

## 📝 License

This project is licensed under the MIT License. See the LICENSE file for details.