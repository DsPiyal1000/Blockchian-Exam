const WebSocket = require('ws');
const EventEmitter = require('events');

class BlockchainWebSocketServer extends EventEmitter {
  constructor(server) {
    super();
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map();
    this.setupWebSocketHandlers();
  }

  setupWebSocketHandlers() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      const clientInfo = {
        id: clientId,
        socket: ws,
        subscriptions: new Set(),
        connectedAt: new Date(),
        lastPing: Date.now()
      };

      this.clients.set(clientId, clientInfo);
      console.log(`Client ${clientId} connected. Total clients: ${this.clients.size}`);

      ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        timestamp: Date.now()
      }));

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleClientMessage(clientId, message);
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`Client ${clientId} disconnected. Remaining: ${this.clients.size}`);
      });

      ws.on('pong', () => {
        clientInfo.lastPing = Date.now();
      });
    });

    setInterval(() => this.cleanupStaleConnections(), 30000);
  }

  handleClientMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        this.handleSubscription(clientId, message.channels);
        break;
      case 'unsubscribe':
        this.handleUnsubscription(clientId, message.channels);
        break;
      case 'ping':
        client.socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
    }
  }

  handleSubscription(clientId, channels) {
    const client = this.clients.get(clientId);
    if (!client) return;

    channels.forEach(channel => {
      client.subscriptions.add(channel);
    });

    client.socket.send(JSON.stringify({
      type: 'subscription_success',
      channels: Array.from(client.subscriptions)
    }));
  }

  broadcastNewBlock(block) {
    const blockNotification = {
      type: 'new_block',
      data: {
        blockNumber: block.index,
        hash: block.hash,
        previousHash: block.previousHash,
        timestamp: block.timestamp,
        transactionCount: block.transactions.length,
        miner: block.miner
      },
      timestamp: Date.now()
    };

    this.broadcastToSubscribers('blocks', blockNotification);
  }

  broadcastNewTransaction(transaction) {
    const txNotification = {
      type: 'new_transaction',
      data: {
        id: transaction.id,
        from: transaction.from,
        to: transaction.to,
        amount: transaction.amount,
        status: 'pending'
      },
      timestamp: Date.now()
    };

    this.broadcastToSubscribers('transactions', txNotification);
  }

  broadcastToSubscribers(channel, message) {
    let sentCount = 0;
    
    this.clients.forEach((client, clientId) => {
      if (client.subscriptions.has(channel) && client.socket.readyState === WebSocket.OPEN) {
        try {
          client.socket.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          console.error(`Failed to send to client ${clientId}:`, error.message);
          this.clients.delete(clientId);
        }
      }
    });

    console.log(`Broadcast sent to ${sentCount} subscribers on channel: ${channel}`);
  }

  cleanupStaleConnections() {
    const now = Date.now();
    const staleThreshold = 60000;

    this.clients.forEach((client, clientId) => {
      if (now - client.lastPing > staleThreshold) {
        client.socket.terminate();
        this.clients.delete(clientId);
      } else {
        client.socket.ping();
      }
    });
  }

  generateClientId() {
    return crypto.randomBytes(16).toString('hex');
  }

  getStats() {
    return {
      totalClients: this.clients.size,
      subscriptions: Array.from(this.clients.values()).reduce((acc, client) => {
        client.subscriptions.forEach(sub => {
          acc[sub] = (acc[sub] || 0) + 1;
        });
        return acc;
      }, {})
    };
  }
}

class BlockchainWebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      console.log('Connected to blockchain node');
      this.reconnectAttempts = 0;
      
      this.subscribe(['blocks', 'transactions']);
    });

    this.ws.on('message', (data) => {
      const message = JSON.parse(data);
      this.handleMessage(message);
    });

    this.ws.on('close', () => {
      console.log('Connection closed. Attempting to reconnect...');
      this.attemptReconnect();
    });
  }

  subscribe(channels) {
    this.send({ type: 'subscribe', channels });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'new_block':
        console.log('New block received:', message.data.blockNumber);
        this.onNewBlock(message.data);
        break;
      case 'new_transaction':
        console.log('New transaction:', message.data.id);
        this.onNewTransaction(message.data);
        break;
    }
  }

  send(message) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onNewBlock(block) {
  }

  onNewTransaction(transaction) {
  }
}