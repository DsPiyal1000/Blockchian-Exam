class MultiChainWallet {
    constructor() {
        this.providers = {};
        this.signers = {};
        this.currentChain = null;
    }

    async connectChain(chainId) {
        // Validate chain ID format
        if (!/^0x[0-9a-f]+$/i.test(chainId)) throw "Invalid chain ID";
        
        // Switch network in wallet
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId }]
        });
        
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        this.providers[chainId] = provider;
        this.signers[chainId] = provider.getSigner();
        this.currentChain = chainId;
    }

    async sendCrossChain(fromChain, toChain, amount) {
        // Check provider existence
        if (!this.signers[fromChain]) throw "Chain not connected";
        
        // Verify balance
        const balance = await this.signers[fromChain].getBalance();
        if (balance.lt(amount)) throw "Insufficient balance";
        
        // Execute transaction
        const tx = await this.bridge.send(fromChain, toChain, amount);
        
        // Wait for confirmations
        const receipt = await tx.wait(2);
        return receipt.transactionHash;
    }
}