import React, { useState, useEffect, useCallback, useMemo } from 'react';  
import { ethers } from 'ethers';  
import { toast } from 'react-toastify';  
  
// Token list (in production, fetch from token list API)  
const TOKEN_LIST = [  
  {  
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',  
    symbol: 'DAI',  
    name: 'Dai Stablecoin',  
    decimals: 18,  
    logoURI: 'https://tokens.1inch.io/0x6b175474e89094c44da98b954eedeac495271d0f.png'  
  },  
  {  
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  
    symbol: 'USDC',  
    name: 'USD Coin',  
    decimals: 6,  
    logoURI: 'https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png'  
  },  
  {  
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',  
    symbol: 'WETH',  
    name: 'Wrapped Ether',  
    decimals: 18,  
    logoURI: 'https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png'  
  }  
];  
  
// ABIs  
const ERC20_ABI = [  
  'function balanceOf(address owner) view returns (uint256)',  
  'function decimals() view returns (uint8)',  
  'function symbol() view returns (string)',  
  'function approve(address spender, uint256 amount) returns (bool)',  
  'function allowance(address owner, address spender) view returns (uint256)'  
];  
  
const ROUTER_ABI = [  
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',  
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',  
  'function WETH() external pure returns (address)'  
];  
  
// Constants  
const ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // Uniswap V2 Router  
  
