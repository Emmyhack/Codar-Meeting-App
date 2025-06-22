require("@nomiclabs/hardhat-ethers");
require("hardhat-deploy");
require("@klaytn/hardhat-utils");
require("dotenv").config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];
const sepoliaAccounts = process.env.SEPOLIA_PRIVATE_KEY ? [process.env.SEPOLIA_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  networks: {
    kairos: {
      url: process.env.RPC_URL || "https://public-en-kairos.node.kaia.io",
      accounts: accounts,
      chainId: parseInt(process.env.CHAIN_ID) || 1337,
    },
    kaia: {
      url: process.env.RPC_URL || "https://public-en.node.kaia.io",
      accounts: accounts,
      chainId: parseInt(process.env.CHAIN_ID) || 1337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: sepoliaAccounts,
      chainId: 11155111,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  // Disable some plugins that might cause conflicts
  gasReporter: {
    enabled: false,
  },
  solidityCoverage: {
    enabled: false,
  },
};

