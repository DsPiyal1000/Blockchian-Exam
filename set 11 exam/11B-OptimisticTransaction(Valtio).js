// Valtio implementation with proxy-based reactivity  
import { proxy, subscribe, snapshot } from 'valtio';  
import { subscribeKey } from 'valtio/utils';  
  
// Create reactive Web3 state  
const web3State = proxy({  
  account: null,  
  balance: '0',  
  transactions: [],  
  pendingTransactions: {},  
  networkId: null,  
    
  // Methods can be included in the proxy  
  async sendTransaction(txData) {  
    const tempId = Date.now().toString();  
      
    // Optimistic update  
    this.pendingTransactions[tempId] = {  
      ...txData,  
      status: 'pending',  
      timestamp: Date.now()  
    };  
  
    try {  
      const provider = getProvider();  
      const tx = await provider.sendTransaction(txData);  
        
      // Update with real hash  
      this.pendingTransactions[tx.hash] = {  
        ...this.pendingTransactions[tempId],  
        hash: tx.hash  
      };  
      delete this.pendingTransactions[tempId];  
  
      // Monitor transaction  
      const receipt = await tx.wait();  
        
      // Move to confirmed  
      this.transactions.push({  
        ...this.pendingTransactions[tx.hash],  
        status: 'confirmed',  
        receipt  
      });  
      delete this.pendingTransactions[tx.hash];  
  
      return receipt;  
    } catch (error) {  
      // Rollback  
      delete this.pendingTransactions[tempId];  
      throw error;  
    }  
  }  
});  
  
// Subscribe to specific changes  
subscribeKey(web3State, 'balance', (newBalance) => {  
  console.log('Balance updated:', newBalance);  
});  
  
// Subscribe to all changes  
subscribe(web3State, () => {  
  const snap = snapshot(web3State);  
  console.log('State updated:', snap);  
});  
  
// Consistency helper  
const ensureConsistency = () => {  
  // Check pending transactions  
  Object.entries(web3State.pendingTransactions).forEach(([id, tx]) => {  
    if (Date.now() - tx.timestamp > 300000) { // 5 minutes  
      // Transaction likely failed  
      delete web3State.pendingTransactions[id];  
    }  
  });  
};  
  
// Run consistency checks periodically  
setInterval(ensureConsistency, 30000);  