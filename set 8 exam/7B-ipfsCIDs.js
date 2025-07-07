import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { base58btc } from 'multiformats/bases/base58'

class ContentAddressing {
  static async createCID(data) {
    // Convert data to bytes
    const bytes = new TextEncoder().encode(
      typeof data === 'string' ? data : JSON.stringify(data)
    );
    
    // Create hash
    const hash = await sha256.digest(bytes);
    
    // Create CID
    const cid = CID.create(1, 0x70, hash); // version 1, dag-pb codec
    
    return cid.toString();
  }

  static async verifyCID(data, expectedCID) {
    const computedCID = await this.createCID(data);
    return computedCID === expectedCID;
  }

  static async createManifest(files) {
    const manifest = {};
    
    for (const [filename, content] of Object.entries(files)) {
      manifest[filename] = {
        cid: await this.createCID(content),
        size: new Blob([content]).size,
        timestamp: Date.now()
      };
    }
    
    return {
      manifest,
      manifestCID: await this.createCID(JSON.stringify(manifest))
    };
  }
}