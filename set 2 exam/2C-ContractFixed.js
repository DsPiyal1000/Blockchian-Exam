const Web3 = require('web3');
const web3 = new Web3('http://localhost:8545');
const contractABI = [];
const contractAddress = '0x123...';
const contract = new web3.eth.Contract(contractABI, contractAddress);

async function interactWithContract() {
    try {
        const isConnected = await web3.eth.net.isListening();
        if (!isConnected) {
            throw new Error('Unable to connect to Ethereum node');
        }

        const accounts = await web3.eth.getAccounts();
        if (accounts.length === 0) {
            throw new Error('No accounts found. Make sure your wallet is connected.');
        }

        console.log('Connected account:', accounts[0]);

        const result = await contract.methods.getValue().call();
        console.log('Current value:', result);

        const gasEstimate = await contract.methods.setValue(42).estimateGas({
            from: accounts[0]
        });
        
        const gasLimit = Math.floor(gasEstimate * 1.1);
        
        const gasPrice = await web3.eth.getGasPrice();

        console.log(`Gas estimate: ${gasEstimate}, Gas limit: ${gasLimit}, Gas price: ${gasPrice}`);

        const eventSubscription = contract.events.ValueChanged({
            fromBlock: 'latest'
        });

        eventSubscription.on('data', (event) => {
            console.log('ValueChanged event detected:', {
                transactionHash: event.transactionHash,
                blockNumber: event.blockNumber,
                returnValues: event.returnValues
            });
        });

        eventSubscription.on('error', (error) => {
            console.error('Event subscription error:', error);
        });

        console.log('Sending transaction...');
        const tx = await contract.methods.setValue(42).send({
            from: accounts[0],
            gas: gasLimit,        
            gasPrice: gasPrice
        });

        console.log('Transaction successful!');
        console.log('Transaction hash:', tx.transactionHash);
        console.log('Block number:', tx.blockNumber);
        console.log('Gas used:', tx.gasUsed);

        const receipt = await web3.eth.getTransactionReceipt(tx.transactionHash);
        if (receipt.status) {
            console.log('Transaction confirmed successfully');
        } else {
            console.log('Transaction failed');
        }

        return {
            transactionHash: tx.transactionHash,
            blockNumber: tx.blockNumber,
            gasUsed: tx.gasUsed,
            status: receipt.status
        };

    } catch (error) {
        if (error.code === 4001) {
            console.error('Transaction rejected by user');
        } else if (error.code === -32603) {
            console.error('Internal JSON-RPC error:', error.message);
        } else if (error.message.includes('insufficient funds')) {
            console.error('Insufficient funds for gas * price + value');
        } else if (error.message.includes('nonce too low')) {
            console.error('Nonce too low - transaction may have been sent already');
        } else {
            console.error('Contract interaction failed:', error.message);
        }
        
        throw error;
    }
}

async function main() {
    try {
        const result = await interactWithContract();
        console.log('Interaction completed successfully:', result);
    } catch (error) {
        console.error('Main execution failed:', error.message);
        process.exit(1);
    }
}

main();