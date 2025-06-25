// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LendingPool is ReentrancyGuard, Ownable {
    struct UserData {
        uint256 depositBalance;
        uint256 borrowBalance;
        uint256 lastInterestUpdate;
        uint256 collateralBalance;
    }
    
    IERC20 public immutable token;
    IERC20 public immutable collateralToken;
    
    mapping(address => UserData) public users;
    
    uint256 public totalDeposits;
    uint256 public totalBorrows;
    uint256 public interestRate = 5; 
    uint256 public collateralizationRatio = 150; 
    uint256 public liquidationThreshold = 120;
    
    uint256 private constant SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
    uint256 private constant PRECISION = 1e18;
    
    event Deposit(address indexed user, uint256 amount);
    event Borrow(address indexed user, uint256 amount);
    event Repay(address indexed user, uint256 amount);
    event Liquidate(address indexed liquidator, address indexed user, uint256 amount);
    
    constructor(address _token, address _collateralToken) {
        token = IERC20(_token);
        collateralToken = IERC20(_collateralToken);
    }
    
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        _updateInterest(msg.sender);
        
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        users[msg.sender].depositBalance += amount;
        totalDeposits += amount;
        
        emit Deposit(msg.sender, amount);
    }
    
    function depositCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        require(collateralToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        users[msg.sender].collateralBalance += amount;
    }
    
    function borrow(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= token.balanceOf(address(this)), "Insufficient liquidity");
        
        _updateInterest(msg.sender);
        
        UserData storage user = users[msg.sender];
        uint256 newBorrowBalance = user.borrowBalance + amount;
        
        require(
            _isCollateralized(user.collateralBalance, newBorrowBalance),
            "Insufficient collateral"
        );
        
        user.borrowBalance = newBorrowBalance;
        totalBorrows += amount;
        
        require(token.transfer(msg.sender, amount), "Transfer failed");
        
        emit Borrow(msg.sender, amount);
    }
    
    function repay(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        _updateInterest(msg.sender);
        
        UserData storage user = users[msg.sender];
        require(user.borrowBalance >= amount, "Repay amount exceeds debt");
        
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        user.borrowBalance -= amount;
        totalBorrows -= amount;
        
        emit Repay(msg.sender, amount);
    }
    
    function liquidate(address userToLiquidate, uint256 amount) external nonReentrant {
        _updateInterest(userToLiquidate);
        
        UserData storage user = users[userToLiquidate];
        
        require(
            !_isCollateralized(user.collateralBalance, user.borrowBalance) ||
            _getCollateralizationRatio(user.collateralBalance, user.borrowBalance) < liquidationThreshold,
            "User is not liquidatable"
        );
        
        require(amount <= user.borrowBalance, "Amount exceeds debt");
        
        uint256 collateralToSeize = (amount * 105) / 100;
        require(collateralToSeize <= user.collateralBalance, "Insufficient collateral");
        
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        require(collateralToken.transfer(msg.sender, collateralToSeize), "Collateral transfer failed");
        
        user.borrowBalance -= amount;
        user.collateralBalance -= collateralToSeize;
        totalBorrows -= amount;
        
        emit Liquidate(msg.sender, userToLiquidate, amount);
    }
    
    function _updateInterest(address userAddress) internal {
        UserData storage user = users[userAddress];
        
        if (user.borrowBalance > 0 && user.lastInterestUpdate > 0) {
            uint256 timeElapsed = block.timestamp - user.lastInterestUpdate;
            uint256 interest = (user.borrowBalance * interestRate * timeElapsed) / 
                             (100 * SECONDS_PER_YEAR);
            user.borrowBalance += interest;
            totalBorrows += interest;
        }
        
        user.lastInterestUpdate = block.timestamp;
    }
    
    function _isCollateralized(uint256 collateral, uint256 debt) internal view returns (bool) {
        if (debt == 0) return true;
        return _getCollateralizationRatio(collateral, debt) >= collateralizationRatio;
    }
    
    function _getCollateralizationRatio(uint256 collateral, uint256 debt) internal pure returns (uint256) {
        if (debt == 0) return type(uint256).max;
        return (collateral * 100) / debt; // Assuming 1:1 price ratio for simplicity
    }
    
    function getUserData(address userAddress) external view returns (UserData memory) {
        return users[userAddress];
    }
    
    function getUtilizationRate() external view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return (totalBorrows * PRECISION) / totalDeposits;
    }
}