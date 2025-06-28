const WebSocket = require('ws');
const express = require('express');
const crypto = require('crypto');
const EventEmitter = require('events');

// Complete P2P Server Implementation
class P2PServer extends EventEmitter {
  constructor(blockchain, transactionPool) {
    super();
    this.blockchain = blockchain;
    this.transactionPool = transactionPool;
    this.sockets = [];
    this.peers = new Map();
    this.messageHandlers = new Map();
    this.setupMessageHandlers();
  }

  setupMessageHandlers() {
    this.messageHandlers.set('CHAIN', this.handleChainMessage.bind(this));
    this.messageHandlers.set('TRANSACTION', this.handleTransactionMessage.bind(this));
    this.messageHandlers.set('BLOCK', this.handleBlockMessage.bind(this));
    this.messageHandlers.set('PEER_REQUEST', this.handlePeerRequest.bind(this));
    this.messageHandlers.set('PEER_LIST', this.handlePeerList.bind(this));
    this.messageHandlers.set('CONSENSUS', this.handleConsensusMessage.bind(this));
  }

  listen(port) {
    const server = new WebSocket.Server({ port });
    console.log(`P2P Server listening on port ${port}`);

    server.on('connection', (socket, req) => {
      const peerAddress = req.socket.remoteAddress;
      console.log(`New peer connected: ${peerAddress}`);
      
      this.connectSocket(socket, peerAddress);
    });

    this.server = server;
  }

  connectToPeer(address) {
    const ws = new WebSocket(address);
    
    ws.on('open', () => {
      console.log(`Connected to peer: ${address}`);
      this.connectSocket(ws, address);
      
      // Request peer list from new connection
      this.sendToPeer(ws, { type: 'PEER_REQUEST' });
    });

    ws.on('error', (error) => {
      console.error(`Failed to connect to ${address}:`, error.message);
    });
  }

