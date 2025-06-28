const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json()); // FIX: Add body parser

let blockchain = [];
let pendingTransactions = [];
let peers = [];

// FIX: Add error handling
app.get('/blocks', (req, res) => {
  try {
    res.json(blockchain);
  } catch (err) {
    res.status(500).send('Chain retrieval error');
  }
});

// FIX: Add validation + correct data structure
app.post('/transaction', (req, res) => {
  const transaction = req.body;
  if (!transaction.sender || !transaction.receiver) {
    return res.status(400).send('Invalid transaction');
  }
  pendingTransactions.push(transaction);
  res.send('Transaction added to pool');
});

// FIX: Make mining non-blocking + add transaction handling
app.post('/mine', (req, res) => {
  setTimeout(async () => { // Offload from event loop
    const newBlock = {
      index: blockchain.length,
      transactions: [...pendingTransactions],
      timestamp: Date.now()
    };
    
    blockchain.push(newBlock);
    pendingTransactions = []; // Reset pool
    
    // FIX: Add peer synchronization
    await synchronizePeers(); 
    
    res.json(newBlock);
  }, 0);
});

// NEW: Peer synchronization
async function synchronizePeers() {
  peers.forEach(peer => {
    fetch(`${peer}/blocks`, { method: 'PUT', body: JSON.stringify(blockchain) });
  });
}

app.listen(3000);