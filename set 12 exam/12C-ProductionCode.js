const crypto = require('crypto');  
const { ethers } = require('ethers');  
  
class SecureWalletManager {  
  constructor(encryptionKey) {  
    // Use WeakMap to allow garbage collection  
    this.encryptedWallets = new WeakMap();  
    this.sessions = new Map();  
      
    // Derive encryption key from master key  
    this.encryptionKey = crypto.scryptSync(encryptionKey, 'salt', 32);  
      
    // Setup session cleanup  
    this.startSessionCleanup();  
  }  
    
  /**  
   * Import wallet with encryption and validation  
   */  
  async importWallet(privateKey, userId, password) {  
    try {  
      // Validate private key format  
      if (!this.isValidPrivateKey(privateKey)) {  
        throw new Error('Invalid private key format');  
      }  
        
      // Create wallet instance  
      const wallet = new ethers.Wallet(privateKey);  
        
      // Encrypt private key  
      const encrypted = this.encryptData(privateKey);  
        
      // Store encrypted wallet data  
      const walletData = {  
        address: wallet.address,  
        encryptedKey: encrypted,  
        userId: userId,  
        createdAt: Date.now()  
      };  
        
      // Use password-derived key for additional security  
      const userKey = crypto.pbkdf2Sync(password, userId, 100000, 32, 'sha256');  
      this.encryptedWallets.set(userKey, walletData);  
        
      // Clear private key from memory  
      privateKey = null;  
        
      return {  
        address: wallet.address,  
        success: true  
      };  
        
    } catch (error) {  
      console.error('Wallet import failed:', error.message);  
      throw new Error('Failed to import wallet');  
    }  
  }  
    
  /**  
   * Sign transaction with proper validation and session management  
   */  
  async signTransaction(userId, password, transaction) {  
    try {  
      // Validate transaction  
      this.validateTransaction(transaction);  
        
      // Get user key  
      const userKey = crypto.pbkdf2Sync(password, userId, 100000, 32, 'sha256');  
      const walletData = this.encryptedWallets.get(userKey);  
        
      if (!walletData) {  
        throw new Error('Wallet not found');  
      }  
        
      // Check session or create new one  
      let sessionWallet = this.getSession(userId);  
        
      if (!sessionWallet) {  
        // Decrypt private key temporarily  
        const privateKey = this.decryptData(walletData.encryptedKey);  
        sessionWallet = new ethers.Wallet(privateKey);  
          
        // Store in session with timeout  
        this.createSession(userId, sessionWallet);  
          
        // Clear private key  
        privateKey.fill(0);  
      }  
        
      // Sign transaction  
      const signedTx = await sessionWallet.signTransaction(transaction);  
        
      // Log transaction for audit  
      this.logTransaction(userId, transaction);  
        
      return signedTx;  
        
    } catch (error) {  
      console.error('Transaction signing failed:', error.message);  
      throw new Error('Failed to sign transaction');  
    }  
  }  
    
  /**  
   * Export wallet address only (never expose private key)  
   */  
  exportWalletAddress(userId, password) {  
    try {  
      const userKey = crypto.pbkdf2Sync(password, userId, 100000, 32, 'sha256');  
      const walletData = this.encryptedWallets.get(userKey);  
        
      if (!walletData) {  
        throw new Error('Wallet not found');  
      }  
        
      return {  
        address: walletData.address,  
        createdAt: walletData.createdAt  
      };  
        
    } catch (error) {  
      console.error('Wallet export failed:', error.message);  
      throw new Error('Failed to export wallet');  
    }  
  }  
    
  /**  
   * Encryption utilities  
   */  
  encryptData(data) {  
    const iv = crypto.randomBytes(16);  
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);  
      
    let encrypted = cipher.update(data, 'utf8', 'hex');  
    encrypted += cipher.final('hex');  
      
    const authTag = cipher.getAuthTag();  
      
    return {  
      encrypted,  
      iv: iv.toString('hex'),  
      authTag: authTag.toString('hex')  
    };  
  }  
    
  decryptData(encryptedData) {  
    const decipher = crypto.createDecipheriv(  
      'aes-256-gcm',  
      this.encryptionKey,  
      Buffer.from(encryptedData.iv, 'hex')  
    );  
      
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));  
      
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');  
    decrypted += decipher.final('utf8');  
      
    return decrypted;  
  }  
    
  /**  
   * Validation utilities  
   */  
  isValidPrivateKey(privateKey) {  
    try {  
      // Check if it's a valid private key  
      const wallet = new ethers.Wallet(privateKey);  
      return wallet.address !== null;  
    } catch {  
      return false;  
    }  
  }  
    
  validateTransaction(transaction) {  
    // Validate required fields  
    if (!transaction.to || !ethers.utils.isAddress(transaction.to)) {  
      throw new Error('Invalid recipient address');  
    }  
      
    if (!transaction.value || transaction.value < 0) {  
      throw new Error('Invalid transaction value');  
    }  
      
    if (transaction.gasLimit && transaction.gasLimit < 21000) {  
      throw new Error('Gas limit too low');  
    }  
      
    // Additional validation...  
  }  
    
  /**  
   * Session management  
   */  
  createSession(userId, wallet) {  
    const sessionId = crypto.randomBytes(32).toString('hex');  
    const session = {  
      wallet,  
      createdAt: Date.now(),  
      lastUsed: Date.now(),  
      sessionId  
    };  
      
    this.sessions.set(userId, session);  
      
    // Auto-expire after 5 minutes  
    setTimeout(() => {  
      this.clearSession(userId);  
    }, 5 * 60 * 1000);  
  }  
    
  getSession(userId) {  
    const session = this.sessions.get(userId);  
    if (session) {  
      // Check if session is still valid (5 minutes)  
      if (Date.now() - session.lastUsed > 5 * 60 * 1000) {  
        this.clearSession(userId);  
        return null;  
      }  
      session.lastUsed = Date.now();  
      return session.wallet;  
    }  
    return null;  
  }  
    
  clearSession(userId) {  
    this.sessions.delete(userId);  
  }  
    
  startSessionCleanup() {  
    // Clean expired sessions every minute  
    setInterval(() => {  
      const now = Date.now();  
      for (const [userId, session] of this.sessions) {  
        if (now - session.lastUsed > 5 * 60 * 1000) {  
          this.clearSession(userId);  
        }  
      }  
    }, 60 * 1000);  
  }  
    
  /**  
   * Audit logging  
   */  
  logTransaction(userId, transaction) {  
    // Implement audit logging  
    console.log(`[AUDIT] User ${userId} signed transaction to ${transaction.to}`);  
  }  
}  
  
module.exports = SecureWalletManager;  