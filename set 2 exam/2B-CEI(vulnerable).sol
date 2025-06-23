contract Vulnerable {
    mapping(address => uint256) public balances;
    
    function withdraw(uint256 amount) public {
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        
        balances[msg.sender] -= amount;
    }
}