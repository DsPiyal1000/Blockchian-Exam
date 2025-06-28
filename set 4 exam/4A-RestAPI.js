const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

class BlockchainAPI {
  constructor() {
    this.blockchain = [];
    this.peers = new Set();
    this.pendingTransactions = [];
    this.isSync = false;
  }

  setupBlockSync() {

    app.get('/api/blockchain', (req, res) => {
      res.json({
        chain: this.blockchain,
        length: this.blockchain.length,
        lastBlockHash: this.blockchain[this.blockchain.length - 1]?.hash
      });
    });

    app.post('/api/sync', async (req, res) => {
      try {
        const { peerUrl } = req.body;
        const response = await fetch(`${peerUrl}/api/blockchain`);
        const peerChain = await response.json();
        
        if (this.isValidChain(peerChain.chain) && peerChain.length > this.blockchain.length) {
          this.blockchain = peerChain.chain;
          this.isSync = true;
          res.json({ message: 'Blockchain synchronized', length: this.blockchain.length });
        } else {
          res.json({ message: 'Current chain is up to date' });
        }
      } catch (error) {
        res.status(500).json({ error: 'Sync failed', details: error.message });
      }
    });
  }

  setupTransactionPropagation() {
    app.post('/api/transaction', (req, res) => {
      const { from, to, amount, signature } = req.body;
      
      if (!this.validateTransaction({ from, to, amount, signature })) {
        return res.status(400).json({ error: 'Invalid transaction' });
      }

      const transaction = {
        id: crypto.randomUUID(),
        from,
        to,
        amount,
        timestamp: Date.now(),
        signature
      };

      this.pendingTransactions.push(transaction);
      this.propagateTransaction(transaction);
      
      res.json({ message: 'Transaction added to pool', transactionId: transaction.id });
    });

    app.get('/api/transactions/pending', (req, res) => {
      res.json(this.pendingTransactions);
    });
  }

  setupPeerDiscovery() {
    app.post('/api/peers/register', (req, res) => {
      const { address, port } = req.body;
      const peerAddress = `${address}:${port}`;
      
      this.peers.add(peerAddress);
      res.json({ message: 'Peer registered', peers: Array.from(this.peers) });
    });

    app.get('/api/peers', (req, res) => {
      res.json({ peers: Array.from(this.peers), count: this.peers.size });
    });

    app.post('/api/peers/discover', async (req, res) => {
      try {
        const discoveredPeers = new Set();
        
        for (const peer of this.peers) {
          const response = await fetch(`http://${peer}/api/peers`);
          const peerData = await response.json();
          
          peerData.peers.forEach(p => discoveredPeers.add(p));
        }
        
        discoveredPeers.forEach(peer => this.peers.add(peer));
        res.json({ discovered: Array.from(discoveredPeers) });
      } catch (error) {
        res.status(500).json({ error: 'Peer discovery failed' });
      }
    });
  }

  validateTransaction(transaction) {
    return transaction.from && transaction.to && transaction.amount > 0;
  }

  isValidChain(chain) {
    return true; // Simplified for demo
  }

  async propagateTransaction(transaction) {
    const promises = Array.from(this.peers).map(peer => 
      fetch(`http://${peer}/api/transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transaction)
      }).catch(err => console.log(`Failed to propagate to ${peer}`))
    );
    
    await Promise.allSettled(promises);
  }
}