  connectSocket(socket, address) {
    const peerId = crypto.randomUUID();
    const peerInfo = {
      id: peerId,
      address: address,
      socket: socket,
      connectedAt: new Date(),
      lastSeen: Date.now()
    };

    this.sockets.push(socket);
    this.peers.set(peerId, peerInfo);

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(socket, message, peerId);
      } catch (error) {
        console.error('Invalid message received:', error.message);
      }
    });

    socket.on('close', () => {
      console.log(`Peer disconnected: ${address}`);
      this.sockets = this.sockets.filter(s => s !== socket);
      this.peers.delete(peerId);
    });

    socket.on('error', (error) => {
      console.error(`Socket error from ${address}:`, error.message);
    });

    // Send current blockchain to new peer
    this.sendToPeer(socket, {
      type: 'CHAIN',
      chain: this.blockchain.chain
    });
  }

  handleMessage(socket, message, peerId) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(socket, message, peerId);
    } else {
      console.warn(`Unknown message type: ${message.type}`);
    }

    // Update last seen timestamp
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastSeen = Date.now();
    }
  }

  handleChainMessage(socket, message, peerId) {
    const receivedChain = message.chain;
    
    if (this.blockchain.isValidChain(receivedChain) && 
        receivedChain.length > this.blockchain.chain.length) {
      
      console.log('Replacing blockchain with longer valid chain');
      this.blockchain.replaceChain(receivedChain);
      this.emit('chainReplaced', receivedChain);
    }
  }

  handleTransactionMessage(socket, message, peerId) {
    const transaction = message.transaction;
    
    if (this.transactionPool.validTransaction(transaction)) {
      this.transactionPool.updateOrAddTransaction(transaction);
      this.emit('transactionReceived', transaction);
      
      // Propagate to other peers (except sender)
      this.broadcastTransaction(transaction, peerId);
    }
  }

  handleBlockMessage(socket, message, peerId) {
    const block = message.block;
    
    if (this.blockchain.isValidBlock(block)) {
      this.blockchain.addBlock(block);
      this.transactionPool.clear();
      this.emit('blockReceived', block);
      
      // Propagate to other peers (except sender)
      this.broadcastBlock(block, peerId);
    }
  }

  handlePeerRequest(socket, message, peerId) {
    const peerList = Array.from(this.peers.values()).map(peer => ({
      id: peer.id,
      address: peer.address
    }));

    this.sendToPeer(socket, {
      type: 'PEER_LIST',
      peers: peerList
    });
  }

  handlePeerList(socket, message, peerId) {
    message.peers.forEach(peer => {
      if (!this.isPeerConnected(peer.address)) {
        this.connectToPeer(peer.address);
      }
    });
  }

  handleConsensusMessage(socket, message, peerId) {
    // Implement consensus mechanism (Proof of Work, Proof of Stake, etc.)
    switch (message.consensusType) {
      case 'POW':
        this.handleProofOfWork(message);
        break;
      case 'POS':
        this.handleProofOfStake(message);
        break;
    }
  }

  broadcastChain() {
    this.broadcast({
      type: 'CHAIN',
      chain: this.blockchain.chain
    });
  }

  broadcastTransaction(transaction, excludePeerId = null) {
    this.broadcast({
      type: 'TRANSACTION',
      transaction: transaction
    }, excludePeerId);
  }

  broadcastBlock(block, excludePeerId = null) {
    this.broadcast({
      type: 'BLOCK',
      block: block
    }, excludePeerId);
  }

  broadcast(message, excludePeerId = null) {
    this.peers.forEach((peer, peerId) => {
      if (peerId !== excludePeerId && peer.socket.readyState === WebSocket.OPEN) {
        this.sendToPeer(peer.socket, message);
      }
    });
  }

  sendToPeer(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  isPeerConnected(address) {
    return Array.from(this.peers.values()).some(peer => peer.address === address);
  }

  getConnectedPeers() {
    return Array.from(this.peers.values()).map(peer => ({
      id: peer.id,
      address: peer.address,
      connectedAt: peer.connectedAt,
      lastSeen: new Date(peer.lastSeen)
    }));
  }

  // Consensus mechanism - Proof of Work
  handleProofOfWork(message) {
    const { blockCandidate, difficulty } = message;
    
    if (this.blockchain.validateProofOfWork(blockCandidate, difficulty)) {
      this.blockchain.addBlock(blockCandidate);
      this.broadcastBlock(blockCandidate);
    }
  }

  // Consensus mechanism - Proof of Stake
  handleProofOfStake(message) {
    const { validator, stake, blockCandidate } = message;
    
    if (this.blockchain.validateStake(validator, stake)) {
      this.blockchain.addBlock(blockCandidate);
      this.broadcastBlock(blockCandidate);
    }
  }

  // Cleanup stale connections
  cleanupStaleConnections() {
    const now = Date.now();
    const staleThreshold = 300000; // 5 minutes

    this.peers.forEach((peer, peerId) => {
      if (now - peer.lastSeen > staleThreshold) {
        console.log(`Removing stale peer: ${peer.address}`);
        peer.socket.terminate();
        this.peers.delete(peerId);
        this.sockets = this.sockets.filter(s => s !== peer.socket);
      }
    });
  }

  startCleanupTimer() {
    setInterval(() => this.cleanupStaleConnections(), 60000); // Check every minute
  }
}

