import { EventEmitter } from 'events';  
import Redis from 'ioredis';  
import { ethers } from 'ethers';  
import amqp from 'amqplib';  
import { PrismaClient } from '@prisma/client';  
  
class BlockchainMicroservices {  
  constructor() {  
    this.redis = new Redis();  
    this.prisma = new PrismaClient();  
    this.messageQueue = null;  
    this.services = {};  
  }  
  
  // Initialize message queue  
  async setupMessageQueue() {  
    const connection = await amqp.connect('amqp://localhost');  
    this.channel = await connection.createChannel();  
      
    // Create exchanges and queues  
    await this.channel.assertExchange('blockchain-events', 'topic', { durable: true });  
      
    const queues = [  
      'indexer-queue',  
      'transaction-queue',  
      'gas-queue',  
      'notification-queue'  
    ];  
      
    for (const queue of queues) {  
      await this.channel.assertQueue(queue, { durable: true });  
    }  
      
    return this.channel;  
  }  
  
  // 1. Blockchain Indexer Service  
  IndexerService = class extends EventEmitter {  
    constructor(config) {  
      super();  
      this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);  
      this.contracts = new Map();  
      this.indexedBlocks = new Set();  
      this.currentBlock = 0;  
      this.batchSize = config.batchSize || 100;  
    }  
  
    // Add contract to index  
    addContract(address, abi, startBlock = 0) {  
      const contract = new ethers.Contract(address, abi, this.provider);  
      this.contracts.set(address, { contract, abi, startBlock });  
    }  
  
    // Main indexing loop  
    async startIndexing() {  
      this.currentBlock = await this.getLastIndexedBlock();  
        
      while (true) {  
        try {  
          const latestBlock = await this.provider.getBlockNumber();  
            
          if (this.currentBlock < latestBlock) {  
            const toBlock = Math.min(  
              this.currentBlock + this.batchSize,  
              latestBlock  
            );  
              
            await this.indexBlockRange(this.currentBlock + 1, toBlock);  
            this.currentBlock = toBlock;  
              
            // Save progress  
            await this.saveProgress(toBlock);  
          }  
            
          // Wait for new blocks  
          await new Promise(resolve => setTimeout(resolve, 1000));  
        } catch (error) {  
          console.error('Indexing error:', error);  
          await new Promise(resolve => setTimeout(resolve, 5000));  
        }  
      }  
    }  
  
    // Index a range of blocks  
    async indexBlockRange(fromBlock, toBlock) {  
      const events = [];  
        
      // Get logs for all contracts  
      for (const [address, config] of this.contracts) {  
        if (config.startBlock > toBlock) continue;  
          
        const logs = await this.provider.getLogs({  
          address,  
          fromBlock: Math.max(fromBlock, config.startBlock),  
          toBlock  
        });  
          
        // Parse logs  
        for (const log of logs) {  
          try {  
            const parsed = config.contract.interface.parseLog(log);  
              
            const event = {  
              address,  
              blockNumber: log.blockNumber,  
              transactionHash: log.transactionHash,  
              logIndex: log.logIndex,  
              eventName: parsed.name,  
              args: parsed.args,  
              timestamp: Date.now()  
            };  
              
            events.push(event);  
          } catch (error) {  
            console.error('Error parsing log:', error);  
          }  
        }  
      }  
        
      // Store events in database  
      if (events.length > 0) {  
        await this.storeEvents(events);  
          
        // Publish to message queue  
        for (const event of events) {  
          await this.publishEvent(event);  
        }  
      }  
    }  
  
    // Store events in database  
    async storeEvents(events) {  
      const operations = events.map(event =>   
        this.prisma.blockchainEvent.create({  
          data: {  
            contractAddress: event.address,  
            blockNumber: event.blockNumber,  
            transactionHash: event.transactionHash,  
            logIndex: event.logIndex,  
            eventName: event.eventName,  
            eventData: JSON.stringify(event.args),  
            timestamp: new Date(event.timestamp)  
          }  
        })  
      );  
        
      await this.prisma.$transaction(operations);  
    }  
  
