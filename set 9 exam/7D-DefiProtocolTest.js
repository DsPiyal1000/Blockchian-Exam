const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingProtocol", function() {
    let lendingPool, collateralToken, borrowToken, priceOracle;
    let owner, lender, borrower, liquidator;
    
    const INITIAL_EXCHANGE_RATE = ethers.utils.parseUnits("1", 18);
    const COLLATERAL_FACTOR = ethers.utils.parseUnits("0.75", 18); // 75%
    const LIQUIDATION_THRESHOLD = ethers.utils.parseUnits("0.8", 18); // 80%
    const INTEREST_RATE = ethers.utils.parseUnits("0.05", 18); // 5% annual
    
    beforeEach(async function() {
        [owner, lender, borrower, liquidator] = await ethers.getSigners();
        
        // Deploy tokens
        const Token = await ethers.getContractFactory("MockERC20");
        collateralToken = await Token.deploy("Collateral", "COLL", 18);
        borrowToken = await Token.deploy("Borrow", "BORR", 18);
        
        // Deploy price oracle
        const PriceOracle = await ethers.getContractFactory("MockPriceOracle");
        priceOracle = await PriceOracle.deploy();
        
        // Deploy lending pool
        const LendingPool = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPool.deploy(
            borrowToken.address,
            collateralToken.address,
            priceOracle.address,
            COLLATERAL_FACTOR,
            LIQUIDATION_THRESHOLD,
            INTEREST_RATE
        );
        
        // Setup initial balances
        await collateralToken.mint(borrower.address, ethers.utils.parseUnits("1000", 18));
        await borrowToken.mint(lender.address, ethers.utils.parseUnits("10000", 18));
        await borrowToken.mint(liquidator.address, ethers.utils.parseUnits("1000", 18));
        
        // Setup approvals
        await collateralToken.connect(borrower).approve(lendingPool.address, ethers.constants.MaxUint256);
        await borrowToken.connect(lender).approve(lendingPool.address, ethers.constants.MaxUint256);
        await borrowToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);
        
        // Set initial prices
        await priceOracle.setPrice(collateralToken.address, ethers.utils.parseUnits("100", 18));
        await priceOracle.setPrice(borrowToken.address, ethers.utils.parseUnits("1", 18));
    });

    describe("Deposits", function() {
        it("Should allow users to deposit lending assets", async function() {
            const depositAmount = ethers.utils.parseUnits("1000", 18);
            
            await expect(lendingPool.connect(lender).deposit(depositAmount))
                .to.emit(lendingPool, "Deposit")
                .withArgs(lender.address, depositAmount);
            
            expect(await lendingPool.totalDeposits()).to.equal(depositAmount);
            expect(await lendingPool.deposits(lender.address)).to.equal(depositAmount);
            expect(await borrowToken.balanceOf(lendingPool.address)).to.equal(depositAmount);
        });
        
        it("Should handle multiple deposits from same user", async function() {
            const deposit1 = ethers.utils.parseUnits("500", 18);
            const deposit2 = ethers.utils.parseUnits("300", 18);
            
            await lendingPool.connect(lender).deposit(deposit1);
            await lendingPool.connect(lender).deposit(deposit2);
            
            expect(await lendingPool.deposits(lender.address)).to.equal(deposit1.add(deposit2));
        });
        
        it("Should reject zero deposits", async function() {
            await expect(lendingPool.connect(lender).deposit(0))
                .to.be.revertedWith("Deposit amount must be greater than zero");
        });
        
        it("Should handle deposit withdrawals", async function() {
            const depositAmount = ethers.utils.parseUnits("1000", 18);
            const withdrawAmount = ethers.utils.parseUnits("400", 18);
            
            await lendingPool.connect(lender).deposit(depositAmount);
            
            await expect(lendingPool.connect(lender).withdraw(withdrawAmount))
                .to.emit(lendingPool, "Withdraw")
                .withArgs(lender.address, withdrawAmount);
            
            expect(await lendingPool.deposits(lender.address)).to.equal(depositAmount.sub(withdrawAmount));
        });
    });

    describe("Borrowing", function() {
        beforeEach(async function() {
            // Ensure liquidity for borrowing
            await lendingPool.connect(lender).deposit(ethers.utils.parseUnits("5000", 18));
        });
        
        it("Should allow borrowing with sufficient collateral", async function() {
            const collateralAmount = ethers.utils.parseUnits("10", 18); // 10 COLL * $100 = $1000
            const borrowAmount = ethers.utils.parseUnits("750", 18); // $750 (75% of collateral)
            
            await expect(lendingPool.connect(borrower).depositCollateral(collateralAmount))
                .to.emit(lendingPool, "CollateralDeposit")
                .withArgs(borrower.address, collateralAmount);
            
            await expect(lendingPool.connect(borrower).borrow(borrowAmount))
                .to.emit(lendingPool, "Borrow")
                .withArgs(borrower.address, borrowAmount);
            
            expect(await lendingPool.collateral(borrower.address)).to.equal(collateralAmount);
            expect(await lendingPool.borrowed(borrower.address)).to.equal(borrowAmount);
            expect(await borrowToken.balanceOf(borrower.address)).to.equal(borrowAmount);
        });
        
        it("Should reject borrowing without sufficient collateral", async function() {
            const collateralAmount = ethers.utils.parseUnits("5", 18); // 5 COLL * $100 = $500
            const borrowAmount = ethers.utils.parseUnits("800", 18); // $800 > $500 * 0.75
            
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            
            await expect(lendingPool.connect(borrower).borrow(borrowAmount))
                .to.be.revertedWith("Insufficient collateral");
        });
        
        it("Should calculate borrowing capacity correctly", async function() {
            const collateralAmount = ethers.utils.parseUnits("20", 18); // $2000 collateral
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            
            const maxBorrow = await lendingPool.getMaxBorrowAmount(borrower.address);
            const expectedMax = ethers.utils.parseUnits("1500", 18); // $2000 * 0.75
            
            expect(maxBorrow).to.equal(expectedMax);
        });
        
        it("Should handle repayment correctly", async function() {
            const collateralAmount = ethers.utils.parseUnits("10", 18);
            const borrowAmount = ethers.utils.parseUnits("500", 18);
            const repayAmount = ethers.utils.parseUnits("300", 18);
            
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            await lendingPool.connect(borrower).borrow(borrowAmount);
            
            // Approve repayment
            await borrowToken.connect(borrower).approve(lendingPool.address, repayAmount);
            
            await expect(lendingPool.connect(borrower).repay(repayAmount))
                .to.emit(lendingPool, "Repay")
                .withArgs(borrower.address, repayAmount);
            
            expect(await lendingPool.borrowed(borrower.address)).to.equal(borrowAmount.sub(repayAmount));
        });
    });

    describe("Liquidations", function() {
        beforeEach(async function() {
            await lendingPool.connect(lender).deposit(ethers.utils.parseUnits("5000", 18));
            
            // Setup a borrower position
            const collateralAmount = ethers.utils.parseUnits("10", 18);
            const borrowAmount = ethers.utils.parseUnits("750", 18);
            
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            await lendingPool.connect(borrower).borrow(borrowAmount);
        });
        
        it("Should liquidate undercollateralized positions", async function() {
            // Simulate price drop to trigger liquidation
            await priceOracle.setPrice(collateralToken.address, ethers.utils.parseUnits("80", 18));
            
            const isLiquidatable = await lendingPool.isLiquidatable(borrower.address);
            expect(isLiquidatable).to.be.true;
            
            const liquidateAmount = ethers.utils.parseUnits("400", 18);
            
            await expect(lendingPool.connect(liquidator).liquidate(borrower.address, liquidateAmount))
                .to.emit(lendingPool, "Liquidation")
                .withArgs(liquidator.address, borrower.address, liquidateAmount);
        });
        
        it("Should not allow liquidation of healthy positions", async function() {
            const liquidateAmount = ethers.utils.parseUnits("100", 18);
            
            await expect(lendingPool.connect(liquidator).liquidate(borrower.address, liquidateAmount))
                .to.be.revertedWith("Position is not liquidatable");
        });
        
        it("Should calculate liquidation bonus correctly", async function() {
            await priceOracle.setPrice(collateralToken.address, ethers.utils.parseUnits("80", 18));
            
            const liquidateAmount = ethers.utils.parseUnits("400", 18);
            const initialLiquidatorBalance = await collateralToken.balanceOf(liquidator.address);
            
            await lendingPool.connect(liquidator).liquidate(borrower.address, liquidateAmount);
            
            const finalLiquidatorBalance = await collateralToken.balanceOf(liquidator.address);
            const collateralReceived = finalLiquidatorBalance.sub(initialLiquidatorBalance);
            
            // Should receive more than 1:1 due to liquidation bonus
            expect(collateralReceived).to.be.gt(liquidateAmount.div(80)); // More than direct conversion
        });
    });

    describe("Interest Accrual", function() {
        beforeEach(async function() {
            await lendingPool.connect(lender).deposit(ethers.utils.parseUnits("5000", 18));
            
            const collateralAmount = ethers.utils.parseUnits("10", 18);
            const borrowAmount = ethers.utils.parseUnits("500", 18);
            
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            await lendingPool.connect(borrower).borrow(borrowAmount);
        });
        
        it("Should accrue interest over time", async function() {
            const initialBorrowed = await lendingPool.borrowed(borrower.address);
            
            // Advance time by 1 year
            await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            
            await lendingPool.accrueInterest(borrower.address);
            
            const finalBorrowed = await lendingPool.borrowed(borrower.address);
            const interestAccrued = finalBorrowed.sub(initialBorrowed);
            
            // Should be approximately 5% interest
            const expectedInterest = initialBorrowed.mul(5).div(100);
            expect(interestAccrued).to.be.closeTo(expectedInterest, expectedInterest.div(10));
        });
        
        it("Should compound interest correctly", async function() {
            const initialBorrowed = await lendingPool.borrowed(borrower.address);
            
            // Advance time by 6 months
            await ethers.provider.send("evm_increaseTime", [182 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await lendingPool.accrueInterest(borrower.address);
            
            const midBorrowed = await lendingPool.borrowed(borrower.address);
            
            // Advance another 6 months
            await ethers.provider.send("evm_increaseTime", [183 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await lendingPool.accrueInterest(borrower.address);
            
            const finalBorrowed = await lendingPool.borrowed(borrower.address);
            
            // Interest should compound
            expect(finalBorrowed).to.be.gt(midBorrowed);
            expect(finalBorrowed.sub(initialBorrowed)).to.be.gt(initialBorrowed.mul(5).div(100));
        });
    });

    describe("Oracle Integration", function() {
        it("Should handle price updates correctly", async function() {
            const newPrice = ethers.utils.parseUnits("150", 18);
            
            await priceOracle.setPrice(collateralToken.address, newPrice);
            
            expect(await priceOracle.getPrice(collateralToken.address)).to.equal(newPrice);
        });
        
        it("Should adjust borrowing capacity with price changes", async function() {
            const collateralAmount = ethers.utils.parseUnits("10", 18);
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            
            const initialCapacity = await lendingPool.getMaxBorrowAmount(borrower.address);
            
            // Increase collateral price
            await priceOracle.setPrice(collateralToken.address, ethers.utils.parseUnits("200", 18));
            
            const newCapacity = await lendingPool.getMaxBorrowAmount(borrower.address);
            expect(newCapacity).to.be.gt(initialCapacity);
        });
        
        it("Should handle stale price data", async function() {
            await priceOracle.setStalePrice(collateralToken.address);
            
            await expect(lendingPool.getMaxBorrowAmount(borrower.address))
                .to.be.revertedWith("Stale price data");
        });
        
        it("Should validate price bounds", async function() {
            await expect(priceOracle.setPrice(collateralToken.address, 0))
                .to.be.revertedWith("Invalid price");
            
            const maxPrice = ethers.utils.parseUnits("1000000", 18);
            await expect(priceOracle.setPrice(collateralToken.address, maxPrice))
                .to.be.revertedWith("Price too high");
        });
    });

    describe("System Health", function() {
        it("Should maintain system solvency", async function() {
            await lendingPool.connect(lender).deposit(ethers.utils.parseUnits("5000", 18));
            
            const collateralAmount = ethers.utils.parseUnits("20", 18);
            const borrowAmount = ethers.utils.parseUnits("1000", 18);
            
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            await lendingPool.connect(borrower).borrow(borrowAmount);
            
            const totalDeposits = await lendingPool.totalDeposits();
            const totalBorrowed = await lendingPool.totalBorrowed();
            const availableLiquidity = await lendingPool.availableLiquidity();
            
            expect(totalDeposits).to.be.gte(totalBorrowed);
            expect(availableLiquidity).to.equal(totalDeposits.sub(totalBorrowed));
        });
        
        it("Should prevent borrowing when insufficient liquidity", async function() {
            await lendingPool.connect(lender).deposit(ethers.utils.parseUnits("100", 18));
            
            const collateralAmount = ethers.utils.parseUnits("50", 18);
            const borrowAmount = ethers.utils.parseUnits("200", 18);
            
            await lendingPool.connect(borrower).depositCollateral(collateralAmount);
            
            await expect(lendingPool.connect(borrower).borrow(borrowAmount))
                .to.be.revertedWith("Insufficient liquidity");
        });
    });
});