// Enhanced Blockchain Class with Consensus
class EnhancedBlockchain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.difficulty = 4;
    this.miningReward = 10;
    this.consensusType = 'POW'; // POW or POS
  }

  createGenesisBlock() {
    return {
      index: 0,
      timestamp: Date.now(),
      transactions: [],
      previousHash: '0',
      hash: this.calculateHash(0, Date.now(), [], '0', 0),
      nonce: 0,
      validator: null
    };
  }

  calculateHash(index, timestamp, transactions, previousHash, nonce) {
    return crypto
      .createHash('sha256')
      .update(index + timestamp + JSON.stringify(transactions) + previousHash + nonce)
      .digest('hex');
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addBlock(newBlock) {
    if (this.isValidBlock(newBlock)) {
      this.chain.push(newBlock);
      return true;
    }
    return false;
  }

  isValidBlock(block) {
    const previousBlock = this.getLatestBlock();
    
    // Check if previous hash matches
    if (block.previousHash !== previousBlock.hash) {
      return false;
    }

    // Check if hash is valid
    const recalculatedHash = this.calculateHash(
      block.index,
      block.timestamp,
      block.transactions,
      block.previousHash,
      block.nonce
    );

    if (block.hash !== recalculatedHash) {
      return false;
    }

    // Check proof of work
    if (this.consensusType === 'POW') {
      return this.validateProofOfWork(block, this.difficulty);
    }

    return true;
  }

  isValidChain(chain) {
    if (JSON.stringify(chain[0]) !== JSON.stringify(this.createGenesisBlock())) {
      return false;
    }

    for (let i = 1; i < chain.length; i++) {
      const currentBlock = chain[i];
      const previousBlock = chain[i - 1];

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }

      if (!this.isValidBlock(currentBlock)) {
        return false;
      }
    }

    return true;
  }

  replaceChain(newChain) {
    if (newChain.length <= this.chain.length) {
      console.log('Received chain is not longer than current chain');
      return false;
    }

    if (!this.isValidChain(newChain)) {
      console.log('Received chain is invalid');
      return false;
    }

    console.log('Replacing blockchain with new chain');
    this.chain = newChain;
    return true;
  }

  validateProofOfWork(block, difficulty) {
    return block.hash.substring(0, difficulty) === Array(difficulty + 1).join('0');
  }

  validateStake(validator, stake) {
    // Simplified stake validation - in real implementation, 
    // check validator's actual stake in the network
    return stake > 0 && validator && validator.length > 0;
  }

  async mineBlock(transactions, minerAddress) {
    return new Promise((resolve) => {
      const block = {
        index: this.chain.length,
        timestamp: Date.now(),
        transactions: transactions,
        previousHash: this.getLatestBlock().hash,
        nonce: 0
      };

      console.log(`Mining block ${block.index}...`);
      const startTime = Date.now();

      const mineStep = () => {
        const stepStartTime = Date.now();
        
        while (Date.now() - stepStartTime < 50) { // Mine for max 50ms per step
          block.hash = this.calculateHash(
            block.index,
            block.timestamp,
            block.transactions,
            block.previousHash,
            block.nonce
          );

          if (this.validateProofOfWork(block, this.difficulty)) {
            const miningTime = Date.now() - startTime;
            console.log(`Block mined in ${miningTime}ms with nonce: ${block.nonce}`);
            
            block.validator = minerAddress;
            resolve(block);
            return;
          }
          
          block.nonce++;
        }
        
        // Continue mining in next tick to prevent blocking
        setImmediate(mineStep);
      };
      
      mineStep();
    });
  }

  getBalance(address) {
    let balance = 0;

    for (const block of this.chain) {
      for (const transaction of block.transactions) {
        if (transaction.from === address) {
          balance -= transaction.amount;
        }
        if (transaction.to === address) {
          balance += transaction.amount;
        }
      }
    }

    return balance;
  }
}

// Transaction Pool Management
class TransactionPool {
  constructor() {
    this.transactions = [];
    this.maxPoolSize = 1000;
  }

  updateOrAddTransaction(transaction) {
    const existingTransaction = this.transactions.find(t => t.id === transaction.id);
    
    if (existingTransaction) {
      // Update existing transaction
      Object.assign(existingTransaction, transaction);
    } else {
      // Add new transaction
      if (this.transactions.length >= this.maxPoolSize) {
        // Remove oldest transaction
        this.transactions.shift();
      }
      this.transactions.push(transaction);
    }
  }

  validTransaction(transaction) {
    // Basic validation
    if (!transaction.from || !transaction.to || !transaction.amount) {
      return false;
    }

    if (transaction.amount <= 0) {
      return false;
    }

    // Check for duplicate transactions
    const duplicate = this.transactions.find(t => 
      t.from === transaction.from && 
      t.to === transaction.to && 
      t.amount === transaction.amount &&
      t.timestamp === transaction.timestamp
    );

    return !duplicate;
  }

  getValidTransactions() {
    return this.transactions.filter(transaction => this.validTransaction(transaction));
  }

