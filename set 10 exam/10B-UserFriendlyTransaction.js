import { useState, useEffect } from 'react'  
import { ethers } from 'ethers'  
import { toast } from 'react-toastify'  
  
const TransactionFlow = ({ contract, method, params, onSuccess }) => {  
  const [txState, setTxState] = useState('idle') // idle, preparing, pending, success, error  
  const [txHash, setTxHash] = useState(null)  
  const [error, setError] = useState(null)  
  const [gasEstimate, setGasEstimate] = useState(null)  
    
  // Estimate gas before transaction  
  useEffect(() => {  
    const estimateGas = async () => {  
      try {  
        const estimate = await contract.estimateGas[method](...params)  
        setGasEstimate(estimate)  
      } catch (err) {  
        console.error('Gas estimation failed:', err)  
      }  
    }  
      
    if (contract && method) {  
      estimateGas()  
    }  
  }, [contract, method, params])  
    
  const executeTransaction = async () => {  
    try {  
      setTxState('preparing')  
      setError(null)  
        
      // Show gas estimate to user  
      const gasPrice = await contract.provider.getGasPrice()  
      const estimatedCost = gasEstimate ? gasEstimate.mul(gasPrice) : null  
        
      // Prepare transaction  
      const tx = await contract[method](...params, {  
        gasLimit: gasEstimate ? gasEstimate.mul(110).div(100) : undefined // 10% buffer  
      })  
        
      setTxHash(tx.hash)  
      setTxState('pending')  
        
      // Show pending notification  
      toast.info(`Transaction submitted: ${tx.hash.slice(0, 10)}...`, {  
        autoClose: false,  
        toastId: tx.hash  
      })  
        
      // Wait for confirmation  
      const receipt = await tx.wait()  
        
      setTxState('success')  
      toast.update(tx.hash, {  
        render: 'Transaction confirmed!',  
        type: 'success',  
        autoClose: 5000  
      })  
        
      if (onSuccess) {  
        onSuccess(receipt)  
      }  
        
    } catch (err) {  
      setTxState('error')  
      setError(err)  
        
      // Handle specific errors  
      if (err.code === 4001) {  
        // User rejected transaction  
        toast.error('Transaction rejected by user')  
      } else if (err.code === -32603) {  
        // Internal error (insufficient funds, etc.)  
        toast.error('Transaction failed: ' + err.message)  
      } else {  
        toast.error('Transaction failed: Unknown error')  
      }  
    }  
  }  
    
  const renderTransactionUI = () => {  
    switch(txState) {  
      case 'idle':  
        return (  
          <div className="transaction-idle">  
            <button   
              onClick={executeTransaction}  
              className="btn-primary"  
            >  
              Confirm Transaction  
            </button>  
            {gasEstimate && (  
              <p className="gas-estimate">  
                Estimated gas: {ethers.utils.formatUnits(gasEstimate, 'gwei')} GWEI  
              </p>  
            )}  
          </div>  
        )  
          
      case 'preparing':  
        return (  
          <div className="transaction-preparing">  
            <div className="spinner" />  
            <p>Preparing transaction...</p>  
            <p className="hint">Please confirm in your wallet</p>  
          </div>  
        )  
          
      case 'pending':  
        return (  
          <div className="transaction-pending">  
            <div className="spinner" />  
            <p>Transaction pending...</p>  
            <a   
              href={`https://etherscan.io/tx/${txHash}`}  
              target="_blank"  
              rel="noopener noreferrer"  
              className="tx-link"  
            >  
              View on Etherscan  
            </a>  
          </div>  
        )  
          
      case 'success':  
        return (  
          <div className="transaction-success">  
            <div className="success-icon">✓</div>  
            <p>Transaction successful!</p>  
            <a   
              href={`https://etherscan.io/tx/${txHash}`}  
              target="_blank"  
              rel="noopener noreferrer"  
              className="tx-link"  
            >  
              View transaction  
            </a>  
          </div>  
        )  
          
      case 'error':  
        return (  
          <div className="transaction-error">  
            <div className="error-icon">✗</div>  
            <p>Transaction failed</p>  
            <p className="error-message">{error?.message || 'Unknown error'}</p>  
            <button   
              onClick={executeTransaction}  
              className="btn-retry"  
            >  
              Retry  
            </button>  
          </div>  
        )  
    }  
  }  
    
  return (  
    <div className="transaction-flow">  
      {renderTransactionUI()}  
    </div>  
  )  
}  