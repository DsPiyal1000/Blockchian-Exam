class CrossChainDEX {
    constructor(config) {
        this.chains = config.chains;
        this.bridge = config.bridge;
    }

    async getQuote(fromToken, toToken, amount) {
        const sourceChain = this.chains[fromToken.chainId];
        const destChain = this.chains[toToken.chainId];
        
        // Calculate bridge fee
        const bridgeFee = await this.bridge.calculateFee(
            fromToken.chainId,
            toToken.chainId,
            amount
        );
        
        // Get destination swap quote
        const dexContract = new ethers.Contract(
            destChain.contracts.dex,
            DEX_ABI,
            destChain.provider
        );
        
        const swapQuote = await dexContract.getQuote(
            destChain.contracts.bridgeToken,
            toToken.address,
            amount.sub(bridgeFee)
        );
        
        return {
            outputAmount: swapQuote,
            bridgeFee,
            minOutput: swapQuote.mul(95).div(100) // 5% slippage
        };
    }

    async executeSwap(swapParams) {
        // 1. Approve bridge spending
        const sourceToken = new ethers.Contract(
            swapParams.fromToken.address,
            ERC20_ABI,
            this.chains[swapParams.fromChain].signer
        );
        
        await sourceToken.approve(
            this.bridge.address,
            swapParams.amount
        );
        
        // 2. Initiate cross-chain transfer
        const bridgeTx = await this.bridge.transfer(
            swapParams.fromChain,
            swapParams.toChain,
            swapParams.amount,
            swapParams.recipient
        );
        
        // 3. Wait for bridge completion
        const bridgeReceipt = await bridgeTx.wait();
        
        // 4. Execute swap on destination chain
        const destDex = new ethers.Contract(
            this.chains[swapParams.toChain].contracts.dex,
            DEX_ABI,
            this.chains[swapParams.toChain].signer
        );
        
        const swapTx = await destDex.swap(
            this.chains[swapParams.toChain].contracts.bridgeToken,
            swapParams.toToken.address,
            swapParams.minOutput,
            Math.floor(Date.now()/1000) + 300 // 5min deadline
        );
        
        return {
            bridgeTx: bridgeTx.hash,
            swapTx: swapTx.hash,
            swapId: `${bridgeTx.hash}-${swapTx.hash}`
        };
    }

    async trackSwapStatus(swapId) {
        const [bridgeHash, swapHash] = swapId.split('-');
        
        // Check bridge completion
        const bridgeReceipt = await this.bridge.provider.getTransactionReceipt(bridgeHash);
        if (!bridgeReceipt || bridgeReceipt.status !== 1) return "Bridge Failed";
        
        // Check swap status
        const swapReceipt = await this.chains[swapParams.toChain]
            .provider.getTransactionReceipt(swapHash);
        
        return swapReceipt 
            ? (swapReceipt.status === 1 ? "Completed" : "Swap Failed")
            : "Pending";
    }
}