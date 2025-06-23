class VotingDApp {
    constructor(contractAddress, abi, providerUrl = 'http://localhost:8545') {
        this.web3 = new Web3(providerUrl);
        this.contract = new this.web3.eth.Contract(abi, contractAddress);
        this.contractAddress = contractAddress;
        this.currentAccount = null;
        
        this.init();
    }
    
    async init() {
        try {
            if (window.ethereum) {
                this.web3 = new Web3(window.ethereum);
                await this.connectWallet();
            }
            
            this.setupEventListeners();
        } catch (error) {
            console.error('Initialization failed:', error);
        }
    }
    
    async connectWallet() {
        try {
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });
            this.currentAccount = accounts[0];
            console.log('Connected account:', this.currentAccount);
            return this.currentAccount;
        } catch (error) {
            console.error('Wallet connection failed:', error);
            throw error;
        }
    }
    
    async createProposal(description) {
        try {
            if (!this.currentAccount) {
                await this.connectWallet();
            }
            
            const gasEstimate = await this.contract.methods
                .createProposal(description)
                .estimateGas({ from: this.currentAccount });
            
            const tx = await this.contract.methods
                .createProposal(description)
                .send({
                    from: this.currentAccount,
                    gas: Math.floor(gasEstimate * 1.2)
                });
            
            console.log('Proposal created:', tx.transactionHash);
            return tx;
        } catch (error) {
            console.error('Create proposal failed:', error);
            throw error;
        }
    }
    
    async vote(proposalId, support) {
        try {
            if (!this.currentAccount) {
                await this.connectWallet();
            }
            
            const hasVoted = await this.contract.methods
                .hasVoted(proposalId, this.currentAccount)
                .call();
            
            if (hasVoted) {
                throw new Error('You have already voted on this proposal');
            }
            
            const gasEstimate = await this.contract.methods
                .vote(proposalId, support)
                .estimateGas({ from: this.currentAccount });
            
            const tx = await this.contract.methods
                .vote(proposalId, support)
                .send({
                    from: this.currentAccount,
                    gas: Math.floor(gasEstimate * 1.2)
                });
            
            console.log('Vote cast:', tx.transactionHash);
            return tx;
        } catch (error) {
            console.error('Voting failed:', error);
            throw error;
        }
    }
    
    async getResults(proposalId) {
        try {
            const proposal = await this.contract.methods
                .getProposal(proposalId)
                .call();
            
            return {
                id: proposal.id,
                description: proposal.description,
                totalVotes: proposal.voteCount,
                yesVotes: proposal.yesVotes,
                noVotes: proposal.noVotes,
                yesPercentage: proposal.voteCount > 0 
                    ? (proposal.yesVotes / proposal.voteCount * 100).toFixed(2) 
                    : 0,
                noPercentage: proposal.voteCount > 0 
                    ? (proposal.noVotes / proposal.voteCount * 100).toFixed(2) 
                    : 0
            };
        } catch (error) {
            console.error('Get results failed:', error);
            throw error;
        }
    }
    
    async getAllProposals() {
        try {
            const proposalCount = await this.contract.methods.proposalCount().call();
            const proposals = [];
            
            for (let i = 1; i <= proposalCount; i++) {
                const proposal = await this.getResults(i);
                proposals.push(proposal);
            }
            
            return proposals;
        } catch (error) {
            console.error('Get all proposals failed:', error);
            throw error;
        }
    }
    
    setupEventListeners() {
        this.contract.events.ProposalCreated({
            fromBlock: 'latest'
        })
        .on('data', (event) => {
            console.log('New proposal created:', event.returnValues);
            this.onProposalCreated(event.returnValues);
        });
        
        this.contract.events.VoteCast({
            fromBlock: 'latest'
        })
        .on('data', (event) => {
            console.log('Vote cast:', event.returnValues);
            this.onVoteCast(event.returnValues);
        });
    }
    
    onProposalCreated(data) {
        console.log('Proposal created event:', data);
    }
    
    onVoteCast(data) {
        console.log('Vote cast event:', data);
    }
}

const contractABI = [];
const contractAddress = '0x...';

const votingApp = new VotingDApp(contractAddress, contractABI);

async function demonstrateUsage() {
    try {
        await votingApp.createProposal("Should we implement feature X?");
        
        await votingApp.vote(1, true);
        
        const results = await votingApp.getResults(1);
        console.log('Voting results:', results);
        
    } catch (error) {
        console.error('Demo failed:', error);
    }
}