  clear() {
    this.transactions = [];
  }

  getTransactionsByAddress(address) {
    return this.transactions.filter(t => t.from === address || t.to === address);
  }

  removeTransaction(transactionId) {
    this.transactions = this.transactions.filter(t => t.id !== transactionId);
  }

  getPoolSize() {
    return this.transactions.length;
  }
}

// Complete Blockchain Node Implementation
class BlockchainNode extends EventEmitter {
  constructor() {
    super();
    this.blockchain = new EnhancedBlockchain();
    this.transactionPool = new TransactionPool();
    this.wallet = this.generateWallet();
    this.isMining = false;
    this.setupEventHandlers();
  }

  generateWallet() {
    const privateKey = crypto.randomBytes(32);
    const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex');
    
    return {
      privateKey: privateKey.toString('hex'),
      publicKey: publicKey,
      address: publicKey.substring(0, 34) // Simplified address generation
    };
  }

  setupEventHandlers() {
    // Handle new transactions from P2P network
    this.on('transactionReceived', (transaction) => {
      console.log(`Received transaction: ${transaction.id}`);
      this.transactionPool.updateOrAddTransaction(transaction);
    });

    // Handle new blocks from P2P network
    this.on('blockReceived', (block) => {
      console.log(`Received block: ${block.index}`);
      this.stopMining(); // Stop current mining if block received
    });

    // Handle chain replacement
    this.on('chainReplaced', (newChain) => {
      console.log('Blockchain replaced with longer chain');
      this.transactionPool.clear(); // Clear transaction pool
    });
  }

  startServer(httpPort, p2pPort) {
    // Initialize P2P server
    this.p2pServer = new P2PServer(this.blockchain, this.transactionPool);
    
    // Forward P2P events to blockchain node
    this.p2pServer.on('transactionReceived', (transaction) => {
      this.emit('transactionReceived', transaction);
    });
    
    this.p2pServer.on('blockReceived', (block) => {
      this.emit('blockReceived', block);
    });
    
    this.p2pServer.on('chainReplaced', (chain) => {
      this.emit('chainReplaced', chain);
    });

    // Start P2P server
    this.p2pServer.listen(p2pPort);
    this.p2pServer.startCleanupTimer();

    // Setup HTTP API
    this.setupHTTPAPI();
    
    // Start HTTP server
    this.httpServer = this.app.listen(httpPort, () => {
      console.log(`HTTP API server listening on port ${httpPort}`);
      console.log(`Node address: ${this.wallet.address}`);
      console.log(`Node ready to accept connections`);
    });

    // Start auto-mining if enabled
    this.startAutoMining();
  }

