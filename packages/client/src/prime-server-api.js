export class PrimeServerAPI {
    constructor(serverUrl = '/api/primes') {
        this.serverUrl = serverUrl;
        this._abortController = null;
    }

    /**
     * Abort an in-flight generation request.
     * Safe to call even when no request is active.
     */
    abort() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    async generatePrimesProgressive(digitLength, count, onPrimeFound) {
        // Cancel any previous in-flight request before starting a new one
        this.abort();
        this._abortController = new AbortController();
        const { signal } = this._abortController;

        try {
            const response = await fetch(this.serverUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ digitLength, count }),
                signal
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete newline-delimited JSON objects
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep any incomplete tail in the buffer

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.type === 'prime' && onPrimeFound) {
                            onPrimeFound(BigInt(data.prime));
                        } else if (data.type === 'error') {
                            throw new Error(data.error);
                        }
                    } catch (parseError) {
                        // Surface parse errors so callers aren't silently missing primes
                        if (parseError instanceof SyntaxError) {
                            console.error('NDJSON parse error (skipping line):', parseError.message);
                        } else {
                            throw parseError;
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                // Graceful cancellation — not an error for callers
                return;
            }
            console.error('Server generation failed:', error);
            throw error;
        } finally {
            this._abortController = null;
        }
    }

    async generatePrimes(digitLength, count) {
        const primes = [];
        await this.generatePrimesProgressive(digitLength, count, (prime) => {
            primes.push(prime);
        });
        return primes;
    }
}