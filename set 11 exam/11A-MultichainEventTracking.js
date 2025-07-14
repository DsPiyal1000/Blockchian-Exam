// Event-Driven Architecture for Multi-Chain dApp  
class MultiChainEventTracker {  
  constructor() {  
    this.eventEmitter = new EventEmitter();  
    this.eventStore = new Map(); // Chain -> Events  
    this.replayQueue = [];  
    this.chainProviders = new Map();  
    this.eventFilters = new Map();  
    this.lastProcessedBlocks = new Map();  
  }  
  
  // Initialize chain connections  
  async initializeChain(chainId, providerUrl, contracts) {  
    const provider = new ethers.providers.JsonRpcProvider(providerUrl);  
    this.chainProviders.set(chainId, provider);  
      
    // Set up contract listeners for each chain  
    for (const contractConfig of contracts) {  
      const contract = new ethers.Contract(  
        contractConfig.address,  
        contractConfig.abi,  
        provider  
      );  
        
      // Store filter for replay capability  
      const filter = {  
        address: contractConfig.address,  
        topics: contractConfig.events.map(e =>   
          ethers.utils.id(e) // Event signature hash  
        )  
      };  
        
      this.eventFilters.set(`${chainId}-${contractConfig.address}`, filter);  
        
      // Set up real-time listeners  
      contractConfig.events.forEach(eventName => {  
        contract.on(eventName, (...args) => {  
          this.handleEvent(chainId, contractConfig.address, eventName, args);  
        });  
      });  
    }  
      
    // Initialize last processed block  
    const currentBlock = await provider.getBlockNumber();  
    this.lastProcessedBlocks.set(chainId, currentBlock);  
  }  
  
  // Handle incoming events with consistency checks  
  async handleEvent(chainId, contractAddress, eventName, args) {  
    const event = args[args.length - 1]; // Event object is last argument  
    const eventId = `${chainId}-${event.transactionHash}-${event.logIndex}`;  
      
    // Prevent duplicate processing  
    if (this.eventStore.has(eventId)) {  
      return;  
    }  
      
    // Create event object with metadata  
    const eventData = {  
      id: eventId,  
      chainId,  
      contractAddress,  
      eventName,  
      blockNumber: event.blockNumber,  
      transactionHash: event.transactionHash,  
      logIndex: event.logIndex,  
      timestamp: Date.now(),  
      data: args.slice(0, -1), // Event arguments without event object  
      confirmed: false  
    };  
      
    // Store event  
    this.eventStore.set(eventId, eventData);  
      
    // Emit for immediate processing  
    this.eventEmitter.emit('newEvent', eventData);  
      
    // Wait for confirmations  
    this.scheduleConfirmation(chainId, eventData);  
  }  
  
  // Ensure event finality with confirmations  
  async scheduleConfirmation(chainId, eventData) {  
    const provider = this.chainProviders.get(chainId);  
    const confirmations = 12; // Adjust based on chain  
      
    setTimeout(async () => {  
      const currentBlock = await provider.getBlockNumber();  
      const confirmationCount = currentBlock - eventData.blockNumber;  
        
      if (confirmationCount >= confirmations) {  
        eventData.confirmed = true;  
        this.eventEmitter.emit('eventConfirmed', eventData);  
      } else {  
        // Recheck later  
        this.scheduleConfirmation(chainId, eventData);  
      }  
    }, 15000); // Check every 15 seconds  
  }  
  
  // Event replay functionality  
  async replayEvents(chainId, fromBlock, toBlock) {  
    const provider = this.chainProviders.get(chainId);  
    const filters = Array.from(this.eventFilters.entries())  
      .filter(([key]) => key.startsWith(chainId))  
      .map(([, filter]) => filter);  
      
    for (const filter of filters) {  
      const logs = await provider.getLogs({  
        ...filter,  
        fromBlock,  
        toBlock  
      });  
        
      // Process logs in order  
      for (const log of logs) {  
        const eventData = {  
          id: `${chainId}-${log.transactionHash}-${log.logIndex}`,  
          chainId,  
          contractAddress: log.address,  
          blockNumber: log.blockNumber,  
          transactionHash: log.transactionHash,  
          logIndex: log.logIndex,  
          topics: log.topics,  
          data: log.data,  
          replayed: true,  
          confirmed: true // Historical events are confirmed  
        };  
          
        // Check if already processed  
        if (!this.eventStore.has(eventData.id)) {  
          this.eventStore.set(eventData.id, eventData);  
          this.eventEmitter.emit('replayedEvent', eventData);  
        }  
      }  
    }  
      
    // Update last processed block  
    this.lastProcessedBlocks.set(chainId, toBlock);  
  }  
  
  // Consistency check across chains  
  async ensureConsistency() {  
    const inconsistencies = [];  
      
    // Check for gaps in event sequences  
    for (const [chainId, lastBlock] of this.lastProcessedBlocks) {  
      const provider = this.chainProviders.get(chainId);  
      const currentBlock = await provider.getBlockNumber();  
        
      if (currentBlock - lastBlock > 100) {  
        inconsistencies.push({  
          chainId,  
          type: 'BLOCK_GAP',  
          lastProcessed: lastBlock,  
          current: currentBlock  
        });  
      }  
    }  
      
    // Check for unconfirmed events  
    const unconfirmedEvents = Array.from(this.eventStore.values())  
      .filter(event => !event.confirmed && Date.now() - event.timestamp > 300000);  
      
    if (unconfirmedEvents.length > 0) {  
      inconsistencies.push({  
        type: 'UNCONFIRMED_EVENTS',  
        events: unconfirmedEvents  
      });  
    }  
      
    return inconsistencies;  
  }  
  
  // Periodic consistency maintenance  
  async startConsistencyChecker(interval = 60000) {  
    setInterval(async () => {  
      const inconsistencies = await this.ensureConsistency();  
        
      if (inconsistencies.length > 0) {  
        // Handle inconsistencies  
        for (const issue of inconsistencies) {  
          if (issue.type === 'BLOCK_GAP') {  
            // Replay missed blocks  
            await this.replayEvents(  
              issue.chainId,  
              issue.lastProcessed + 1,  
              issue.current  
            );  
          }  
        }  
      }  
    }, interval);  
  }  
}  
  
// Usage example  
const tracker = new MultiChainEventTracker();  
  
// Initialize multiple chains  
await tracker.initializeChain('1', 'https://eth-mainnet.alchemyapi.io/v2/...', [  
  {  
    address: '0x...',  
    abi: ERC20_ABI,  
    events: ['Transfer', 'Approval']  
  }  
]);  
  
await tracker.initializeChain('137', 'https://polygon-mainnet.g.alchemy.com/v2/...', [  
  {  
    address: '0x...',  
    abi: BRIDGE_ABI,  
    events: ['Deposit', 'Withdrawal']  
  }  
]);  
  
// Start consistency checker  
tracker.startConsistencyChecker();  
  
// Listen for events  
tracker.eventEmitter.on('newEvent', (event) => {  
  console.log('New event:', event);  
});  
  
tracker.eventEmitter.on('eventConfirmed', (event) => {  
  console.log('Event confirmed:', event);  
});  