export class PrimeServerAPI {
    constructor(serverUrl = '/api/primes') {
        this.serverUrl = serverUrl;
    }

    async generatePrimesProgressive(digitLength, count, onPrimeFound) {
        try {
            const response = await fetch(this.serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ digitLength, count })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            // Use streaming for progressive updates
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete JSON objects (newline-delimited)
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const data = JSON.parse(line);
                            if (data.type === 'prime' && onPrimeFound) {
                                onPrimeFound(BigInt(data.prime));
                            } else if (data.type === 'error') {
                                throw new Error(data.error);
                            }
                        } catch (parseError) {
                            console.error('Parse error:', parseError);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Server generation failed:', error);
            throw error;
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