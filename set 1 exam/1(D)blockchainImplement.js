const crypto = require('crypto');

class Block {
    constructor(transactions, previousHash) {
        this.timestamp = Date.now();
        this.transactions = transactions || [];
        this.previousHash = previousHash || '0';
        this.nonce = 0;
        this.hash = this.calculateHash();
    }
    
    calculateHash() {
        return crypto.createHash('sha256')
            .update(
                this.previousHash + 
                this.timestamp + 
                JSON.stringify(this.transactions) + 
                this.nonce
            )
            .digest('hex');
    }
    
    mineBlock(difficulty) {
        const target = Array(difficulty + 1).join('0');
        
        while (this.hash.substring(0, difficulty) !== target) {
            this.nonce++;
            this.hash = this.calculateHash();
        }
        
        console.log(`Block mined: ${this.hash}`);
    }
}

class Blockchain {
    constructor() {
        this.chain = [this.createGenesisBlock()];
        this.difficulty = 4;
    }
    
    createGenesisBlock() {
        return new Block([], '0');
    }
    
    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }
    
    mineBlock(transactions, difficulty = this.difficulty) {
        const newBlock = new Block(transactions, this.getLatestBlock().hash);
        newBlock.mineBlock(difficulty);
        this.chain.push(newBlock);
        return newBlock;
    }
    
    isValidChain() {
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];
            
            if (currentBlock.hash !== currentBlock.calculateHash()) {
                return false;
            }
            
            if (currentBlock.previousHash !== previousBlock.hash) {
                return false;
            }
        }
        return true;
    }
}

module.exports = { Block, Blockchain };