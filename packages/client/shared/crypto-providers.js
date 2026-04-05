// crypto-providers.js - Works in BOTH browser and Node.js

// Browser crypto provider
class BrowserCryptoProvider {
    getRandomBytes(bytes) {
        const buf = new Uint8Array(bytes);
        crypto.getRandomValues(buf);
        return buf;
    }

    bufferToHex(buf) {
        return [...buf].map(x => x.toString(16).padStart(2, '0')).join('');
    }
}

// Node.js crypto provider
class NodeCryptoProvider {
    constructor(cryptoModule) {
        this.crypto = cryptoModule;
    }

    getRandomBytes(bytes) {
        return this.crypto.randomBytes(bytes);
    }

    bufferToHex(buf) {
        return buf.toString('hex');
    }
}

// Universal export
if (typeof module !== 'undefined' && module.exports) {
    // Node.js (CommonJS)
    module.exports = { BrowserCryptoProvider, NodeCryptoProvider };
}

export { BrowserCryptoProvider, NodeCryptoProvider };