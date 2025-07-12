const MultiWalletProvider = ({ children }) => {  
  const [wallets, setWallets] = useState({})  
  const [activeWallet, setActiveWallet] = useState(null)  
    
  const connectWallet = async (walletType) => {  
    let provider;  
      
    switch(walletType) {  
      case 'metamask':  
        provider = window.ethereum  
        break  
      case 'walletconnect':  
        provider = new WalletConnectProvider({  
          infuraId: process.env.REACT_APP_INFURA_ID  
        })  
        await provider.enable()  
        break  
      case 'coinbase':  
        provider = new CoinbaseWalletSDK({  
          appName: 'My DApp',  
          appLogoUrl: 'https://example.com/logo.png'  
        })  
        break  
    }  
      
    const web3Provider = new ethers.providers.Web3Provider(provider)  
    const signer = web3Provider.getSigner()  
    const address = await signer.getAddress()  
      
    setWallets(prev => ({  
      ...prev,  
      [walletType]: { provider: web3Provider, address, signer }  
    }))  
      
    setActiveWallet(walletType)  
  }  
    
  return (  
    <WalletContext.Provider value={{ wallets, activeWallet, connectWallet }}>  
      {children}  
    </WalletContext.Provider>  
  )  
}  