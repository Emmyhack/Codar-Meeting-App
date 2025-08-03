import React, { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import ContractService from "./services/ContractService.js";
import KaiaWalletService from "./services/KaiaWalletService.js";
import CrossChainService from "./services/CrossChainService.js";
import {
  AppBar, Toolbar, Typography, Button, Box, Container, Grid, Card, CardContent,
  Snackbar, Alert, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Chip, Avatar, Divider, Paper, Tooltip, Fab, Zoom, Fade
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import VideoCallIcon from "@mui/icons-material/VideoCall";
import GroupIcon from "@mui/icons-material/Group";
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { motion, AnimatePresence } from 'framer-motion';
import codarLogo from './assets/codarlogo.png';
import VideoChat from "./VideoChat";

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState(null);
  const [meetingCount, setMeetingCount] = useState(0);
  const [openDialog, setOpenDialog] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isOnSepolia, setIsOnSepolia] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const [isMeetingsLoading, setIsMeetingsLoading] = useState(false);
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [videoChatOpen, setVideoChatOpen] = useState(false);
  const [videoChatRoom, setVideoChatRoom] = useState("");
  const [hiddenMeetings, setHiddenMeetings] = useState(() => {
    const saved = localStorage.getItem('hiddenMeetings');
    return saved ? JSON.parse(saved) : [];
  });

  // Use a singleton walletService
  const walletService = useRef(new KaiaWalletService()).current;
  const [contractService, setContractService] = useState(null);

  // Set up event listeners only once
  useEffect(() => {
    function handleAccountsChanged(accounts) {
      if (accounts.length === 0) {
        setAccount(null);
        setIsConnected(false);
        setIsOnSepolia(false);
    } else {
        setAccount(accounts[0]);
        setIsConnected(true);
        walletService.isOnSepolia().then(setIsOnSepolia);
      }
    }
    function handleChainChanged(chainId) {
      walletService.isOnSepolia().then(setIsOnSepolia);
    }
    walletService.setupEventListeners(handleAccountsChanged, handleChainChanged);
    return () => {
      walletService.removeEventListeners(handleAccountsChanged, handleChainChanged);
    };
  }, [walletService]);

  useEffect(() => {
    if (window.ethereum && isConnected) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      setContractService(new ContractService(provider));
    }
  }, [isConnected]);

  // Fetch all meetings when contractService changes
  useEffect(() => {
    async function fetchMeetings() {
      if (contractService) {
        setIsMeetingsLoading(true);
        try {
          const allMeetings = await contractService.getAllMeetings();
          setMeetings(allMeetings);
        } catch (e) {
          setSnackbar({ open: true, message: `Failed to fetch meetings: ${e.message || e}`, severity: "error" });
        }
        setIsMeetingsLoading(false);
      }
    }
    fetchMeetings();
  }, [contractService]);

  // 1. On mount, check for ?room= and open VideoChat if present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setVideoChatRoom(room);
      setVideoChatOpen(true);
    }
  }, []);

  async function connectWallet() {
    if (!window.ethereum) {
      setSnackbar({ 
        open: true, 
        message: "MetaMask is not installed. Please install MetaMask to use this app.", 
        severity: "error" 
      });
      return;
    }

    setIsConnecting(true);
    try {
      await walletService.connect();
      const acc = await walletService.getAccount();
      setAccount(acc);
      setIsConnected(true);
      
      // Check if successfully connected to Sepolia
      const onSepolia = await walletService.isOnSepolia();
      setIsOnSepolia(onSepolia);
      
      if (onSepolia) {
        setSnackbar({ open: true, message: "Connected to Sepolia Testnet successfully!", severity: "success" });
      } else {
        setSnackbar({ open: true, message: "Connected but not on Sepolia Testnet. Please switch networks.", severity: "warning" });
      }
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: "error" });
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnectWallet() {
    setAccount(null);
    setIsConnected(false);
    setContractService(null);
    setSnackbar({ open: true, message: "Wallet disconnected", severity: "info" });
  }

  async function fetchMeetingCount() {
    if (contractService) {
      try {
        const count = await contractService.getMeetingCount();
        setMeetingCount(count.toString());
      } catch (e) {
        console.error("Failed to fetch meeting count:", e);
        setSnackbar({ open: true, message: `Failed to fetch meeting count: ${e.message || e}`, severity: "error" });
      }
    }
  }

  useEffect(() => {
    if (contractService) {
      fetchMeetingCount();
    }
  }, [contractService]);

  // 2. After creating a meeting, go live immediately and show share notification
  async function handleCreateMeeting() {
    if (!meetingTitle.trim()) {
      setSnackbar({ open: true, message: "Please enter a meeting title.", severity: "warning" });
      return;
    }
    if (!contractService) return;
    setIsLoading(true);
    try {
      const scheduledTime = Math.floor(new Date().getTime() / 1000); // current time as Unix timestamp
      const tx = await contractService.createMeeting(meetingTitle, "A decentralized meeting", scheduledTime, false);
      setSnackbar({ open: true, message: "Meeting created successfully!", severity: "success" });
      fetchMeetingCount();
      // Go live immediately
      setVideoChatRoom(meetingTitle.replace(/\s+/g, '-').toLowerCase());
      setVideoChatOpen(true);
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: "error" });
    }
    setIsLoading(false);
    setOpenDialog(false);
    setMeetingTitle("");
  }

  function formatAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  async function switchToSepolia() {
    try {
      await walletService.switchToSepolia();
      setSnackbar({ open: true, message: "Switched to Sepolia Testnet!", severity: "success" });
      setIsOnSepolia(true);
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: "error" });
    }
  }

  async function handleJoinMeeting(meetingId) {
    if (!contractService) return;
    setIsLoading(true);
    try {
      await contractService.joinMeeting(meetingId);
      setSnackbar({ open: true, message: "Joined meeting successfully!", severity: "success" });
      // Optionally refetch meetings to update participants
      const allMeetings = await contractService.getAllMeetings();
      setMeetings(allMeetings);
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: "error" });
    }
    setIsLoading(false);
  }

  const visibleMeetings = meetings.filter(m => !hiddenMeetings.includes(m[0]));

  if (!isConnected) {
    return (
      <Box sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #4285f4 0%, #34a853 50%, #fbbc04 75%, #ea4335 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 3
      }}>
        <Container maxWidth="sm">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Paper elevation={24} sx={{ 
              p: 6, 
              borderRadius: 4, 
              textAlign: 'center',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <Box sx={{ mb: 4 }}>
                <Box sx={{
                  display: 'inline-block',
                  background: '#fff',
                  borderRadius: 3,
                  p: 3,
                  mb: 3,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
                }}>
                  <img src={codarLogo} alt="CodarMeet Logo" style={{ height: 80, display: 'block' }} />
                </Box>
                <Typography variant="h3" gutterBottom sx={{ 
                  color: '#1a1a1a', 
                  fontWeight: 700,
                  background: 'linear-gradient(45deg, #4285f4, #34a853)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  mb: 2
                }}>
                  Welcome to CodarMeet
                </Typography>
                <Typography variant="h6" sx={{ color: '#666', mb: 4, fontWeight: 400 }}>
                  Decentralized Video Meetings on Sepolia Testnet
                </Typography>
                <Typography variant="body1" sx={{ color: '#888', mb: 4 }}>
                  Connect your wallet to start creating and joining meetings with Google Meet-like functionality
                </Typography>
              </Box>
              
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  variant="contained" 
                  size="large"
                  startIcon={<AccountBalanceWalletIcon />}
                  onClick={connectWallet}
                  disabled={isConnecting}
                  sx={{ 
                    py: 2.5, 
                    px: 5, 
                    fontSize: '1.2rem',
                    borderRadius: 3,
                    background: 'linear-gradient(45deg, #4285f4, #34a853)',
                    boxShadow: '0 8px 25px rgba(66, 133, 244, 0.3)',
                    '&:hover': {
                      background: 'linear-gradient(45deg, #3367d6, #2e8b47)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 12px 35px rgba(66, 133, 244, 0.4)'
                    },
                    transition: 'all 0.3s ease',
                    fontWeight: 600
                  }}
                >
                  {isConnecting ? 'Connecting to Sepolia Testnet...' : 'Connect to Sepolia Testnet'}
                </Button>
              </motion.div>
              
              {isConnecting && (
                <Box sx={{ mt: 3 }}>
                  <CircularProgress size={32} sx={{ color: '#4285f4' }} />
                </Box>
              )}
              
              <Typography variant="body2" sx={{ mt: 4, color: '#888', lineHeight: 1.6 }}>
                Connect your MetaMask wallet to Sepolia Testnet to start creating and joining meetings
              </Typography>
            </Paper>
          </motion.div>
        </Container>
      </Box>
    );
  }

  // If connected but not on Sepolia, show switch button
  if (isConnected && !isOnSepolia) {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        background: 'linear-gradient(135deg, #4285f4 0%, #34a853 50%, #fbbc04 75%, #ea4335 100%)' 
      }}>
        <Container maxWidth="sm">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Paper elevation={24} sx={{ 
              p: 6, 
              borderRadius: 4, 
              textAlign: 'center', 
              background: 'rgba(255,255,255,0.95)', 
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <Box sx={{ mb: 4 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, mb: 2, color: '#1a1a1a' }}>
                  Wrong Network
                </Typography>
                <Typography variant="body1" sx={{ mb: 4, color: '#666' }}>
                  Please switch to Sepolia Testnet to use CodarMeet.
                </Typography>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button 
                    variant="contained" 
                    size="large" 
                    onClick={switchToSepolia} 
                    sx={{ 
                      background: 'linear-gradient(45deg, #4285f4, #34a853)', 
                      borderRadius: 3,
                      py: 2,
                      px: 4,
                      fontSize: '1.1rem',
                      fontWeight: 600,
                      boxShadow: '0 8px 25px rgba(66, 133, 244, 0.3)',
                      '&:hover': {
                        background: 'linear-gradient(45deg, #3367d6, #2e8b47)',
                        boxShadow: '0 12px 35px rgba(66, 133, 244, 0.4)'
                      }
                    }}
                  >
                    Switch to Sepolia Testnet
                  </Button>
                </motion.div>
              </Box>
              <Button variant="outlined" onClick={disconnectWallet} sx={{ color: '#666', borderColor: '#ddd' }}>
                Disconnect
              </Button>
            </Paper>
          </motion.div>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <AppBar position="static" sx={{ 
        background: 'linear-gradient(45deg, #4285f4, #34a853)',
        boxShadow: '0 2px 20px rgba(66, 133, 244, 0.15)'
      }}>
        <Toolbar>
          <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
            <Box sx={{ 
              display: 'flex',
              alignItems: 'center',
              background: '#fff',
              borderRadius: 2,
              p: 1,
              mr: 2,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <img src={codarLogo} alt="CodarMeet Logo" style={{ height: 32, display: 'block' }} />
            </Box>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600, color: 'white' }}>
              CodarMeet
            </Typography>
          </Box>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Chip 
              icon={<AccountBalanceWalletIcon />}
              label={formatAddress(account)}
              sx={{ 
                background: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                '&:hover': { background: 'rgba(255, 255, 255, 0.3)' }
              }}
            />
            <Chip 
              label={window.kaikas ? "Kaia Wallet" : "MetaMask"}
              color="primary"
              size="small"
              sx={{ background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)' }}
            />
            <Chip 
              label={isOnSepolia ? "Sepolia Testnet" : "Wrong Network"}
              color={isOnSepolia ? "success" : "error"}
              size="small"
              sx={{ 
                background: isOnSepolia ? 'rgba(255,255,255,0.2)' : 'rgba(244,67,54,0.2)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                mr: 1
              }}
            />
            <Button 
              variant="outlined" 
              onClick={disconnectWallet}
              sx={{ 
                color: 'white', 
                borderColor: 'rgba(255, 255, 255, 0.5)',
                '&:hover': { 
                  borderColor: 'white',
                  background: 'rgba(255, 255, 255, 0.1)'
                }
              }}
            >
              Disconnect
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 6, mb: 6 }}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Grid container spacing={4}>
            <Grid item xs={12} md={8}>
              <Paper elevation={3} sx={{ 
                p: 4, 
                borderRadius: 3,
                background: 'linear-gradient(135deg, #fff 0%, #f8fafc 100%)',
                border: '1px solid rgba(66, 133, 244, 0.1)'
              }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 700, color: '#1a1a1a', mb: 1 }}>
                      Start a Meeting
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#666', mb: 3 }}>
                      Create a meeting and go live instantly. Share the link with others to join you.
                    </Typography>
                  </Box>
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => setOpenDialog(true)}
                      size="large"
                      sx={{ 
                        background: 'linear-gradient(45deg, #4285f4, #34a853)',
                        borderRadius: 2,
                        px: 4,
                        py: 1.5,
                        fontSize: '1.1rem',
                        fontWeight: 600,
                        boxShadow: '0 4px 15px rgba(66, 133, 244, 0.3)',
                        '&:hover': {
                          background: 'linear-gradient(45deg, #3367d6, #2e8b47)',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 6px 20px rgba(66, 133, 244, 0.4)'
                        }
                      }}
                    >
                      Create Meeting
                    </Button>
                  </motion.div>
                </Box>
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 3, bgcolor: 'rgba(66, 133, 244, 0.05)', borderRadius: 2 }}>
                  <VideoCallIcon sx={{ color: '#4285f4', fontSize: 32 }} />
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 600, color: '#1a1a1a' }}>
                      Google Meet-like Experience
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#666' }}>
                      High-quality video calls with screen sharing, chat, recording, and more
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} md={4}>
              <Paper elevation={3} sx={{ 
                p: 4, 
                borderRadius: 3,
                background: 'linear-gradient(135deg, #fff 0%, #f8fafc 100%)',
                border: '1px solid rgba(66, 133, 244, 0.1)',
                height: 'fit-content'
              }}>
                <Typography variant="h6" sx={{ fontWeight: 600, color: '#1a1a1a', mb: 3 }}>
                  Quick Stats
                </Typography>
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>
                      Total Meetings
                    </Typography>
                    <Chip label={meetingCount} color="primary" size="small" />
                  </Box>
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>
                      Network
                    </Typography>
                    <Chip 
                      label="Sepolia" 
                      color="success" 
                      size="small"
                      sx={{ bgcolor: '#4caf50', color: 'white' }}
                    />
                  </Box>
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>
                      Wallet
                    </Typography>
                    <Chip 
                      label={window.kaikas ? "Kaia" : "MetaMask"} 
                      color="info" 
                      size="small"
                      sx={{ bgcolor: '#2196f3', color: 'white' }}
                    />
                  </Box>
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </motion.div>
      </Container>

      <Dialog 
        open={openDialog} 
        onClose={() => setOpenDialog(false)}
        PaperProps={{
          sx: { 
            borderRadius: 3, 
            minWidth: 450,
            background: 'linear-gradient(135deg, #fff 0%, #f8fafc 100%)'
          }
        }}
      >
        <DialogTitle sx={{ 
          background: 'linear-gradient(45deg, #4285f4, #34a853)',
          color: 'white',
          fontWeight: 600,
          borderRadius: '12px 12px 0 0'
        }}>
          Create New Meeting
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <TextField
            autoFocus 
            margin="dense" 
            id="title" 
            label="Meeting Title"
            type="text" 
            fullWidth 
            variant="outlined"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Typography variant="body2" sx={{ color: '#666' }}>
            This meeting will be created on the blockchain and can be joined by other participants.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button 
            onClick={() => setOpenDialog(false)}
            sx={{ color: '#666' }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleCreateMeeting} 
            disabled={isLoading || !meetingTitle.trim()}
            variant="contained"
            sx={{ 
              background: 'linear-gradient(45deg, #4285f4, #34a853)',
              '&:hover': {
                background: 'linear-gradient(45deg, #3367d6, #2e8b47)'
              }
            }}
          >
            {isLoading ? 'Creating...' : 'Create Meeting'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* VideoChat dialog for live meetings */}
      <VideoChat open={videoChatOpen} onClose={() => setVideoChatOpen(false)} roomName={videoChatRoom} />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity} 
          sx={{ width: '100%', borderRadius: 2 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
