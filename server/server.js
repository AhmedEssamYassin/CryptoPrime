const express = require('express');
const cors = require('cors');

const PrimeGeneratorServer = require('./prime-generator-server');

const app = express();
// Middleware
app.use(cors()); // Allows requests from frontend
app.use(express.json()); // Parses incoming JSON request bodies

const PORT = 3000;

const generator = new PrimeGeneratorServer();

app.post('/api/primes', async (req, res) => {
    const { digitLength, count } = req.body;

    // Validate input
    if (!digitLength || !count || digitLength < 1 || count < 1) {
        return res.status(400).json({
            type: 'error',
            error: 'Invalid digitLength or count'
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
    console.log(`Prime generation server running on port ${PORT}`);
});