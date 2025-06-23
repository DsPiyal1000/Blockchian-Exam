// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Voting {
    struct Proposal {
        uint256 id;
        string description;
        uint256 voteCount;
        uint256 yesVotes;
        uint256 noVotes;
        bool exists;
        mapping(address => bool) hasVoted;
    }
    
    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;
    address public owner;
    
    event ProposalCreated(uint256 indexed proposalId, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can create proposals");
        _;
    }
    
    modifier proposalExists(uint256 proposalId) {
        require(proposals[proposalId].exists, "Proposal does not exist");
        _;
    }
    
    modifier hasNotVoted(uint256 proposalId) {
        require(!proposals[proposalId].hasVoted[msg.sender], "Already voted");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    function createProposal(string memory description) public onlyOwner {
        require(bytes(description).length > 0, "Description cannot be empty");
        
        proposalCount++;
        Proposal storage newProposal = proposals[proposalCount];
        newProposal.id = proposalCount;
        newProposal.description = description;
        newProposal.exists = true;
        
        emit ProposalCreated(proposalCount, description);
    }
    
    function vote(uint256 proposalId, bool support) 
        public 
        proposalExists(proposalId) 
        hasNotVoted(proposalId) 
    {
        Proposal storage proposal = proposals[proposalId];
        proposal.hasVoted[msg.sender] = true;
        proposal.voteCount++;
        
        if (support) {
            proposal.yesVotes++;
        } else {
            proposal.noVotes++;
        }
        
        emit VoteCast(proposalId, msg.sender, support);
    }
    
    function getProposal(uint256 proposalId) 
        public 
        view 
        proposalExists(proposalId) 
        returns (
            uint256 id,
            string memory description,
            uint256 voteCount,
            uint256 yesVotes,
            uint256 noVotes
        ) 
    {
        Proposal storage proposal = proposals[proposalId];
        return (
            proposal.id,
            proposal.description,
            proposal.voteCount,
            proposal.yesVotes,
            proposal.noVotes
        );
    }
    
    function hasVoted(uint256 proposalId, address voter) 
        public 
        view 
        proposalExists(proposalId) 
        returns (bool) 
    {
        return proposals[proposalId].hasVoted[voter];
    }
}