    // Publish event to message queue  
    async publishEvent(event) {  
      const routingKey = `event.${event.eventName.toLowerCase()}`;  
        
      await this.channel.publish(  
        'blockchain-events',  
        routingKey,  
        Buffer.from(JSON.stringify(event)),  
        { persistent: true }  
      );  
    }  
  
    // Query API  
    async queryEvents(filters) {  
      const where = {};  
        
      if (filters.contractAddress) {  
        where.contractAddress = filters.contractAddress;  
      }  
        
      if (filters.eventName) {  
        where.eventName = filters.eventName;  
      }  
        
      if (filters.fromBlock) {  
        where.blockNumber = { gte: filters.fromBlock };  
      }  
        
      if (filters.toBlock) {  
        where.blockNumber = { ...where.blockNumber, lte: filters.toBlock };  
      }  
        
      return await this.prisma.blockchainEvent.findMany({  
        where,  
        orderBy: { blockNumber: 'desc' },  
        take: filters.limit || 100  
      });  
    }  
  
    // Helper methods  
    async getLastIndexedBlock() {  
      const cached = await this.redis.get('last-indexed-block');  
      if (cached) return parseInt(cached);  
        
      const lastEvent = await this.prisma.blockchainEvent.findFirst({  
        orderBy: { blockNumber: 'desc' }  
      });  
        
      return lastEvent ? lastEvent.blockNumber : 0;  
    }  
  
