const { ethers } = require("ethers");
require('dotenv').config();

// Kaia network configuration
const NETWORK_CONFIG = {
  kairos: {
    url: "https://public-en-kairos.node.kaia.io",
    chainId: 1337
  },
  kaia: {
    url: "https://public-en.node.kaia.io", 
    chainId: 1337
  }
};

// Contract ABI (same as in frontend)
const CONTRACT_ABI = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "title",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "scheduledTime",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isPrivate",
        "type": "bool"
      }
    ],
    "name": "MeetingCreated",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "title",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "description",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "scheduledTime",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPrivate",
        "type": "bool"
      }
    ],
    "name": "createMeeting",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "meetingId",
        "type": "uint256"
      }
    ],
    "name": "getMeeting",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "title",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "description",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "creationTime",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "scheduledTime",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPrivate",
        "type": "bool"
      },
      {
        "internalType": "address[]",
        "name": "participants",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "meetingCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

async function main() {
  const network = process.env.NETWORK || 'kairos';
  const config = NETWORK_CONFIG[network];
  
  if (!config) {
    console.error('Invalid network. Use "kairos" or "kaia"');
    process.exit(1);
  }

  if (!process.env.PRIVATE_KEY) {
    console.error('PRIVATE_KEY not found in environment variables');
    process.exit(1);
  }

  // Create provider and signer
  const provider = new ethers.JsonRpcProvider(config.url);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log('Connected to Kaia network:', network);
  console.log('Account:', signer.address);
  console.log('Balance:', ethers.formatEther(await provider.getBalance(signer.address)), 'KAIA');

  const contractAddress = process.env.CONTRACT_ADDRESS;
  
  if (!contractAddress) {
    console.error('CONTRACT_ADDRESS not found in environment variables');
    process.exit(1);
  }

  // Create contract instance
  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
  
  console.log('Contract address:', contractAddress);

  // Test contract connection
  try {
    const owner = await contract.owner();
    console.log('Contract owner:', owner);
    
    const meetingCount = await contract.meetingCount();
    console.log('Total meetings:', meetingCount.toString());
  } catch (error) {
    console.error('Failed to connect to contract:', error.message);
    process.exit(1);
  }

  // Example: Create a test meeting
  const action = process.argv[2];
  
  if (action === 'create') {
    try {
      const title = "Test Meeting on Kaia";
      const description = "Testing meeting creation on Kaia network";
      const scheduledTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const isPrivate = false;

      console.log('Creating test meeting...');
      const tx = await contract.createMeeting(title, description, scheduledTime, isPrivate);
      console.log('Transaction sent:', tx.hash);
      
      const receipt = await tx.wait();
      console.log('Transaction confirmed in block:', receipt.blockNumber);
      
      // Get meeting ID from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = contract.interface.parseLog(log);
          return parsed.name === 'MeetingCreated';
        } catch {
          return false;
        }
      });

      if (event) {
        const parsed = contract.interface.parseLog(event);
        const meetingId = parsed.args[0];
        console.log('Meeting created with ID:', meetingId.toString());
      }
    } catch (error) {
      console.error('Failed to create meeting:', error.message);
    }
  } else if (action === 'list') {
    try {
      const count = await contract.meetingCount();
      console.log('Total meetings:', count.toString());
      
      for (let i = 1; i <= count; i++) {
        try {
          const meeting = await contract.getMeeting(i);
          console.log(`Meeting ${i}:`, {
            id: meeting[0].toString(),
            creator: meeting[1],
            title: meeting[2],
            description: meeting[3],
            creationTime: new Date(meeting[4] * 1000).toISOString(),
            scheduledTime: new Date(meeting[5] * 1000).toISOString(),
            isPrivate: meeting[6]
          });
        } catch (error) {
          console.log(`Meeting ${i}: Error reading meeting data`);
        }
      }
    } catch (error) {
      console.error('Failed to list meetings:', error.message);
    }
  } else {
    console.log('Usage: node utils/kaia-deploy.js [create|list]');
    console.log('  create - Create a test meeting');
    console.log('  list   - List all meetings');
  }
}

main().catch(console.error); 