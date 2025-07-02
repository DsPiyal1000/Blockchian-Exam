class CrossChainMessenger {
    constructor(config) {
        this.chains = config.chains; // { chainId: { provider, finality } }
        this.messageQueue = new Map(); // For ordered message handling
    }

    // Send message with nonce-based ordering
    async sendMessage(fromChainId, toChainId, message) {
        const provider = this.chains[fromChainId].provider;
        const signer = provider.getSigner();
        const nonce = Date.now(); // Unique nonce for ordering

        // Submit message with nonce
        const tx = await signer.sendTransaction({
            to: this.bridgeAddress,
            data: encodeMessage(toChainId, message, nonce)
        });

        // Handle chain finality
        const requiredConfirmations = this.chains[fromChainId].finality.confirmations;
        await tx.wait(requiredConfirmations);
        return { txHash: tx.hash, nonce };
    }

    // Receive messages in order
    async receiveMessage(toChainId, fromChainId, nonce) {
        const provider = this.chains[toChainId].provider;
        const bridge = new ethers.Contract(this.bridgeAddress, abi, provider);
        
        // Fetch message by nonce (ensures ordering)
        return await bridge.getMessage(fromChainId, nonce);
    }
}