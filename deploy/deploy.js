module.exports = async ({getNamedAccounts, deployments, network}) => {
  try {
    const {deploy} = deployments;
    const {deployer} = await getNamedAccounts();
    console.log("Deploying Meeting contract with account:", deployer);
    console.log("Deploying to network:", network.name);

    const deployment = await deploy('Meeting', {
      from: deployer,
      args: [],
      log: true,
      overwrite: true,
    });

    // Log and save deployment info
    const fs = require('fs');
    const path = require('path');
    const info = {
      contractAddress: deployment.address,
      deployer,
      network: network.name,
      timestamp: new Date().toISOString(),
      transactionHash: deployment.transactionHash
    };
    console.log('Deployed Meeting contract at:', deployment.address);
    fs.writeFileSync(
      path.resolve(__dirname, '../deployment-info.json'),
      JSON.stringify(info, null, 2)
    );
  } catch (err) {
    console.error('Deployment failed:', err);
    throw err;
  }
};

module.exports.tags = ['Meeting']; 