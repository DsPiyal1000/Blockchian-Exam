const handleWalletRejection = (error) => {  
  const rejectionMessages = {  
    4001: 'Transaction rejected by user',  
    4100: 'Unauthorized - please connect your wallet',  
    4200: 'Unsupported method',  
    4900: 'Disconnected from chain',  
    4901: 'Chain not supported'  
  }  
    
  return rejectionMessages[error.code] || 'Transaction failed'  
}  