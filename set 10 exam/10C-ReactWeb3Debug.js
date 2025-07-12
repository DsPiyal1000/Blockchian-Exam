import { useState, useEffect, useCallback } from 'react';  
import { ethers } from 'ethers';  
  
// ERC20 ABI - only the functions we need  
const ERC20_ABI = [  
  'function balanceOf(address owner) view returns (uint256)',  
  'function decimals() view returns (uint8)',  
  'function symbol() view returns (string)'  
];  
  
function TokenBalance({ tokenAddress }) {  
  const [balance, setBalance] = useState('0');  
  const [account, setAccount] = useState(null);  
  const [provider, setProvider] = useState(null);  
  const [loading, setLoading] = useState(false);  
  const [error, setError] = useState(null);  
  const [tokenSymbol, setTokenSymbol] = useState('');  
    
  // Connect wallet with proper error handling  
  const connectWallet = useCallback(async () => {  
    try {  
      setLoading(true);  
      setError(null);  
        
      // Check if ethereum is available  
      if (!window.ethereum) {  
        throw new Error('Please install MetaMask or another Web3 wallet');  
      }  
        
      // Request accounts  
      const accounts = await window.ethereum.request({  
        method: 'eth_requestAccounts'  
      });  
        
      if (accounts.length === 0) {  
        throw new Error('No accounts found');  
      }  
        
      setAccount(accounts[0]);  
        
      // Create and store provider  
      const web3Provider = new ethers.providers.Web3Provider(window.ethereum);  
      setProvider(web3Provider);  
        
      return { account: accounts[0], provider: web3Provider };  
    } catch (err) {  
      setError(err.message);  
      console.error('Wallet connection error:', err);  
      return null;  
    } finally {  
      setLoading(false);  
    }  
  }, []);  
    
  // Get token balance  
  const getBalance = useCallback(async (userAccount, web3Provider, contractAddress) => {  
    try {  
      if (!userAccount || !web3Provider || !contractAddress) {  
        return;  
      }  
        
      // Validate token address  
      if (!ethers.utils.isAddress(contractAddress)) {  
        throw new Error('Invalid token address');  
      }  
        
      // Create contract instance with ABI  
      const contract = new ethers.Contract(  
        contractAddress,   
        ERC20_ABI,   
        web3Provider  
      );  
        
      // Get balance and decimals in parallel  
      const [rawBalance, decimals, symbol] = await Promise.all([  
        contract.balanceOf(userAccount),  
        contract.decimals(),  
        contract.symbol()  
      ]);  
        
      // Format balance with proper decimals  
      const formattedBalance = ethers.utils.formatUnits(rawBalance, decimals);  
      setBalance(formattedBalance);  
      setTokenSymbol(symbol);  
        
    } catch (err) {  
      setError(`Failed to fetch balance: ${err.message}`);  
      console.error('Balance fetch error:', err);  
    }  
  }, []);  
    
  // Initial connection  
  useEffect(() => {  
    let mounted = true;  
      
    const init = async () => {  
      const result = await connectWallet();  
      if (result && mounted) {  
        await getBalance(result.account, result.provider, tokenAddress);  
      }  
    };  
      
    init();  
      
    // Cleanup function  
    return () => {  
      mounted = false;  
    };  
  }, []); // Empty deps for initial load only  
    
  // Watch for token address changes  
  useEffect(() => {  
    if (account && provider && tokenAddress) {  
      getBalance(account, provider, tokenAddress);  
    }  
  }, [tokenAddress, account, provider, getBalance]);  
    
  // Listen for account changes  
  useEffect(() => {  
    if (!window.ethereum) return;  
      
    const handleAccountsChanged = (accounts) => {  
      if (accounts.length > 0) {  
        setAccount(accounts[0]);  
      } else {  
        // User disconnected wallet  
        setAccount(null);  
        setBalance('0');  
      }  
    };  
      
    const handleChainChanged = () => {  
      // Reload page on chain change (recommended by MetaMask)  
      window.location.reload();  
    };  
      
    window.ethereum.on('accountsChanged', handleAccountsChanged);  
    window.ethereum.on('chainChanged', handleChainChanged);  
      
    // Cleanup listeners  
    return () => {  
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);  
      window.ethereum.removeListener('chainChanged', handleChainChanged);  
    };  
  }, []);  
    
  // Render UI  
  if (loading) {  
    return <div className="loading">Connecting wallet...</div>;  
  }  
    
  if (error) {  
    return (  
      <div className="error">  
        <p>Error: {error}</p>  
        <button onClick={connectWallet}>Retry</button>  
      </div>  
    );  
  }  
    
  if (!account) {  
    return (  
      <div className="connect-prompt">  
        <button onClick={connectWallet}>Connect Wallet</button>  
      </div>  
    );  
  }  
    
  return (  
    <div className="token-balance">  
      <p>Account: {account.slice(0, 6)}...{account.slice(-4)}</p>  
      <p>Balance: {parseFloat(balance).toFixed(4)} {tokenSymbol}</p>  
    </div>  
  );  
}  
  
export default TokenBalance;  