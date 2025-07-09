describe("Gas Optimization", function() {
    it("Should optimize batch transfers", async function() {
        const tx1 = await token.transfer(addr1.address, 100);
        const receipt1 = await tx1.wait();
        
        const tx2 = await token.batchTransfer([addr1.address, addr2.address], [100, 200]);
        const receipt2 = await tx2.wait();
        
        // Ensure batch is more efficient
        expect(receipt2.gasUsed).to.be.lt(receipt1.gasUsed.mul(2));
    });
    
    it("Should track gas usage over time", async function() {
        const gasUsed = [];
        for (let i = 0; i < 10; i++) {
            const tx = await token.transfer(addr1.address, 10);
            const receipt = await tx.wait();
            gasUsed.push(receipt.gasUsed);
        }
        
        // Gas should remain consistent
        const avgGas = gasUsed.reduce((a, b) => a.add(b)).div(gasUsed.length);
        gasUsed.forEach(gas => {
            expect(gas).to.be.closeTo(avgGas, avgGas.mul(5).div(100)); // 5% tolerance
        });
    });
});