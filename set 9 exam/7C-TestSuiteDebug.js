const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Token", function() {
    let token;
    let owner, addr1, addr2;
    
    beforeEach(async function() {
        // Fix: Get signers properly
        [owner, addr1, addr2] = await ethers.getSigners();
        
        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        
        // Fix: Proper await for deployment
        await token.deployed();
        
        // Improvement: Initial setup with proper token distribution
        const initialSupply = await token.totalSupply();
        expect(initialSupply).to.be.gt(0);
    });

    describe("Transfer Functionality", function() {
        it("Should transfer tokens successfully", async function() {
            const transferAmount = ethers.utils.parseUnits("50", 18);
            const initialOwnerBalance = await token.balanceOf(owner.address);
            const initialAddr1Balance = await token.balanceOf(addr1.address);
            
            // Fix: Proper amount specification and transaction
            await expect(token.transfer(addr1.address, transferAmount))
                .to.emit(token, "Transfer")
                .withArgs(owner.address, addr1.address, transferAmount);
            
            // Fix: Proper balance checks with BigNumber handling
            expect(await token.balanceOf(addr1.address))
                .to.equal(initialAddr1Balance.add(transferAmount));
            expect(await token.balanceOf(owner.address))
                .to.equal(initialOwnerBalance.sub(transferAmount));
        });
        
        it("Should fail on insufficient balance", async function() {
            const ownerBalance = await token.balanceOf(owner.address);
            const excessiveAmount = ownerBalance.add(1);
            
            // Fix: Proper revert testing with expect
            await expect(token.transfer(addr1.address, excessiveAmount))
                .to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });
        
        // Improvement: Additional edge case tests
        it("Should handle zero amount transfers", async function() {
            const initialBalance = await token.balanceOf(addr1.address);
            await token.transfer(addr1.address, 0);
            expect(await token.balanceOf(addr1.address)).to.equal(initialBalance);
        });
        
        it("Should handle self transfers", async function() {
            const transferAmount = ethers.utils.parseUnits("10", 18);
            const initialBalance = await token.balanceOf(owner.address);
            
            await token.transfer(owner.address, transferAmount);
            expect(await token.balanceOf(owner.address)).to.equal(initialBalance);
        });
    });
    
    describe("Allowance Functionality", function() {
        it("Should approve and transferFrom correctly", async function() {
            const allowanceAmount = ethers.utils.parseUnits("100", 18);
            const transferAmount = ethers.utils.parseUnits("50", 18);
            
            await token.approve(addr1.address, allowanceAmount);
            expect(await token.allowance(owner.address, addr1.address))
                .to.equal(allowanceAmount);
            
            await token.connect(addr1).transferFrom(owner.address, addr2.address, transferAmount);
            expect(await token.allowance(owner.address, addr1.address))
                .to.equal(allowanceAmount.sub(transferAmount));
        });
    });
});