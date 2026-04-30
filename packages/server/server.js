import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import PrimeGeneratorServer from './prime-generator-server.js';

const app = express();
// Middleware
app.use(cors()); // Allows requests from frontend
app.use(express.json()); // Parses incoming JSON request bodies

// Serve built client
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, process.env.NODE_ENV === 'production' ? '../client/dist' : '../client');

app.use(express.static(CLIENT_DIR));

const PORT = 3000;

const generator = new PrimeGeneratorServer();

app.post('/api/primes', async (req, res) => {
    const { digitLength, count } = req.body;

    // Validate input with strict max constraints to prevent DoS
    if (!digitLength || !count || digitLength < 1 || count < 1 || digitLength > 500 || count > 100) {
        return res.status(400).json({
            type: 'error',
            error: 'Invalid digitLength or count. digitLength must be 1-500, count must be 1-100.'
        });
    }

    // Set headers for streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        await generator.generatePrimesProgressive(digitLength, count, (prime) => {
            // Stream each prime as it's found
            res.write(JSON.stringify({
                type: 'prime',
                prime: prime.toString()
            }) + '\n');
        });

        // Signal completion
        res.write(JSON.stringify({ type: 'complete' }) + '\n');
        res.end();
    } catch (error) {
        res.write(JSON.stringify({
            type: 'error',
            error: error.message
        }) + '\n');
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`Prime generation server running on http://localhost:${PORT}`);
});