function DEXInterface() {  
  // Wallet state  
  const [account, setAccount] = useState(null);  
  const [provider, setProvider] = useState(null);  
  const [signer, setSigner] = useState(null);  
  const [chainId, setChainId] = useState(null);  
    
  // Token selection state  
  const [tokenIn, setTokenIn] = useState(TOKEN_LIST[0]);  
  const [tokenOut, setTokenOut] = useState(TOKEN_LIST[1]);  
  const [amountIn, setAmountIn] = useState('');  
  const [amountOut, setAmountOut] = useState('');  
    
  // Balances  
  const [balances, setBalances] = useState({});  
    
  // Transaction state  
  const [isSwapping, setIsSwapping] = useState(false);  
  const [txHistory, setTxHistory] = useState([]);  
    
  // Price state  
  const [priceImpact, setPriceImpact] = useState(0);  
  const [exchangeRate, setExchangeRate] = useState(0);  
    
  // Modal state  
  const [showTokenSelect, setShowTokenSelect] = useState(false);  
  const [selectingTokenFor, setSelectingTokenFor] = useState(null);  
    
  // Connect wallet  
  const connectWallet = async () => {  
    try {  
      if (!window.ethereum) {  
        toast.error('Please install MetaMask!');  
        return;  
      }  
        
      const accounts = await window.ethereum.request({  
        method: 'eth_requestAccounts'  
      });  
        
      const web3Provider = new ethers.providers.Web3Provider(window.ethereum);  
      const web3Signer = web3Provider.getSigner();  
      const network = await web3Provider.getNetwork();  
        
      setAccount(accounts[0]);  
      setProvider(web3Provider);  
      setSigner(web3Signer);  
      setChainId(network.chainId);  
        
      toast.success('Wallet connected!');  
        
      // Load transaction history from localStorage  
      const savedHistory = localStorage.getItem(`txHistory_${accounts[0]}`);  
      if (savedHistory) {  
        setTxHistory(JSON.parse(savedHistory));  
      }  
        
    } catch (error) {  
      console.error('Failed to connect wallet:', error);  
      toast.error('Failed to connect wallet');  
    }  
  };  
    
  // Disconnect wallet  
  const disconnectWallet = () => {  
    setAccount(null);  
    setProvider(null);  
    setSigner(null);  
    setBalances({});  
    toast.info('Wallet disconnected');  
  };  
    
  // Fetch token balance  
  const fetchBalance = async (tokenAddress, userAddress) => {  
    if (!provider || !userAddress) return '0';  
      
    try {  
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);  
      const balance = await contract.balanceOf(userAddress);  
      const decimals = await contract.decimals();  
      return ethers.utils.formatUnits(balance, decimals);  
    } catch (error) {  
      console.error('Error fetching balance:', error);  
      return '0';  
    }  
  };  
    
  // Update all balances  
  const updateBalances = useCallback(async () => {  
    if (!account || !provider) return;  
      
    const newBalances = {};  
      
    // Fetch ETH balance  
    const ethBalance = await provider.getBalance(account);  
    newBalances['ETH'] = ethers.utils.formatEther(ethBalance);  
      
    // Fetch token balances  
    for (const token of TOKEN_LIST) {  
      newBalances[token.symbol] = await fetchBalance(token.address, account);  
    }  
      
    setBalances(newBalances);  
  }, [account, provider]);  
    
  // Calculate output amount  
  const calculateAmountOut = useCallback(async () => {  
    if (!provider || !amountIn || amountIn === '0' || !tokenIn || !tokenOut) {  
      setAmountOut('');  
      return;  
    }  
      
    try {  
      const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);  
      const path = [tokenIn.address, tokenOut.address];  
      const amountInWei = ethers.utils.parseUnits(amountIn, tokenIn.decimals);  
        
      const amounts = await router.getAmountsOut(amountInWei, path);  
      const amountOutWei = amounts[1];  
      const formattedAmountOut = ethers.utils.formatUnits(amountOutWei, tokenOut.decimals);  
        
      setAmountOut(formattedAmountOut);  
        
      // Calculate exchange rate  
      const rate = parseFloat(formattedAmountOut) / parseFloat(amountIn);  
      setExchangeRate(rate);  
        
      // Simple price impact calculation (in production, use better method)  
      const impact = Math.abs((1 - rate) * 100);  
      setPriceImpact(impact);  
        
    } catch (error) {  
      console.error('Error calculating output:', error);  
      setAmountOut('');  
    }  
  }, [provider, amountIn, tokenIn, tokenOut]);  
    
  // Execute swap  
  const executeSwap = async () => {  
    if (!signer || !tokenIn || !tokenOut || !amountIn) return;  
      
    try {  
      setIsSwapping(true);  
        
      // Check allowance  
      const tokenContract = new ethers.Contract(tokenIn.address, ERC20_ABI, signer);  
      const currentAllowance = await tokenContract.allowance(account, ROUTER_ADDRESS);  
      const amountInWei = ethers.utils.parseUnits(amountIn, tokenIn.decimals);  
        
      // Approve if needed  
      if (currentAllowance.lt(amountInWei)) {  
        toast.info('Approving token...');  
        const approveTx = await tokenContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);  
        await approveTx.wait();  
        toast.success('Token approved!');  
      }  
        
      // Execute swap  
      const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);  
      const path = [tokenIn.address, tokenOut.address];  
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes  
      const amountOutMin = ethers.utils.parseUnits(  
        (parseFloat(amountOut) * 0.95).toString(), // 5% slippage  
        tokenOut.decimals  
      );  
        
      toast.info('Executing swap...');  
      const swapTx = await router.swapExactTokensForTokens(  
        amountInWei,  
        amountOutMin,  
        path,  
        account,  
        deadline  
      );  
        
      const receipt = await swapTx.wait();  
        
      // Add to history  
      const txRecord = {  
        hash: receipt.transactionHash,  
        tokenIn: tokenIn.symbol,  
        tokenOut: tokenOut.symbol,  
        amountIn,  
        amountOut,  
        timestamp: Date.now()  
      };  
        
      const newHistory = [txRecord, ...txHistory].slice(0, 50); // Keep last 50  
      setTxHistory(newHistory);  
      localStorage.setItem(`txHistory_${account}`, JSON.stringify(newHistory));  
        
      toast.success('Swap successful!');  
        
      // Reset form  
      setAmountIn('');  
      setAmountOut('');  
        
      // Update balances  
      await updateBalances();  
        
    } catch (error) {  
      console.error('Swap error:', error);  
      toast.error('Swap failed: ' + error.message);  
    } finally {  
      setIsSwapping(false);  
    }  
  };  
    
  // Handle token selection  
  const selectToken = (token) => {  
    if (selectingTokenFor === 'in') {  
      if (token.address === tokenOut.address) {  
        // Swap tokens if selecting the same as output  
        setTokenOut(tokenIn);  
      }  
      setTokenIn(token);  
    } else {  
      if (token.address === tokenIn.address) {  
        // Swap tokens if selecting the same as input  
        setTokenIn(tokenOut);  
      }  
      setTokenOut(token);  
    }  
    setShowTokenSelect(false);  
  };  
    
  // Effects  
  useEffect(() => {  
    updateBalances();  
  }, [updateBalances]);  
    
  useEffect(() => {  
    calculateAmountOut();  
  }, [calculateAmountOut]);  
    
  // Listen for account changes  
  useEffect(() => {  
    if (!window.ethereum) return;  
      
    const handleAccountsChanged = (accounts) => {  
      if (accounts.length > 0 && accounts[0] !== account) {  
        window.location.reload();  
      }  
    };  
      
    window.ethereum.on('accountsChanged', handleAccountsChanged);  
    return () => window.ethereum.removeListener('accountsChanged', handleAccountsChanged);  
  }, [account]);  
    
  // Auto-refresh prices  
  useEffect(() => {  
    const interval = setInterval(() => {  
      if (amountIn) {  
        calculateAmountOut();  
      }  
    }, 15000); // Every 15 seconds  
      
    return () => clearInterval(interval);  
  }, [amountIn, calculateAmountOut]);  
    
  return (  
    <div className="dex-interface">  
      {/* Header */}  
      <header className="dex-header">  
        <h1>DEX Interface</h1>  
        <div className="wallet-section">  
          {account ? (  
            <div className="wallet-info">  
              <span className="address">  
                {account.slice(0, 6)}...{account.slice(-4)}  
              </span>  
              <button onClick={disconnectWallet} className="btn-disconnect">  
                Disconnect  
              </button>  
            </div>  
          ) : (  
            <button onClick={connectWallet} className="btn-connect">  
              Connect Wallet  
            </button>  
          )}  
        </div>  
      </header>  
        
      {/* Main swap interface */}  
      <main className="swap-container">  
        <div className="swap-box">  
          <h2>Swap</h2>  
            
          {/* Token In */}  
          <div className="token-input-group">  
            <label>From</label>  
            <div className="token-input">  
              <input  
                type="number"  
                placeholder="0.0"  
                value={amountIn}  
                onChange={(e) => setAmountIn(e.target.value)}  
                disabled={!account}  
              />  
              <button  
                className="token-select-btn"  
                onClick={() => {  
                  setSelectingTokenFor('in');  
                  setShowTokenSelect(true);  
                }}  
              >  
                <img src={tokenIn.logoURI} alt={tokenIn.symbol} />  
                {tokenIn.symbol}  
                <span className="arrow">▼</span>  
              </button>  
            </div>  
            {account && (  
              <div className="balance">  
                Balance: {balances[tokenIn.symbol] || '0'}  
                <button  
                  className="max-btn"  
                  onClick={() => setAmountIn(balances[tokenIn.symbol] || '0')}  
                >  
                  MAX  
                </button>  
              </div>  
            )}  
          </div>  
            
          {/* Swap arrow */}  
          <div className="swap-arrow">  
            <button  
              onClick={() => {  
                setTokenIn(tokenOut);  
                setTokenOut(tokenIn);  
                setAmountIn(amountOut);  
                setAmountOut(amountIn);  
              }}  
            >  
              ↓  
            </button>  
          </div>  
            
          {/* Token Out */}  
          <div className="token-input-group">  
            <label>To</label>  
            <div className="token-input">  
              <input  
                type="number"  
                placeholder="0.0"  
                value={amountOut}  
                readOnly  
                disabled={!account}  
              />  
              <button  
                className="token-select-btn"  
                onClick={() => {  
                  setSelectingTokenFor('out');  
                  setShowTokenSelect(true);  
                }}  
              >  
                <img src={tokenOut.logoURI} alt={tokenOut.symbol} />  
                {tokenOut.symbol}  
                <span className="arrow">▼</span>  
              </button>  
            </div>  
            {account && (  
              <div className="balance">  
                Balance: {balances[tokenOut.symbol] || '0'}  
              </div>  
            )}  
          </div>  
            
          {/* Price info */}  
          {exchangeRate > 0 && (  
            <div className="price-info">  
              <div>  
                1 {tokenIn.symbol} = {exchangeRate.toFixed(6)} {tokenOut.symbol}  
              </div>  
              <div className={`price-impact ${priceImpact > 5 ? 'high' : ''}`}>  
                Price Impact: {priceImpact.toFixed(2)}%  
              </div>  
            </div>  
          )}  
            
          {/* Swap button */}  
          <button  
            className="swap-btn"  
            onClick={executeSwap}  
            disabled={!account || !amountIn || !amountOut || isSwapping}  
          >  
            {!account  
              ? 'Connect Wallet'  
              : !amountIn  
              ? 'Enter Amount'  
              : isSwapping  
              ? 'Swapping...'  
              : 'Swap'}  
          </button>  
        </div>  
          
        {/* Transaction History */}  
        {account && txHistory.length > 0 && (  
          <div className="tx-history">  
            <h3>Recent Transactions</h3>  
            <div className="tx-list">  
              {txHistory.slice(0, 5).map((tx) => (  
                <div key={tx.hash} className="tx-item">  
                  <div className="tx-tokens">  
                    {tx.amountIn} {tx.tokenIn} → {tx.amountOut} {tx.tokenOut}  
                  </div>  
                  <div className="tx-meta">  
                    <span className="tx-time">  
                      {new Date(tx.timestamp).toLocaleTimeString()}  
                    </span>  
                    <a  
                      href={`https://etherscan.io/tx/${tx.hash}`}  
                      target="_blank"  
                      rel="noopener noreferrer"  
                      className="tx-link"  
                    >  
                      View →  
                    </a>  
                  </div>  
                </div>  
              ))}  
            </div>  
          </div>  
        )}  
      </main>  
        
      {/* Token Selection Modal */}  
      {showTokenSelect && (  
        <div className="modal-overlay" onClick={() => setShowTokenSelect(false)}>  
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>  
            <h3>Select Token</h3>  
            <div className="token-list">  
              {TOKEN_LIST.map((token) => (  
                <button  
                  key={token.address}  
                  className="token-item"  
                  onClick={() => selectToken(token)}  
                >  
                  <img src={token.logoURI} alt={token.symbol} />  
                  <div>  
                    <div className="token-symbol">{token.symbol}</div>  
                    <div className="token-name">{token.name}</div>  
                  </div>  
                  {account && (  
                    <div className="token-balance">  
                      {balances[token.symbol] || '0'}  
                    </div>  
                  )}  
                </button>  
              ))}  
            </div>  
          </div>  
        </div>  
      )}  
        
      <style jsx>{`  
        .dex-interface {  
          max-width: 1200px;  
          margin: 0 auto;  
          padding: 20px;  
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;  
        }  
          
        .dex-header {  
          display: flex;  
          justify-content: space-between;  
          align-items: center;  
          margin-bottom: 30px;  
        }  
          
        .wallet-info {  
          display: flex;  
          align-items: center;  
          gap: 10px;  
        }  
          
        .address {  
          padding: 8px 12px;  
          background: #f0f0f0;  
          border-radius: 8px;  
          font-family: monospace;  
        }  
          
        .swap-container {  
          display: grid;  
          grid-template-columns: 1fr;  
          gap: 20px;  
          max-width: 480px;  
          margin: 0 auto;  
        }  
          
        .swap-box {  
          background: white;  
          border-radius: 16px;  
          padding: 24px;  
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);  
        }  
          
        .token-input-group {  
          margin-bottom: 16px;  
        }  
          
        .token-input {  
          display: flex;  
          align-items: center;  
          background: #f7f7f7;  
          border-radius: 12px;  
          padding: 16px;  
          margin-top: 8px;  
        }  
          
        .token-input input {  
          flex: 1;  
          border: none;  
          background: none;  
          font-size: 24px;  
          outline: none;  
        }  
          
        .token-select-btn {  
          display: flex;  
          align-items: center;  
          gap: 8px;  
          padding: 8px 12px;  
          background: white;  
          border: 1px solid #e0e0e0;  
          border-radius: 12px;  
          cursor: pointer;  
          transition: all 0.2s;  
        }  
          
        .token-select-btn:hover {  
          background: #f0f0f0;  
        }  
          
        .token-select-btn img {  
          width: 24px;  
          height: 24px;  
          border-radius: 50%;  
        }  
          
        .balance {  
          display: flex;  
          justify-content: space-between;  
          align-items: center;  
          margin-top: 8px;  
          font-size: 14px;  
          color: #666;  
        }  
          
        .max-btn {  
          padding: 4px 8px;  
          background: #e0e0e0;  
          border: none;  
          border-radius: 4px;  
          cursor: pointer;  
          font-size: 12px;  
          font-weight: 600;  
        }  
          
        .swap-arrow {  
          display: flex;  
          justify-content: center;  
          margin: 8px 0;  
        }  
          
        .swap-arrow button {  
          width: 40px;  
          height: 40px;  
          border-radius: 50%;  
          border: 2px solid #e0e0e0;  
          background: white;  
          cursor: pointer;  
          font-size: 20px;  
          transition: all 0.2s;  
        }  
          
        .swap-arrow button:hover {  
          transform: rotate(180deg);  
        }  
          
        .price-info {  
          padding: 12px;  
          background: #f7f7f7;  
          border-radius: 8px;  
          margin-bottom: 16px;  
          font-size: 14px;  
        }  
          
        .price-impact {  
          margin-top: 4px;  
          color: #666;  
        }  
          
        .price-impact.high {  
          color: #ff6b6b;  
        }  
          
        .swap-btn {  
          width: 100%;  
          padding: 16px;  
          background: #0066ff;  
          color: white;  
          border: none;  
          border-radius: 12px;  
          font-size: 18px;  
          font-weight: 600;  
          cursor: pointer;  
          transition: all 0.2s;  
        }  
          
        .swap-btn:hover:not(:disabled) {  
          background: #0052cc;  
        }  
          
        .swap-btn:disabled {  
          background: #e0e0e0;  
          color: #999;  
          cursor: not-allowed;  
        }  
          
        .tx-history {  
          background: white;  
          border-radius: 16px;  
          padding: 24px;  
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);  
        }  
          
        .tx-list {  
          margin-top: 16px;  
        }  
          
        .tx-item {  
          display: flex;  
          justify-content: space-between;  
          align-items: center;  
          padding: 12px;  
          border-bottom: 1px solid #f0f0f0;  
        }  
          
        .tx-item:last-child {  
          border-bottom: none;  
        }  
          
        .tx-meta {  
          display: flex;  
          align-items: center;  
          gap: 12px;  
          font-size: 14px;  
          color: #666;  
        }  
          
        .tx-link {  
          color: #0066ff;  
          text-decoration: none;  
        }  
          
        .modal-overlay {  
          position: fixed;  
          top: 0;  
          left: 0;  
          right: 0;  
          bottom: 0;  
          background: rgba(0,0,0,0.5);  
          display: flex;  
          align-items: center;  
          justify-content: center;  
          z-index: 1000;  
        }  
          
        .modal-content {  
          background: white;  
          border-radius: 16px;  
          padding: 24px;  
          max-width: 420px;  
          width: 90%;  
          max-height: 80vh;  
          overflow-y: auto;  
        }  
          
        .token-list {  
          margin-top: 16px;  
        }  
          
        .token-item {  
          display: flex;  
          align-items: center;  
          gap: 12px;  
          width: 100%;  
          padding: 12px;  
          border: none;  
          background: none;  
          cursor: pointer;  
          transition: all 0.2s;  
          text-align: left;  
        }  
          
        .token-item:hover {  
          background: #f7f7f7;  
          border-radius: 8px;  
        }  
          
        .token-item img {  
          width: 36px;  
          height: 36px;  
          border-radius: 50%;  
        }  
          
        .token-symbol {  
          font-weight: 600;  
          font-size: 16px;  
        }  
          
        .token-name {  
          font-size: 14px;  
          color: #666;  
        }  
          
        .token-balance {  
          margin-left: auto;  
          font-size: 14px;  
          color: #666;  
        }  
          
        .btn-connect, .btn-disconnect {  
          padding: 10px 20px;  
          border-radius: 8px;  
          border: none;  
          font-weight: 600;  
          cursor: pointer;  
          transition: all 0.2s;  
        }  
          
        .btn-connect {  
          background: #0066ff;  
          color: white;  
        }  
          
        .btn-disconnect {  
          background: #ff4444;  
          color: white;  
        }  
          
        .btn-connect:hover {  
          background: #0052cc;  
        }  
          
        .btn-disconnect:hover {  
          background: #cc0000;  
        }  
      `}</style>  
    </div>  
  );  
}  
  
export default DEXInterface;  