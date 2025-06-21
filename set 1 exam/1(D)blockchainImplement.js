const crypto = require('crypto');

function createMerkleTree(transactions) {
    if (transactions.length === 0) {
        return null;
    }
    
    let currentLevel = transactions.slice();
    
    while (currentLevel.length > 1) {
        const nextLevel = [];
        
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = (i + 1 < currentLevel.length) ? 
                         currentLevel[i + 1] : currentLevel[i];
            
            const combined = left + right;
            const hashResult = crypto.createHash('sha256')
                                   .update(combined)
                                   .digest('hex');
            nextLevel.push(hashResult);
        }
        
        currentLevel = nextLevel;
    }
    
    return currentLevel[0];
}
