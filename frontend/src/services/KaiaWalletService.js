export default class KaiaWalletService {
  constructor() {
    this.sepoliaChainId = '0xaa36a7'; // 11155111 in hex
    this.sepoliaConfig = {
      chainId: this.sepoliaChainId,
      chainName: 'Sepolia Testnet',
      nativeCurrency: {
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18,
      },
      rpcUrls: ['https://rpc.sepolia.org'],
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    };
  }

  getProvider() {
    if (typeof window !== 'undefined') {
      if (window.ethereum) return window.ethereum;
    }
    return null;
  }

  async connect() {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('MetaMask is not installed.');
    }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (accounts.length === 0) {
        throw new Error('No accounts found. Please unlock your wallet and try again.');
      }
      // Check current chain
      const currentChainId = await provider.request({ method: 'eth_chainId' });
      if (currentChainId !== this.sepoliaChainId) {
        await this.switchToSepolia();
      }
      return true;
    } catch (error) {
      if (error.code === 4001) {
        throw new Error('User rejected the connection request.');
      } else if (error.code === -32002) {
        throw new Error('Please check your wallet and approve the connection request.');
      } else {
        throw new Error(`Connection failed: ${error.message}`);
      }
    }
  }

  async switchToSepolia() {
    const provider = this.getProvider();
    if (!provider) throw new Error('No wallet provider found.');
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.sepoliaChainId }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        // Add the network if not found
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [this.sepoliaConfig],
          });
        } catch (addError) {
          throw new Error('Failed to add Sepolia Testnet to your wallet. Please add it manually.');
        }
      } else {
        throw new Error('Failed to switch to Sepolia Testnet. Please switch manually in your wallet.');
      }
    }
  }

  async getAccount() {
    const provider = this.getProvider();
    if (!provider) return null;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      return accounts.length > 0 ? accounts[0] : null;
    } catch (error) {
      return null;
    }
  }

  async getChainId() {
    const provider = this.getProvider();
    if (!provider) return null;
    try {
      return await provider.request({ method: 'eth_chainId' });
    } catch (error) {
      return null;
    }
  }

  async isOnSepolia() {
    const chainId = await this.getChainId();
    return chainId === this.sepoliaChainId;
  }

  setupEventListeners(onAccountsChanged, onChainChanged) {
    const provider = this.getProvider();
    if (provider) {
      if (onAccountsChanged) provider.on('accountsChanged', onAccountsChanged);
      if (onChainChanged) provider.on('chainChanged', onChainChanged);
    }
  }

  removeEventListeners(onAccountsChanged, onChainChanged) {
    const provider = this.getProvider();
    if (provider) {
      if (onAccountsChanged) provider.removeListener('accountsChanged', onAccountsChanged);
      if (onChainChanged) provider.removeListener('chainChanged', onChainChanged);
    }
  }

  async switchNetwork(chainId) {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('No wallet provider found');
    }

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      });
    } catch (error) {
      if (error.code === 4902) {
        throw new Error('Network not found. Please add it to your wallet first.');
      } else {
        throw new Error(`Failed to switch network: ${error.message}`);
      }
    }
  }
} 