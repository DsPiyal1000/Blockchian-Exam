const { create } = require('ipfs-http-client');
const { ethers } = require('ethers');
const crypto = require('crypto');

class DecentralizedStorage {
  constructor(ipfsConfig, contractAddress) {
    // Initialize IPFS
    this.ipfs = create(ipfsConfig);
    
    // Initialize smart contract
    this.contractAddress = contractAddress;
    this.contract = null;
    this.provider = null;
    
    // File metadata cache
    this.fileMetadata = new Map();
    
    this.init();
  }

  async init() {
    try {
      // Connect to Ethereum provider
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
      
      // Contract ABI (simplified)
      const contractABI = [
        "function storeFile(string memory cid, bytes32 fileHash, address[] memory allowedUsers) public",
        "function getFileAccess(string memory cid, address user) public view returns (bool)",
        "function getUserFiles(address user) public view returns (string[] memory)",
        "event FileStored(string indexed cid, address indexed owner, bytes32 fileHash)"
      ];
      
      this.contract = new ethers.Contract(
        this.contractAddress,
        contractABI,
        this.provider.getSigner()
      );
      
    } catch (error) {
      throw new Error(`Initialization failed: ${error.message}`);
    }
  }

  async uploadFile(file, metadata = {}) {
    try {
      // Validate inputs
      if (!file || !file.size) {
        throw new Error('Invalid file provided');
      }

      // Generate encryption key
      const encryptionKey = crypto.randomBytes(32);
      
      // Encrypt file
      const encryptedFile = await this.encryptFile(file, encryptionKey);
      
      // Upload to IPFS
      const ipfsResult = await this.ipfs.add(encryptedFile, {
        pin: true,
        progress: (bytes) => {
          console.log(`Upload progress: ${bytes} bytes`);
        }
      });
      
      const cid = ipfsResult.cid.toString();
      
      // Create file metadata
      const fileMetadata = {
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        encryptionKey: encryptionKey.toString('hex'),
        uploadTimestamp: Date.now(),
        owner: await this.provider.getSigner().getAddress(),
        ...metadata
      };
      
      // Upload metadata to IPFS
      const metadataResult = await this.ipfs.add(
        JSON.stringify(fileMetadata),
        { pin: true }
      );
      
      // Store on blockchain
      const fileHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(file.name + file.size)
      );
      
      const tx = await this.contract.storeFile(
        cid,
        fileHash,
        metadata.allowedUsers || []
      );
      
      await tx.wait();
      
      // Cache metadata
      this.fileMetadata.set(cid, {
        ...fileMetadata,
        metadataCID: metadataResult.cid.toString(),
        transactionHash: tx.hash
      });
      
      return {
        cid,
        metadataCID: metadataResult.cid.toString(),
        transactionHash: tx.hash,
        encryptionKey: encryptionKey.toString('hex')
      };
      
    } catch (error) {
      throw new Error(`File upload failed: ${error.message}`);
    }
  }

  async shareFile(cid, address) {
    try {
      // Verify file ownership
      const userAddress = await this.provider.getSigner().getAddress();
      const userFiles = await this.contract.getUserFiles(userAddress);
      
      if (!userFiles.includes(cid)) {
        throw new Error('You do not own this file');
      }
      
      // Get file metadata
      const metadata = await this.getFileMetadata(cid);
      
      // Create share token (encrypted key for specific user)
      const shareToken = await this.createShareToken(
        metadata.encryptionKey,
        address
      );
      
      // Store share information
      const shareInfo = {
        cid,
        sharedWith: address,
        shareToken,
        timestamp: Date.now(),
        sharedBy: userAddress
      };
      
      // Upload share info to IPFS
      const shareResult = await this.ipfs.add(
        JSON.stringify(shareInfo),
        { pin: true }
      );
      
      return {
        shareCID: shareResult.cid.toString(),
        shareToken,
        sharedWith: address
      };
      
    } catch (error) {
      throw new Error(`File sharing failed: ${error.message}`);
    }
  }

  async listUserFiles(address) {
    try {
      // Get files from blockchain
      const fileCIDs = await this.contract.getUserFiles(address);
      
      const files = [];
      
      for (const cid of fileCIDs) {
        try {
          const metadata = await this.getFileMetadata(cid);
          files.push({
            cid,
            ...metadata,
            accessible: await this.contract.getFileAccess(cid, address)
          });
        } catch (error) {
          console.warn(`Failed to load metadata for ${cid}:`, error);
        }
      }
      
      return files;
      
    } catch (error) {
      throw new Error(`Failed to list user files: ${error.message}`);
    }
  }

  async downloadFile(cid, encryptionKey) {
    try {
      // Check access permissions
      const userAddress = await this.provider.getSigner().getAddress();
      const hasAccess = await this.contract.getFileAccess(cid, userAddress);
      
      if (!hasAccess) {
        throw new Error('Access denied');
      }
      
      // Download from IPFS
      const chunks = [];
      for await (const chunk of this.ipfs.cat(cid)) {
        chunks.push(chunk);
      }
      
      const encryptedData = new Uint8Array(
        chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      );
      
      let offset = 0;
      for (const chunk of chunks) {
        encryptedData.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Decrypt file
      const decryptedFile = await this.decryptFile(
        encryptedData,
        Buffer.from(encryptionKey, 'hex')
      );
      
      return decryptedFile;
      
    } catch (error) {
      throw new Error(`File download failed: ${error.message}`);
    }
  }

  // Utility methods
  async encryptFile(file, key) {
    const algorithm = 'aes-256-gcm';
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipher(algorithm, key);
    
    const fileBuffer = await file.arrayBuffer();
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(fileBuffer)),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    return Buffer.concat([iv, authTag, encrypted]);
  }

  async decryptFile(encryptedData, key) {
    const algorithm = 'aes-256-gcm';
    const iv = encryptedData.slice(0, 16);
    const authTag = encryptedData.slice(16, 32);
    const encrypted = encryptedData.slice(32);
    
    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted;
  }

  async getFileMetadata(cid) {
    if (this.fileMetadata.has(cid)) {
      return this.fileMetadata.get(cid);
    }
    
    // Try to load from IPFS (this would require storing metadata CID)
    // For now, return cached or throw error
    throw new Error('Metadata not found');
  }

  async createShareToken(encryptionKey, recipientAddress) {
    // Create a token that allows the recipient to decrypt the file
    const token = crypto.randomBytes(32);
    const encryptedKey = crypto.publicEncrypt(
      recipientAddress, // This would be the recipient's public key
      Buffer.from(encryptionKey, 'hex')
    );
    
    return {
      token: token.toString('hex'),
      encryptedKey: encryptedKey.toString('hex')
    };
  }
}

