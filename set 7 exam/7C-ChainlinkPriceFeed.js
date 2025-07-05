const { ethers } = require('ethers');

// ABI for Chainlink Aggregator
const aggregatorABI = [
    'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function decimals() view returns (uint8)',
    'function description() view returns (string)'
];

// Network configurations
const PRICE_FEED_ADDRESSES = {
    1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // ETH/USD on Mainnet
    137: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0', // MATIC/USD on Polygon
    56: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'   // BNB/USD on BSC
};

class PriceFeedReader {
    constructor(provider, networkId = 1, customAddress = null) {
        this.provider = provider;
        this.networkId = networkId;
        
        // Fix: Use network-specific address or custom address
        const feedAddress = customAddress || PRICE_FEED_ADDRESSES[networkId];
        if (!feedAddress) {
            throw new Error(`Price feed not supported for network ${networkId}`);
        }
        
        this.priceFeed = new ethers.Contract(
            feedAddress,
            aggregatorABI,
            provider
        );
        
        // Cache for optimization
        this.decimalsCache = null;
        this.lastUpdateTime = 0;
        this.cachedPrice = null;
        this.cacheTimeout = 60000; // 1 minute cache
    }
    
    async getDecimals() {
        if (!this.decimalsCache) {
            try {
                this.decimalsCache = await this.priceFeed.decimals();
            } catch (error) {
                console.error('Error fetching decimals:', error);
                this.decimalsCache = 8; // Default for most Chainlink feeds
            }
        }
        return this.decimalsCache;
    }
    
    async getPrice() {
        try {
            // Check cache first
            if (this.cachedPrice && (Date.now() - this.lastUpdateTime) < this.cacheTimeout) {
                return this.cachedPrice;
            }
            
            // Fix: Add proper error handling
            const roundData = await this.priceFeed.latestRoundData();
            
            // Fix: Add staleness check
            const staleness = this.checkDataStaleness(roundData.updatedAt);
            if (staleness.isStale) {
                console.warn(`Price data is stale: ${staleness.ageInMinutes} minutes old`);
                if (staleness.ageInMinutes > 60) { // More than 1 hour
                    throw new Error('Price data too stale to use');
                }
            }
            
            // Fix: Handle decimal conversion properly
            const decimals = await this.getDecimals();
            const price = Number(roundData.answer) / Math.pow(10, decimals);
            
            // Validate price
            if (price <= 0) {
                throw new Error('Invalid price received from oracle');
            }
            
            // Cache the result
            this.cachedPrice = {
                price: price,
                timestamp: Number(roundData.updatedAt),
                roundId: roundData.roundId.toString(),
                raw: roundData.answer.toString()
            };
            this.lastUpdateTime = Date.now();
            
            return this.cachedPrice;
            
        } catch (error) {
            console.error('Error fetching price:', error);
            
            // Return cached price if available and not too old
            if (this.cachedPrice && (Date.now() - this.lastUpdateTime) < 300000) { // 5 minutes
                console.warn('Using cached price due to fetch error');
                return this.cachedPrice;
            }
            
            throw new Error(`Failed to fetch price: ${error.message}`);
        }
    }
    
    checkDataStaleness(updatedAt) {
        const now = Math.floor(Date.now() / 1000);
        const ageInSeconds = now - Number(updatedAt);
        const ageInMinutes = ageInSeconds / 60;
        
        return {
            isStale: ageInMinutes > 5, // Consider stale if older than 5 minutes
            ageInMinutes: ageInMinutes,
            ageInSeconds: ageInSeconds
        };
    }
    
    async getPriceInUSD(amount) {
        try {
            const priceData = await this.getPrice();
            
            // Fix: Proper calculation with validation
            if (typeof amount !== 'number' || amount <= 0) {
                throw new Error('Invalid amount provided');
            }
            
            const totalValue = amount * priceData.price;
            
            return {
                amount: amount,
                pricePerUnit: priceData.price,
                totalValue: totalValue,
                timestamp: priceData.timestamp,
                currency: 'USD'
            };
            
        } catch (error) {
            console.error('Error calculating USD value:', error);
            throw new Error(`Failed to calculate USD value: ${error.message}`);
        }
    }
    
    // Additional utility methods
    async getPriceHistory(rounds = 5) {
        const history = [];
        const latestRound = await this.priceFeed.latestRoundData();
        
        for (let i = 0; i < rounds; i++) {
            try {
                const roundId = latestRound.roundId.sub(i);
                const roundData = await this.priceFeed.getRoundData(roundId);
                const decimals = await this.getDecimals();
                
                history.push({
                    roundId: roundId.toString(),
                    price: Number(roundData.answer) / Math.pow(10, decimals),
                    timestamp: Number(roundData.updatedAt)
                });
            } catch (error) {
                console.warn(`Failed to fetch round ${i}:`, error);
                break;
            }
        }
        
        return history;
    }
}

// Usage example with error handling
async function example() {
    try {
        const provider = new ethers.providers.JsonRpcProvider('YOUR_RPC_URL');
        const priceFeed = new PriceFeedReader(provider, 1); // Mainnet
        
        const priceData = await priceFeed.getPrice();
        console.log('Current ETH/USD Price:', priceData.price);
        
        const usdValue = await priceFeed.getPriceInUSD(1.5); // 1.5 ETH
        console.log('1.5 ETH in USD:', usdValue.totalValue);
        
    } catch (error) {
        console.error('Application error:', error);
    }
}