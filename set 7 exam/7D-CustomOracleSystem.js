const { ethers } = require('ethers');

class DecentralizedOracle {
  constructor(config) {
    this.nodes = config.nodes.map((node) => new OracleNode(node.url, node.apiKeys));
    this.threshold = config.threshold;
    this.contract = new ethers.Contract(config.contractAddress, config.abi, config.provider);
  }

  async requestData(query) {
    const responses = await Promise.all(this.nodes.map((node) => node.fetchData(query)));
    return this.aggregateResponses(responses);
  }

  async aggregateResponses(responses) {
    const signedResponses = await Promise.all(responses.map((response, i) => this.nodes[i].signData(response)));
    const validResponses = signedResponses.filter((response) => this.verifyResponse(response));
    if (validResponses.length < this.threshold) {
      throw new Error('Insufficient valid responses');
    }
    return this.calculateAggregatedResponse(validResponses);
  }

  async verifyAndSubmit(aggregatedData) {
    await this.contract.submitData(aggregatedData);
  }

  verifyResponse(response) {
    // Verify the signed response
    return true;
  }

  calculateAggregatedResponse(validResponses) {
    // Calculate the aggregated response based on the valid responses
    return validResponses.reduce((sum, response) => sum + response, 0) / validResponses.length;
  }
}

class OracleNode {
  constructor(nodeUrl, apiKeys) {
    this.nodeUrl = nodeUrl;
    this.apiKeys = apiKeys;
    this.provider = new ethers.providers.JsonRpcProvider(nodeUrl);
    this.signer = new ethers.Wallet(apiKeys.privateKey, this.provider);
  }

  async fetchData(query) {
    // Fetch data from an external API
    const response = await fetch(`${this.nodeUrl}/api/data?query=${query}`);
    return await response.json();
  }

  async signData(data) {
    // Sign the data using the node's private key
    const signature = await this.signer.signMessage(JSON.stringify(data));
    return { data, signature };
  }
}

// Usage example
const config = {
  nodes: [
    { url: 'http://node1.example.com', apiKeys: { privateKey: '0x...1' } },
    { url: 'http://node2.example.com', apiKeys: { privateKey: '0x...2' } },
    { url: 'http://node3.example.com', apiKeys: { privateKey: '0x...3' } },
  ],
  threshold: 2,
  contractAddress: '0x...contract',
  abi: [], // ABI of the smart contract
  provider: new ethers.providers.JsonRpcProvider('http://ethereum.example.com'),
};

const oracle = new DecentralizedOracle(config);

async function fetchAndSubmitData() {
  try {
    const aggregatedData = await oracle.requestData('temperature');
    await oracle.verifyAndSubmit(aggregatedData);
    console.log('Data submitted successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}

fetchAndSubmitData();