// Frontend integration
class StorageUI {
  constructor(storage) {
    this.storage = storage;
    this.currentFiles = [];
    this.setupEventListeners();
  }

  setupFileUpload() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const uploadBtn = document.getElementById('upload-btn');
    
    // Drag and drop functionality
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      
      const files = Array.from(e.dataTransfer.files);
      await this.handleFileUpload(files);
    });
    
    // File input change
    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      await this.handleFileUpload(files);
    });
    
    // Upload button click
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
  }

  async handleFileUpload(files) {
    const results = [];
    
    for (const file of files) {
      try {
        this.showUploadProgress(file.name, 0);
        
        const result = await this.storage.uploadFile(file, {
          tags: ['user-upload'],
          description: `Uploaded on ${new Date().toISOString()}`
        });
        
        results.push(result);
        this.showUploadSuccess(file.name, result.cid);
        
      } catch (error) {
        this.showUploadError(file.name, error.message);
      }
    }
    
    // Refresh file list
    await this.displayFiles();
    
    return results;
  }

  async displayFiles() {
    try {
      const userAddress = await this.storage.provider.getSigner().getAddress();
      const files = await this.storage.listUserFiles(userAddress);
      
      const fileList = document.getElementById('file-list');
      fileList.innerHTML = '';
      
      files.forEach(file => {
        const fileElement = this.createFileElement(file);
        fileList.appendChild(fileElement);
      });
      
      this.currentFiles = files;
      
    } catch (error) {
      console.error('Failed to display files:', error);
      this.showError('Failed to load files');
    }
  }

  createFileElement(file) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-item';
    
    fileDiv.innerHTML = `
      <div class="file-info">
        <h3>${file.originalName}</h3>
        <p>Size: ${this.formatFileSize(file.size)}</p>
        <p>Uploaded: ${new Date(file.uploadTimestamp).toLocaleString()}</p>
        <p>CID: ${file.cid}</p>
      </div>
      <div class="file-actions">
        <button onclick="this.downloadFile('${file.cid}')" class="btn-download">
          Download
        </button>
        <button onclick="this.shareFile('${file.cid}')" class="btn-share">
          Share
        </button>
        <button onclick="this.copyLink('${file.cid}')" class="btn-copy">
          Copy Link
        </button>
      </div>
    `;
    
    return fileDiv;
  }

  setupEventListeners() {
    // Download file
    window.downloadFile = async (cid) => {
      try {
        const fileData = this.currentFiles.find(f => f.cid === cid);
        if (!fileData) throw new Error('File not found');
        
        const file = await this.storage.downloadFile(cid, fileData.encryptionKey);
        
        // Create download link
        const blob = new Blob([file], { type: fileData.mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileData.originalName;
        a.click();
        
        URL.revokeObjectURL(url);
        
      } catch (error) {
        this.showError(`Download failed: ${error.message}`);
      }
    };
    
    // Share file
    window.shareFile = async (cid) => {
      const address = prompt('Enter recipient address:');
      if (!address) return;
      
      try {
        const result = await this.storage.shareFile(cid, address);
        this.showSuccess(`File shared with ${address}. Share CID: ${result.shareCID}`);
      } catch (error) {
        this.showError(`Share failed: ${error.message}`);
      }
    };
    
    // Copy IPFS link
    window.copyLink = (cid) => {
      const link = `https://ipfs.io/ipfs/${cid}`;
      navigator.clipboard.writeText(link);
      this.showSuccess('Link copied to clipboard');
    };
  }

  showUploadProgress(fileName, progress) {
    // Implementation for progress display
    console.log(`${fileName}: ${progress}%`);
  }

  showUploadSuccess(fileName, cid) {
    this.showSuccess(`${fileName} uploaded successfully. CID: ${cid}`);
  }

  showUploadError(fileName, error) {
    this.showError(`${fileName} upload failed: ${error}`);
  }

  showSuccess(message) {
    // Implementation for success notification
    console.log('Success:', message);
  }

  showError(message) {
    // Implementation for error notification
    console.error('Error:', message);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Usage example
async function initializeApp() {
  const storage = new DecentralizedStorage(
    {
      host: 'localhost',
      port: 5001,
      protocol: 'http'
    },
    '0x...' // Contract address
  );
  
  const ui = new StorageUI(storage);
  ui.setupFileUpload();
  await ui.displayFiles();
}