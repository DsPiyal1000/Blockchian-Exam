describe("Edge Cases", function() {
    it("Should handle zero amounts", async function() {
        await expect(token.transfer(addr1.address, 0))
            .to.be.revertedWith("Amount must be greater than zero");
    });
    
    it("Should handle maximum uint256 values", async function() {
        const maxUint256 = ethers.constants.MaxUint256;
        await expect(token.transfer(addr1.address, maxUint256))
            .to.be.revertedWith("Amount exceeds supply");
    });
    
    it("Should handle boundary conditions", async function() {
        const balance = await token.balanceOf(owner.address);
        // Test exactly at boundary
        await token.transfer(addr1.address, balance);
        expect(await token.balanceOf(owner.address)).to.equal(0);
    });
});