const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingPool", function() {
    let lendingPool;
    let token;
    let collateralToken;
    let owner, user1, user2, liquidator;
    
    const INITIAL_SUPPLY = ethers.utils.parseEther("1000000");
    const DEPOSIT_AMOUNT = ethers.utils.parseEther("1000");
    const COLLATERAL_AMOUNT = ethers.utils.parseEther("200"); 
    const BORROW_AMOUNT = ethers.utils.parseEther("100");
    
    beforeEach(async function() {
        [owner, user1, user2, liquidator] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("Test Token", "TEST", INITIAL_SUPPLY);
        collateralToken = await MockERC20.deploy("Collateral Token", "COLL", INITIAL_SUPPLY);
        
        const LendingPool = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPool.deploy(token.address, collateralToken.address);
        
        await token.transfer(user1.address, ethers.utils.parseEther("10000"));
        await token.transfer(user2.address, ethers.utils.parseEther("10000"));
        await token.transfer(liquidator.address, ethers.utils.parseEther("10000"));
        
        await collateralToken.transfer(user1.address, ethers.utils.parseEther("1000"));
        await collateralToken.transfer(user2.address, ethers.utils.parseEther("1000"));
        
        await token.connect(user1).approve(lendingPool.address, ethers.constants.MaxUint256);
        await token.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
        await token.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);
        
        await collateralToken.connect(user1).approve(lendingPool.address, ethers.constants.MaxUint256);
        await collateralToken.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
    });
    
    describe("Deposits", function() {
        it("Should allow deposits and calculate interest", async function() {
            await lendingPool.connect(user1).deposit(DEPOSIT_AMOUNT);
            
            const userData = await lendingPool.getUserData(user1.address);
            expect(userData.depositBalance).to.equal(DEPOSIT_AMOUNT);
            
            const totalDeposits = await lendingPool.totalDeposits();
            expect(totalDeposits).to.equal(DEPOSIT_AMOUNT);
            
            const contractBalance = await token.balanceOf(lendingPool.address);
            expect(contractBalance).to.equal(DEPOSIT_AMOUNT);
        });
        
        it("Should revert on zero deposit", async function() {
            await expect(
                lendingPool.connect(user1).deposit(0)
            ).to.be.revertedWith("Amount must be greater than 0");
        });
    });
    
    describe("Borrowing", function() {
        beforeEach(async function() {
            await lendingPool.connect(user1).deposit(DEPOSIT_AMOUNT);
            await lendingPool.connect(user2).depositCollateral(COLLATERAL_AMOUNT);
        });
        
        it("Should enforce collateralization ratio", async function() {
            await expect(
                lendingPool.connect(user2).borrow(BORROW_AMOUNT)
            ).to.not.be.reverted;
            
            await expect(
                lendingPool.connect(user2).borrow(BORROW_AMOUNT.mul(2))
            ).to.be.revertedWith("Insufficient collateral");
        });
        
        it("Should update borrow balance correctly", async function() {
            await lendingPool.connect(user2).borrow(BORROW_AMOUNT);
            
            const userData = await lendingPool.getUserData(user2.address);
            expect(userData.borrowBalance).to.equal(BORROW_AMOUNT);
            
            const totalBorrows = await lendingPool.totalBorrows();
            expect(totalBorrows).to.equal(BORROW_AMOUNT);
        });
        
        it("Should prevent borrowing without collateral", async function() {
            await expect(
                lendingPool.connect(user1).borrow(BORROW_AMOUNT)
            ).to.be.revertedWith("Insufficient collateral");
        });
    });
    
    describe("Repayment", function() {
        beforeEach(async function() {
            await lendingPool.connect(user1).deposit(DEPOSIT_AMOUNT);
            await lendingPool.connect(user2).depositCollateral(COLLATERAL_AMOUNT);
            await lendingPool.connect(user2).borrow(BORROW_AMOUNT);
        });
        
        it("Should allow partial repayment", async function() {
            const repayAmount = BORROW_AMOUNT.div(2);
            await lendingPool.connect(user2).repay(repayAmount);
            
            const userData = await lendingPool.getUserData(user2.address);
            expect(userData.borrowBalance).to.equal(BORROW_AMOUNT.sub(repayAmount));
        });
        
        it("Should allow full repayment", async function() {
            await lendingPool.connect(user2).repay(BORROW_AMOUNT);
            
            const userData = await lendingPool.getUserData(user2.address);
            expect(userData.borrowBalance).to.equal(0);
        });
        
        it("Should prevent over-repayment", async function() {
            await expect(
                lendingPool.connect(user2).repay(BORROW_AMOUNT.mul(2))
            ).to.be.revertedWith("Repay amount exceeds debt");
        });
    });
    
    describe("Liquidations", function() {
        beforeEach(async function() {
            await lendingPool.connect(user1).deposit(DEPOSIT_AMOUNT);
            await lendingPool.connect(user2).depositCollateral(COLLATERAL_AMOUNT);
            await lendingPool.connect(user2).borrow(BORROW_AMOUNT);
        });
        
        it("Should handle liquidations correctly", async function() {
            await lendingPool.connect(user2).borrow(BORROW_AMOUNT.div(2));

            const liquidateAmount = ethers.utils.parseEther("50");
            const initialLiquidatorBalance = await collateralToken.balanceOf(liquidator.address);
            
            await lendingPool.connect(liquidator).liquidate(user2.address, liquidateAmount);
            
            const finalLiquidatorBalance = await collateralToken.balanceOf(liquidator.address);
            const expectedCollateralSeized = liquidateAmount.mul(105).div(100); // 5% bonus
            expect(finalLiquidatorBalance.sub(initialLiquidatorBalance)).to.equal(expectedCollateralSeized);
            
            const userData = await lendingPool.getUserData(user2.address);
            expect(userData.borrowBalance).to.equal(BORROW_AMOUNT.add(BORROW_AMOUNT.div(2)).sub(liquidateAmount));
        });
        
        it("Should prevent liquidation of healthy positions", async function() {
            await expect(
                lendingPool.connect(liquidator).liquidate(user2.address, ethers.utils.parseEther("10"))
            ).to.be.revertedWith("User is not liquidatable");
        });
    });
    
    describe("Interest Calculation", function() {
        it("Should calculate interest over time", async function() {
            await lendingPool.connect(user1).deposit(DEPOSIT_AMOUNT);
            await lendingPool.connect(user2).depositCollateral(COLLATERAL_AMOUNT);
            await lendingPool.connect(user2).borrow(BORROW_AMOUNT);
            
            await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            
            await lendingPool.connect(user2).repay(1);
            
            const userData = await lendingPool.getUserData(user2.address);
            const expectedInterest = BORROW_AMOUNT.mul(5).div(100);
            const tolerance = expectedInterest.div(10);
            
            expect(userData.borrowBalance).to.be.closeTo(
                BORROW_AMOUNT.add(expectedInterest).sub(1),
                tolerance
            );
        });
    });
    
    describe("Utilization Rate", function() {
        it("Should calculate utilization rate correctly", async function() {
            await lendingPool.connect(user1).deposit(DEPOSIT_AMOUNT);
            await lendingPool.connect(user2).depositCollateral(COLLATERAL_AMOUNT);
            await lendingPool.connect(user2).borrow(BORROW_AMOUNT);
            
            const utilizationRate = await lendingPool.getUtilizationRate();
            const expectedRate = BORROW_AMOUNT.mul(ethers.utils.parseEther("1")).div(DEPOSIT_AMOUNT);
            
            expect(utilizationRate).to.equal(expectedRate);
        });
    });
});