    async saveProgress(blockNumber) {
      await this.redis.set('last-indexed-block', blockNumber);
    }
  }

  // 2. Transaction Builder Service
  TransactionService = class {
    constructor(config) {
      this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
      this.signer = new ethers.Wallet(config.privateKey, this.provider);
      this.nonceManager = new NonceManager();
      this.gasOracle = null; // Will be injected
    }
  
    // Build transaction with proper gas estimation  
    async buildTransaction(to, data, value = '0') {  
      // Get current nonce  
      const nonce = await this.nonceManager.getNonce(this.signer.address);  
        
      // Estimate gas  
      const gasEstimate = await this.estimateGas(to, data, value);  
        
      // Get gas price from gas service  
      const gasPrice = await this.gasOracle.getOptimalGasPrice();  
        
      const tx = {  
        to,  
        data,  
        value: ethers.utils.parseEther(value),  
        nonce,  
        gasLimit: gasEstimate.mul(110).div(100), // 10% buffer  
        gasPrice  
      };  
        
      return tx;  
    }  
  
    // Simulate transaction execution  
    async simulateTransaction(to, data, value = '0') {  
      try {  
        // Use eth_call to simulate  
        const result = await this.provider.call({  
          to,  
          data,  
          value: ethers.utils.parseEther(value),  
          from: this.signer.address  
        });  
          
        return {  
          success: true,  
          result,  
          revertReason: null  
        };  
      } catch (error) {  
        // Extract revert reason  
        const revertReason = this.extractRevertReason(error);  
          
        return {  
          success: false,  
          result: null,  
          revertReason  
        };  
      }  
    }  
  
    // Submit transaction to network  
    async submitTransaction(txData) {  
      // Simulate first  
      const simulation = await this.simulateTransaction(  
        txData.to,  
        txData.data,  
        ethers.utils.formatEther(txData.value || '0')  
      );  
        
      if (!simulation.success) {  
        throw new Error(`Transaction would revert: ${simulation.revertReason}`);  
      }  
        
      // Sign and send  
      const signedTx = await this.signer.signTransaction(txData);  
      const txResponse = await this.provider.sendTransaction(signedTx);  
        
      // Update nonce  
      this.nonceManager.incrementNonce(this.signer.address);  
        
      // Publish to message queue  
      await this.publishTransaction({  
        hash: txResponse.hash,  
        from: this.signer.address,  
        ...txData,  
        status: 'pending'  
      });  
        
      // Monitor transaction  
      this.monitorTransaction(txResponse.hash);  
        
      return txResponse;  
    }  
  
    // Monitor transaction status  
    async monitorTransaction(txHash) {  
      try {  
        const receipt = await this.provider.waitForTransaction(txHash, 1);  
          
        await this.publishTransaction({  
          hash: txHash,  
          status: receipt.status === 1 ? 'confirmed' : 'failed',  
          receipt  
        });  
      } catch (error) {  
        await this.publishTransaction({  
          hash: txHash,  
          status: 'failed',  
          error: error.message  
        });  
      }  
    }  
  
    // Helper methods  
    async estimateGas(to, data, value) {  
      return await this.provider.estimateGas({  
        to,  
        data,  
        value: ethers.utils.parseEther(value),  
        from: this.signer.address  
      });  
    }  
  
    extractRevertReason(error) {  
      if (error.reason) return error.reason;  
        
      const revertData = error.data;  
      if (!revertData) return 'Unknown error';  
        
      // Decode revert reason  
      const errorInterface = new ethers.utils.Interface([  
        'function Error(string)',  
        'function Panic(uint256)'  
      ]);  
        
      try {  
        const decoded = errorInterface.parseError(revertData);  
        return decoded.args[0];  
      } catch {  
        return revertData;  
      }  
    }  
  
    async publishTransaction(txData) {  
      await this.channel.publish(  
        'blockchain-events',  
        'transaction.update',  
        Buffer.from(JSON.stringify(txData)),  
        { persistent: true }  
      );  
    }  
  }  
  
  // 3. Gas Estimation Service  
  GasService = class {  
    constructor(config) {  
      this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);  
      this.historicalData = [];  
      this.predictions = new Map();  
      this.updateInterval = config.updateInterval || 15000;  
    }  
  
    // Start gas monitoring  
    async startMonitoring() {  
      await this.updateGasData();  
        
      setInterval(async () => {  
        await this.updateGasData();  
      }, this.updateInterval);  
    }  
  
    // Update gas data  
    async updateGasData() {  
      try {  
        const block = await this.provider.getBlock('latest');  
        const gasPrice = await this.provider.getGasPrice();  
          
        const dataPoint = {  
          blockNumber: block.number,  
          timestamp: block.timestamp,  
          baseFeePerGas: block.baseFeePerGas?.toString() || '0',  
          gasPrice: gasPrice.toString(),  
          gasUsed: block.gasUsed.toString(),  
          gasLimit: block.gasLimit.toString()  
        };  
          
        // Store in memory (limited)  
        this.historicalData.push(dataPoint);  
        if (this.historicalData.length > 1000) {  
          this.historicalData.shift();  
        }  
          
        // Store in Redis for persistence  
        await this.redis.zadd(  
          'gas-history',  
          block.timestamp,  
          JSON.stringify(dataPoint)  
        );  
          
        // Update predictions  
        await this.updatePredictions();  
          
        // Publish update  
        await this.publishGasUpdate(dataPoint);  
      } catch (error) {  
        console.error('Error updating gas data:', error);  
      }  
    }  
  
    // Get optimal gas price  
    async getOptimalGasPrice(speed = 'standard') {  
      const latest = await this.provider.getGasPrice();  
      const multipliers = {  
        slow: 0.9,  
        standard: 1.0,  
        fast: 1.2,  
        instant: 1.5  
      };  
        
      return latest.mul(Math.floor(multipliers[speed] * 100)).div(100);  
    }  
  
    // Suggest gas prices  
    async suggestGasPrices() {  
      const base = await this.getOptimalGasPrice();  
        
      return {  
        slow: await this.getOptimalGasPrice('slow'),  
        standard: base,  
        fast: await this.getOptimalGasPrice('fast'),  
        instant: await this.getOptimalGasPrice('instant'),  
        baseFee: await this.getBaseFee()  
      };  
    }  
  
    // Track gas trends  
    async getGasTrends(period = '1h') {  
      const now = Date.now() / 1000;  
      const periodSeconds = this.parsePeriod(period);  
      const start = now - periodSeconds;  
        
      const data = await this.redis.zrangebyscore(  
        'gas-history',  
        start,  
        now,  
        'WITHSCORES'  
      );  
        
      const points = [];  
      for (let i = 0; i < data.length; i += 2) {  
        points.push(JSON.parse(data[i]));  
      }  
        
      return this.analyzeTrends(points);  
    }  
  
    // Analyze trends  
    analyzeTrends(dataPoints) {  
      if (dataPoints.length < 2) {  
        return { trend: 'insufficient_data' };  
      }  
        
      const prices = dataPoints.map(p => BigInt(p.gasPrice));  
      const avgPrice = prices.reduce((a, b) => a + b, 0n) / BigInt(prices.length);  
        
      // Calculate trend  
      const firstHalf = prices.slice(0, Math.floor(prices.length / 2));  
      const secondHalf = prices.slice(Math.floor(prices.length / 2));  
        
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0n) / BigInt(firstHalf.length);  
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0n) / BigInt(secondHalf.length);  
        
      let trend = 'stable';  
      const change = Number(secondAvg - firstAvg) / Number(firstAvg);  
        
      if (change > 0.1) trend = 'increasing';  
      else if (change < -0.1) trend = 'decreasing';  
        
      return {  
        trend,  
        averageGasPrice: avgPrice.toString(),  
        minGasPrice: prices.reduce((a, b) => a < b ? a : b).toString(),  
        maxGasPrice: prices.reduce((a, b) => a > b ? a : b).toString(),  
        volatility: this.calculateVolatility(prices),  
        dataPoints: dataPoints.length  
      };  
    }  
  
    // Helper methods  
    async getBaseFee() {  
      const block = await this.provider.getBlock('latest');  
      return block.baseFeePerGas || ethers.BigNumber.from(0);  
    }  
  
    parsePeriod(period) {  
      const units = {  
        m: 60,  
        h: 3600,  
        d: 86400  
      };  
        
      const match = period.match(/(\d+)([mhd])/);  
      if (!match) return 3600; // Default 1 hour  
        
      return parseInt(match[1]) * units[match[2]];  
    }  
  
    calculateVolatility(prices) {  
      const mean = prices.reduce((a, b) => a + b, 0n) / BigInt(prices.length);  
      const variance = prices.reduce((sum, price) => {  
        const diff = price - mean;  
        return sum + (diff * diff) / BigInt(prices.length);  
      }, 0n);  
        
      // Simple volatility score 0-100  
      const stdDev = Math.sqrt(Number(variance));  
      const volatility = Math.min(100, (stdDev / Number(mean)) * 100);  
        
      return Math.round(volatility);  
    }  
  
    async updatePredictions() {  
      // Simple prediction based on recent trends  
      const trends = await this.getGasTrends('1h');  
        
      this.predictions.set('next_hour', {  
        gasPrice: trends.averageGasPrice,  
        confidence: 100 - trends.volatility  
      });  
    }  
  
    async publishGasUpdate(data) {  
      await this.channel.publish(  
        'blockchain-events',  
        'gas.update',  
        Buffer.from(JSON.stringify(data)),  
        { persistent: true }  
      );  
    }  
  }  
  
  // 4. Notification Service  
  NotificationService = class {  
    constructor(config) {  
      this.subscribers = new Map();  
      this.templates = new Map();  
      this.channels = config.channels || ['email', 'webhook', 'websocket'];  
    }  
  
    // Subscribe to notifications  
    subscribe(userId, eventType, channel, config) {  
      if (!this.subscribers.has(userId)) {  
        this.subscribers.set(userId, new Map());  
      }  
        
      const userSubs = this.subscribers.get(userId);  
      if (!userSubs.has(eventType)) {  
        userSubs.set(eventType, []);  
      }  
        
      userSubs.get(eventType).push({ channel, config });  
    }  
  
    // Process incoming events  
    async processEvent(event) {  
      const eventType = this.getEventType(event);  
        
      // Find subscribers for this event  
      for (const [userId, subscriptions] of this.subscribers) {  
        const subs = subscriptions.get(eventType);  
        if (!subs) continue;  
          
        for (const sub of subs) {  
          await this.sendNotification(userId, event, sub);  
        }  
      }  
    }  
  
    // Send notification  
    async sendNotification(userId, event, subscription) {  
      const { channel, config } = subscription;  
        
      switch (channel) {  
        case 'email':  
          await this.sendEmail(config.email, event);  
          break;  
            
        case 'webhook':  
          await this.sendWebhook(config.url, event);  
          break;  
            
        case 'websocket':  
          await this.sendWebsocket(userId, event);  
          break;  
      }  
    }  
  
    // Channel implementations  
    async sendEmail(email, event) {  
      // Email implementation  
      console.log(`Sending email to ${email}:`, event);  
    }  
  
    async sendWebhook(url, event) {  
      try {  
        await fetch(url, {  
          method: 'POST',  
          headers: { 'Content-Type': 'application/json' },  
          body: JSON.stringify(event)  
        });  
      } catch (error) {  
        console.error(`Webhook failed for ${url}:`, error);  
      }  
    }  
  
    async sendWebsocket(userId, event) {  
      // WebSocket implementation  
      if (typeof this.emit === 'function') {  
        this.emit('notification', { userId, event });  
      }  
    }  
  
    // Helper methods  
    getEventType(event) {  
      if (event.eventName) return `contract.${event.eventName}`;  
      if (event.hash) return 'transaction.update';  
      if (event.gasPrice) return 'gas.update';  
      return 'unknown';  
    }  
    }  
  
    // Initialize all services  
    async initialize() {  
      await this.setupMessageQueue();  
        
      // Initialize services  
      this.services.indexer = new this.IndexerService({  
        rpcUrl: process.env.RPC_URL,  
        batchSize: 100  
      });  
        
      this.services.transaction = new this.TransactionService({  
        rpcUrl: process.env.RPC_URL,  
        privateKey: process.env.PRIVATE_KEY  
      });  
        
      this.services.gas = new this.GasService({  
        rpcUrl: process.env.RPC_URL,  
        updateInterval: 15000  
      });  
        
      this.services.notification = new this.NotificationService({  
        channels: ['email', 'webhook', 'websocket']  
      });  
        
      // Inject dependencies  
      this.services.transaction.gasOracle = this.services.gas;  
        
      // Set up message queue consumers  
      await this.setupConsumers();  
        
      // Start services  
      await this.services.indexer.startIndexing();  
      await this.services.gas.startMonitoring();  
    }  
  
    // Set up message queue consumers  
    setupConsumers = async () => {  
      // Notification service consumes all events  
      await this.channel.bindQueue('notification-queue', 'blockchain-events', '#');  
        
      this.channel.consume('notification-queue', async (msg) => {  
        const event = JSON.parse(msg.content.toString());  
        await this.services.notification.processEvent(event);  
        this.channel.ack(msg);  
      });  
    }  
  }  
    
  // Nonce Manager for transaction service  
  class NonceManager {  
      constructor() {  
        this.nonces = new Map();  
        this.pending = new Map();  
        this.provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);  
      }  
  
    async getNonce(address) {  
      if (!this.nonces.has(address)) {  
        const nonce = await this.provider.getTransactionCount(address);  
        this.nonces.set(address, nonce);  
      }  
        
      let nonce = this.nonces.get(address);  
        
      // Check for pending transactions  
      const pending = this.pending.get(address) || 0;  
      nonce += pending;  
        
      this.pending.set(address, pending + 1);  
        
      return nonce;  
    }  
  
    incrementNonce(address) {  
      const current = this.nonces.get(address) || 0;  
      this.nonces.set(address, current + 1);  
        
      const pending = this.pending.get(address) || 0;  
      this.pending.set(address, Math.max(0, pending - 1));  
    }  
  }  
  
// Usage  
const microservices = new BlockchainMicroservices();  
(async () => {
  await microservices.initialize();
})();
  