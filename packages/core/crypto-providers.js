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

export { BrowserCryptoProvider, NodeCryptoProvider };