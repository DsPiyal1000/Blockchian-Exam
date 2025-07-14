import { ethers } from 'ethers';  
import pLimit from 'p-limit';  
  
class OptimizedBlockchainDataFetcher {  
  constructor(provider, options = {}) {  
    this.provider = provider;  
    this.cache = new Map();  
    this.contractCache = new Map();  
      
    // Configuration  
    this.concurrencyLimit = options.concurrencyLimit || 10;  
    this.cacheTimeout = options.cacheTimeout || 300000; // 5 minutes  
    this.batchSize = options.batchSize || 100;  
      
    // Rate limiting  
    this.limit = pLimit(this.concurrencyLimit);  
      
    // Multicall contract for batch operations  
    this.multicallAddress = options.multicallAddress || '0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441';  
    this.multicallABI = [  
      'function aggregate(tuple(address target, bytes callData)[] calls) returns (uint256 blockNumber, bytes[] returnData)'  
    ];  
  }  
  
  // Optimized token fetching with parallel requests and multicall  
  async getAllUserTokens(userAddress, tokenList) {  
    const multicall = new ethers.Contract(  
      this.multicallAddress,  
      this.multicallABI,  
      this.provider  
    );  
  
    // Prepare batch calls  
    const calls = tokenList.map(tokenAddress => ({  
      target: tokenAddress,  
      callData: this.encodeBalanceOf(userAddress)  
    }));  
  
    // Execute in batches to avoid gas limits  
    const results = [];  
    for (let i = 0; i < calls.length; i += this.batchSize) {  
      const batch = calls.slice(i, i + this.batchSize);  
      const [, returnData] = await multicall.aggregate(batch);  
      results.push(...returnData);  
    }  
  
    // Process results  
    const tokens = [];  
    const promises = results.map((data, index) =>   
      this.limit(async () => {  
        try {  
          const balance = ethers.utils.defaultAbiCoder.decode(['uint256'], data)[0];  
            
          if (balance.gt(0)) {  
            // Get token metadata in parallel  
            const tokenAddress = tokenList[index];  
            const contract = this.getContractInstance(tokenAddress);  
              
            const [symbol, decimals, name] = await Promise.all([  
              this.getCachedCall(tokenAddress, 'symbol', () => contract.symbol()),  
              this.getCachedCall(tokenAddress, 'decimals', () => contract.decimals()),  
              this.getCachedCall(tokenAddress, 'name', () => contract.name())  
            ]);  
  
            tokens.push({  
              address: tokenAddress,  
              balance: balance.toString(),  
              symbol,  
              decimals,  
              name,  
              formattedBalance: ethers.utils.formatUnits(balance, decimals)  
            });  
          }  
        } catch (error) {  
          console.error(`Error fetching token ${tokenList[index]}:`, error);  
        }  
      })  
    );  
  
    await Promise.all(promises);  
      
    // Sort by balance descending  
    return tokens.sort((a, b) =>   
      BigInt(b.balance) > BigInt(a.balance) ? 1 : -1  
    );  
  }  
  
  // Optimized historical data fetching with caching and batch requests  
  async getHistoricalData(blockNumbers) {  
    // Check cache first  
    const uncachedBlocks = [];  
    const cachedData = new Map();  
  
    for (const blockNumber of blockNumbers) {  
      const cacheKey = `block-${blockNumber}`;  
      const cached = this.getFromCache(cacheKey);  
        
      if (cached) {  
        cachedData.set(blockNumber, cached);  
      } else {  
        uncachedBlocks.push(blockNumber);  
      }  
    }  
  
    // Fetch uncached blocks in parallel with rate limiting  
    const fetchPromises = uncachedBlocks.map(blockNumber =>  
      this.limit(async () => {  
        try {  
          const block = await this.provider.getBlock(blockNumber);  
          const cacheKey = `block-${blockNumber}`;  
            
          // Cache the block data  
          this.setCache(cacheKey, block);  
            
          return { blockNumber, block };  
        } catch (error) {  
          console.error(`Error fetching block ${blockNumber}:`, error);  
          return { blockNumber, block: null };  
        }  
      })  
    );  
  
    const fetchedBlocks = await Promise.all(fetchPromises);  
  
    // Combine cached and fetched data  
    const allBlocks = new Map(cachedData);  
    fetchedBlocks.forEach(({ blockNumber, block }) => {  
      if (block) {  
        allBlocks.set(blockNumber, block);  
      }  
    });  
  
    // Return in original order  
    return blockNumbers  
      .map(blockNumber => allBlocks.get(blockNumber))  
      .filter(block => block !== null);  
  }  
  
  // Helper method to encode balanceOf call  
  encodeBalanceOf(address) {  
    const iface = new ethers.utils.Interface(['function balanceOf(address) returns (uint256)']);  
    return iface.encodeFunctionData('balanceOf', [address]);  
  }  
  
  // Contract instance caching  
  getContractInstance(address) {  
    if (!this.contractCache.has(address)) {  
      const contract = new ethers.Contract(  
        address,  
        [  
          'function symbol() returns (string)',  
          'function decimals() returns (uint8)',  
          'function name() returns (string)',  
          'function balanceOf(address) returns (uint256)'  
        ],  
        this.provider  
      );  
      this.contractCache.set(address, contract);  
    }  
    return this.contractCache.get(address);  
  }  
  
  // Cache management  
  getCachedCall(contractAddress, method, fetchFn) {  
    const cacheKey = `${contractAddress}-${method}`;  
    const cached = this.getFromCache(cacheKey);  
      
    if (cached !== null) {  
      return cached;  
    }  
  
    return fetchFn().then(result => {  
      this.setCache(cacheKey, result);  
      return result;  
    });  
  }  
  
  getFromCache(key) {  
    const cached = this.cache.get(key);  
    if (!cached) return null;  
      
    // Check if cache is expired  
    if (Date.now() - cached.timestamp > this.cacheTimeout) {  
      this.cache.delete(key);  
      return null;  
    }  
      
    return cached.data;  
  }  
  
  setCache(key, data) {  
    this.cache.set(key, {  
      data,  
      timestamp: Date.now()  
    });  
  }  
  
  // Cache cleanup  
  cleanupCache() {  
    const now = Date.now();  
    for (const [key, value] of this.cache.entries()) {  
      if (now - value.timestamp > this.cacheTimeout) {  
        this.cache.delete(key);  
      }  
    }  
  }  
  
  // Start periodic cache cleanup  
  startCacheCleanup(interval = 60000) {  
    setInterval(() => this.cleanupCache(), interval);  
  }  
}  
  
// Usage example  
const fetcher = new OptimizedBlockchainDataFetcher(provider, {  
  concurrencyLimit: 20,  
  cacheTimeout: 600000, // 10 minutes  
  batchSize: 150  
});  
  
// Start cache cleanup  
fetcher.startCacheCleanup();  
  
// Fetch tokens efficiently  
const tokens = await fetcher.getAllUserTokens(userAddress, TOKEN_LIST);  
  
// Fetch historical data with caching  
const historicalData = await fetcher.getHistoricalData(blockNumbers);  