  setupHTTPAPI() {
    this.app = express();
    this.app.use(express.json());

    // Get blockchain
    this.app.get('/api/blockchain', (req, res) => {
      res.json({
        chain: this.blockchain.chain,
        length: this.blockchain.chain.length
      });
    });

    // Get specific block
    this.app.get('/api/blocks/:index', (req, res) => {
      const blockIndex = parseInt(req.params.index);
      const block = this.blockchain.chain[blockIndex];
      
      if (block) {
        res.json(block);
      } else {
        res.status(404).json({ error: 'Block not found' });
      }
    });

    // Submit transaction
    this.app.post('/api/transactions', (req, res) => {
      try {
        const { from, to, amount } = req.body;
        
        const transaction = {
          id: crypto.randomUUID(),
          from: from || this.wallet.address,
          to,
          amount: parseFloat(amount),
          timestamp: Date.now(),
          signature: this.signTransaction({ from, to, amount })
        };

        this.transactionPool.updateOrAddTransaction(transaction);
        this.p2pServer.broadcastTransaction(transaction);

        res.status(201).json({
          message: 'Transaction submitted',
          transaction
        });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get transaction pool
    this.app.get('/api/transactions/pool', (req, res) => {
      res.json({
        transactions: this.transactionPool.transactions,
        count: this.transactionPool.getPoolSize()
      });
    });

    // Mine block
    this.app.post('/api/mine', async (req, res) => {
      try {
        if (this.isMining) {
          return res.status(400).json({ error: 'Mining already in progress' });
        }

        const block = await this.mineBlock();
        res.json({
          message: 'Block mined successfully',
          block
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get balance
    this.app.get('/api/balance/:address?', (req, res) => {
      const address = req.params.address || this.wallet.address;
      const balance = this.blockchain.getBalance(address);
      
      res.json({
        address,
        balance
      });
    });

    // Get peers
    this.app.get('/api/peers', (req, res) => {
      res.json({
        peers: this.p2pServer.getConnectedPeers(),
        count: this.p2pServer.peers.size
      });
    });

    // Connect to peer
    this.app.post('/api/peers', (req, res) => {
      const { address } = req.body;
      
      try {
        this.p2pServer.connectToPeer(address);
        res.json({ message: `Connecting to peer: ${address}` });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get node info
    this.app.get('/api/info', (req, res) => {
      res.json({
        nodeAddress: this.wallet.address,
        chainLength: this.blockchain.chain.length,
        pendingTransactions: this.transactionPool.getPoolSize(),
        connectedPeers: this.p2pServer.peers.size,
        difficulty: this.blockchain.difficulty,
        isMining: this.isMining,
        consensusType: this.blockchain.consensusType
      });
    });

    // Sync with peers
    this.app.post('/api/sync', (req, res) => {
      this.p2pServer.broadcastChain();
      res.json({ message: 'Sync initiated' });
    });
  }

  async mineBlock() {
    if (this.isMining) {
      throw new Error('Mining already in progress');
    }

    if (this.transactionPool.getPoolSize() === 0) {
      throw new Error('No transactions to mine');
    }

    this.isMining = true;
    
    try {
      const transactions = this.transactionPool.getValidTransactions();
      
      // Add mining reward transaction
      const rewardTransaction = {
        id: crypto.randomUUID(),
        from: null, // Mining reward
        to: this.wallet.address,
        amount: this.blockchain.miningReward,
        timestamp: Date.now()
      };
      
      transactions.push(rewardTransaction);

      const block = await this.blockchain.mineBlock(transactions, this.wallet.address);
      
      this.blockchain.addBlock(block);
      this.transactionPool.clear();
      
      // Broadcast new block to peers
      this.p2pServer.broadcastBlock(block);
      
      console.log(`Successfully mined block ${block.index}`);
      return block;
      
    } finally {
      this.isMining = false;
    }
  }

  stopMining() {
    this.isMining = false;
  }

  startAutoMining() {
    setInterval(async () => {
      if (!this.isMining && this.transactionPool.getPoolSize() > 0) {
        try {
          console.log('Auto-mining triggered...');
          await this.mineBlock();
        } catch (error) {
          console.error('Auto-mining failed:', error.message);
        }
      }
    }, 30000); // Try to mine every 30 seconds
  }

  signTransaction(transaction) {
    // Simplified signature - in real implementation, use proper cryptographic signatures
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(transaction) + this.wallet.privateKey)
      .digest('hex');
    return hash;
  }

  connectToPeers(peerAddresses) {
    peerAddresses.forEach(address => {
      this.p2pServer.connectToPeer(address);
    });
  }

  getNodeStats() {
    return {
      nodeAddress: this.wallet.address,
      chainLength: this.blockchain.chain.length,
      pendingTransactions: this.transactionPool.getPoolSize(),
      connectedPeers: this.p2pServer.peers.size,
      totalBalance: this.blockchain.getBalance(this.wallet.address),
      difficulty: this.blockchain.difficulty,
      isMining: this.isMining,
      uptime: process.uptime()
    };
  }
}

// Usage Example
const node = new BlockchainNode();

// Start the node
node.startServer(3001, 5001);

// Connect to other peers (if any)
const peerAddresses = [
  'ws://localhost:5002',
  'ws://localhost:5003'
];

setTimeout(() => {
  node.connectToPeers(peerAddresses);
}, 2000);

// Export for use in other modules
module.exports = {
  BlockchainNode,
  P2PServer,
  EnhancedBlockchain,
  TransactionPool
};