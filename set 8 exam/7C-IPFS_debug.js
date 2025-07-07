const { create } = require('ipfs-http-client');

class IPFSUploader {
  constructor(config = {}) {
    // Fixed: Proper configuration with error handling
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 5001,
      protocol: config.protocol || 'http',
      timeout: config.timeout || 30000,
      ...config
    };
    
    try {
      this.ipfs = create(this.config);
    } catch (error) {
      throw new Error(`IPFS initialization failed: ${error.message}`);
    }
  }

  async uploadFile(file) {
    // Fixed: Added file validation
    if (!file) {
      throw new Error('File is required');
    }
    
    // Validate file size (example: 10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size exceeds 10MB limit');
    }
    
    // Validate file type
    const allowedTypes = ['image/', 'text/', 'application/json'];
    if (!allowedTypes.some(type => file.type.startsWith(type))) {
      throw new Error('File type not supported');
    }
    
    try {
      const result = await this.ipfs.add(file, {
        progress: (bytes) => console.log(`Uploaded: ${bytes} bytes`)
      });
      
      // Fixed: Return immutable IPFS URL and CID
      return {
        cid: result.cid.toString(),
        path: result.path,
        size: result.size,
        // Use immutable IPFS URL
        url: `https://ipfs.io/ipfs/${result.cid.toString()}`
      };
    } catch (error) {
      throw new Error(`File upload failed: ${error.message}`);
    }
  }

  async uploadJSON(data) {
    // Fixed: Added comprehensive error handling
    try {
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid data: must be a valid object');
      }
      
      const json = JSON.stringify(data);
      
      // Validate JSON size
      if (json.length > 1024 * 1024) { // 1MB limit
        throw new Error('JSON data too large');
      }
      
      const result = await this.ipfs.add(json, {
        pin: true // Ensure it's pinned
      });
      
      return {
        cid: result.cid.toString(),
        path: result.path,
        size: result.size,
        url: `https://ipfs.io/ipfs/${result.cid.toString()}`
      };
      
    } catch (error) {
      if (error.message.includes('Invalid data')) {
        throw error;
      }
      throw new Error(`JSON upload failed: ${error.message}`);
    }
  }

  async pin(cid) {
    // Fixed: Proper pinning service integration
    try {
      if (!cid) {
        throw new Error('CID is required for pinning');
      }
      
      // Pin locally first
      await this.ipfs.pin.add(cid);
      
      // Integrate with pinning service (example: Pinata)
      if (this.config.pinningService) {
        await this.pinToService(cid);
      }
      
      return {
        success: true,
        cid,
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Pinning failed: ${error.message}`);
    }
  }

  async pinToService(cid) {
    // Example pinning service integration
    const response = await fetch(`${this.config.pinningService.url}/pins`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.pinningService.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cid,
        name: `pin-${Date.now()}`
      })
    });
    
    if (!response.ok) {
      throw new Error(`Pinning service error: ${response.statusText}`);
    }
    
    return response.json();
  }

  // Additional utility methods
  async getFileInfo(cid) {
    try {
      const stats = await this.ipfs.files.stat(`/ipfs/${cid}`);
      return {
        cid,
        size: stats.size,
        type: stats.type,
        blocks: stats.blocks
      };
    } catch (error) {
      throw new Error(`Failed to get file info: ${error.message}`);
    }
  }

  async isOnline() {
    try {
      await this.ipfs.id();
      return true;
    } catch (error) {
      return false;
    }
  }
}