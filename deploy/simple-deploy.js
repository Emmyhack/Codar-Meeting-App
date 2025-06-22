const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("Starting deployment to Sepolia testnet...");
  
  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // Deploy the Meeting contract
  const Meeting = await ethers.getContractFactory("Meeting");
  console.log("Deploying Meeting contract...");
  
  const meeting = await Meeting.deploy();
  await meeting.deployed();

  console.log("Meeting contract deployed to:", meeting.address);
  console.log("Transaction hash:", meeting.deployTransaction.hash);
  
  // Wait for a few confirmations
  console.log("Waiting for confirmations...");
  await meeting.deployTransaction.wait(3);
  
  console.log("✅ Deployment successful!");
  console.log("Contract address:", meeting.address);
  console.log("Network: sepolia");
  console.log("Deployer:", deployer.address);
  
  // Save the contract address to a file for easy access
  const fs = require('fs');
  const deploymentInfo = {
    contractAddress: meeting.address,
    deployer: deployer.address,
    network: 'sepolia',
    timestamp: new Date().toISOString(),
    transactionHash: meeting.deployTransaction.hash
  };
  
  fs.writeFileSync('deployment-info.json', JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment info saved to deployment-info.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  }); 