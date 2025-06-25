const { ethers } = require('ethers');

const ROUTER_ABI = [
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

const ROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

async function swapTokens(tokenA, tokenB, amountIn, slippagePercent = 2) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        
        const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
        
        const path = [tokenA, tokenB];
        const amountsOut = await router.getAmountsOut(amountIn, path);
        const amountOutMin = amountsOut[1].mul(100 - slippagePercent).div(100);
        
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
        
        const tokenContract = new ethers.Contract(tokenA, [
            "function approve(address spender, uint256 amount) external returns (bool)",
            "function allowance(address owner, address spender) external view returns (uint256)"
        ], signer);
        
        const currentAllowance = await tokenContract.allowance(signer.address, ROUTER_ADDRESS);
        if (currentAllowance.lt(amountIn)) {
            console.log("Approving token spending...");
            const approveTx = await tokenContract.approve(ROUTER_ADDRESS, amountIn);
            await approveTx.wait();
        }
        

        console.log(`Swapping ${ethers.utils.formatEther(amountIn)} tokens...`);
        const tx = await router.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            signer.address,
            deadline,
            {
                gasLimit: 200000, 
                gasPrice: ethers.utils.parseUnits('20', 'gwei')
            }
        );
        
        console.log(`Transaction hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`Swap completed in block ${receipt.blockNumber}`);
        
        return {
            success: true,
            txHash: tx.hash,
            receipt: receipt
        };
        
    } catch (error) {
        console.error("Swap failed:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Usage example
async function main() {
    const USDC = "0xA0b86a33E6412a8D94F8f2D9EDfD65Cf3e4E6c8F"; // Example USDC address
    const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH address
    const amount = ethers.utils.parseUnits("100", 6); // 100 USDC
    
    const result = await swapTokens(USDC, WETH, amount, 2); // 2% slippage
    console.log("Result:", result);
}

module.exports = { swapTokens };