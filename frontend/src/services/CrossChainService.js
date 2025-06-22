export default class CrossChainService {
  // Mock cross-chain service for testing
  async sendMessage(chainId, data) {
    // Simulate a delay
    return new Promise((resolve) => setTimeout(() => resolve({ success: true, chainId, data }), 500));
  }
} 