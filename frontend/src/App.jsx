import React, { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import ContractService from "./services/ContractService.js";
import KaiaWalletService from "./services/KaiaWalletService.js";
import CrossChainService from "./services/CrossChainService.js";
import {
  AppBar, Toolbar, Typography, Button, Box, Container, Grid, Card, CardContent,
  Snackbar, Alert, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Chip, Avatar, Divider, Paper, Tooltip
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import VideoCallIcon from "@mui/icons-material/VideoCall";
import GroupIcon from "@mui/icons-material/Group";
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
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

  async function handleCreateMeeting() {
    if (!meetingTitle.trim()) {
      setSnackbar({ open: true, message: "Please enter a meeting title.", severity: "warning" });
      return;
    }
    if (!contractService) return;
    setIsLoading(true);
    try {
      const scheduledTime = Math.floor(new Date().getTime() / 1000); // current time as Unix timestamp
      await contractService.createMeeting(meetingTitle, "A decentralized meeting", scheduledTime, false);
      setSnackbar({ open: true, message: "Meeting created successfully!", severity: "success" });
      fetchMeetingCount();
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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 3
      }}>
        <Container maxWidth="sm">
          <Paper elevation={24} sx={{ 
            p: 6, 
            borderRadius: 4, 
            textAlign: 'center',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(10px)'
          }}>
            <Box sx={{ mb: 4 }}>
        <Box sx={{
                display: 'inline-block',
                background: '#000',
                borderRadius: 2,
                p: 2,
                mb: 3
              }}>
                <img src={codarLogo} alt="CodarMeet Logo" style={{ height: 80, display: 'block' }} />
              </Box>
              <Typography variant="h3" gutterBottom sx={{ 
                color: '#1a1a1a', 
                fontWeight: 700,
                background: 'linear-gradient(45deg, #667eea, #764ba2)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}>
                Welcome to CodarMeet
              </Typography>
              <Typography variant="h6" sx={{ color: '#666', mb: 4 }}>
                Decentralized Video Meetings on Sepolia Testnet
              </Typography>
            </Box>
            
              <Button
              variant="contained" 
              size="large"
              startIcon={<AccountBalanceWalletIcon />}
                onClick={connectWallet}
              disabled={isConnecting}
              sx={{ 
                py: 2, 
                px: 4, 
                fontSize: '1.1rem',
                borderRadius: 3,
                background: 'linear-gradient(45deg, #667eea, #764ba2)',
                '&:hover': {
                  background: 'linear-gradient(45deg, #5a6fd8, #6a4190)',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 8px 25px rgba(102, 126, 234, 0.3)'
                },
                transition: 'all 0.3s ease'
              }}
            >
              {isConnecting ? 'Connecting to Sepolia Testnet...' : 'Connect to Sepolia Testnet'}
              </Button>
            
            {isConnecting && (
              <Box sx={{ mt: 2 }}>
                <CircularProgress size={24} />
              </Box>
            )}
            
            <Typography variant="body2" sx={{ mt: 3, color: '#888' }}>
              Connect your MetaMask wallet to Sepolia Testnet to start creating and joining meetings
                </Typography>
            </Paper>
          </Container>
        </Box>
    );
  }

  // If connected but not on Sepolia, show switch button
  if (isConnected && !isOnSepolia) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <Container maxWidth="sm">
          <Paper elevation={24} sx={{ p: 6, borderRadius: 4, textAlign: 'center', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)' }}>
            <Box sx={{ mb: 4 }}>
              <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>Wrong Network</Typography>
              <Typography variant="body1" sx={{ mb: 4 }}>Please switch to Sepolia Testnet to use CodarMeet.</Typography>
              <Button variant="contained" size="large" onClick={switchToSepolia} sx={{ background: 'linear-gradient(45deg, #667eea, #764ba2)', borderRadius: 3 }}>
                Switch to Sepolia Testnet
              </Button>
            </Box>
            <Button variant="outlined" onClick={disconnectWallet}>Disconnect</Button>
          </Paper>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <AppBar position="static" sx={{ 
        background: 'linear-gradient(45deg, #667eea, #764ba2)',
        boxShadow: '0 2px 20px rgba(102, 126, 234, 0.15)'
      }}>
        <Toolbar>
          <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
            <Box sx={{ 
              display: 'flex',
              alignItems: 'center',
              background: '#000',
              borderRadius: 1,
              p: 1,
              mr: 2
            }}>
              <img src={codarLogo} alt="CodarMeet Logo" style={{ height: 32, display: 'block' }} />
            </Box>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
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
              sx={{ background: 'rgba(102, 126, 234, 0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)' }}
            />
            <Chip 
              label={isOnSepolia ? "Sepolia Testnet" : "Wrong Network"}
              color={isOnSepolia ? "success" : "error"}
              size="small"
              sx={{ 
                background: isOnSepolia ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)',
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

      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Grid container columns={12} spacing={3}>
          <Grid gridSize={8}>
            <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" sx={{ fontWeight: 600, color: '#1a1a1a' }}>
                  Your Meetings
                    </Typography>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                  onClick={() => setOpenDialog(true)}
                  sx={{ 
                    background: 'linear-gradient(45deg, #667eea, #764ba2)',
                    borderRadius: 2,
                    '&:hover': {
                      background: 'linear-gradient(45deg, #5a6fd8, #6a4190)',
                      transform: 'translateY(-1px)'
                    }
                  }}
                >
                  Create Meeting
                  </Button>
              </Box>
              {/* List meetings */}
              {isMeetingsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                  <CircularProgress />
                </Box>
              ) : visibleMeetings.length === 0 ? (
                <Typography variant="body1" sx={{ color: '#888', mt: 2 }}>
                  No meetings found. Create one to get started!
                  </Typography>
                ) : (
                <Box sx={{ mt: 2 }}>
                  {visibleMeetings.map((m, idx) => (
                    <Card key={m[0] || idx} sx={{ mb: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
                      <CardContent>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>{m[2]}</Typography>
                        <Typography variant="body2" sx={{ color: '#666', mb: 1 }}>{m[3]}</Typography>
                        <Typography variant="caption" sx={{ color: '#999' }}>ID: {m[0]}</Typography>
                        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => handleJoinMeeting(m[0])}
                            disabled={isLoading}
                          >
                            Join
                          </Button>
                          <Button
                            variant="contained"
                            size="small"
                            color="primary"
                            onClick={() => {
                              setVideoChatRoom(m[2] || `meeting-${m[0]}`);
                              setVideoChatOpen(true);
                            }}
                          >
                            Go Live
                          </Button>
                          <Button
                            variant="outlined"
                            size="small"
                            color="error"
                            onClick={() => {
                              const updated = [...hiddenMeetings, m[0]];
                              setHiddenMeetings(updated);
                              localStorage.setItem('hiddenMeetings', JSON.stringify(updated));
                            }}
                          >
                            Hide
                          </Button>
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              )}
              {/* Existing meeting count card below */}
              <Card sx={{ 
                background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
                borderRadius: 2,
                border: '1px solid #e2e8f0',
                mt: 3
              }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <GroupIcon sx={{ color: '#667eea' }} />
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      Meetings on Chain
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: '#667eea' }}>
                    {meetingCount}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#666' }}>
                    Total meetings created
                  </Typography>
                  {isLoading && (
                    <Box sx={{ mt: 2 }}>
                      <CircularProgress size={20} />
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Paper>
          </Grid>
          <Grid gridSize={4}>
            <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Quick Actions
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button
                  variant="outlined"
                  startIcon={<VideoCallIcon />}
                  fullWidth
                  sx={{ 
                    justifyContent: 'flex-start',
                    borderColor: '#667eea',
                    color: '#667eea',
                    '&:hover': {
                      borderColor: '#5a6fd8',
                      background: 'rgba(102, 126, 234, 0.05)'
                    }
                  }}
                  onClick={() => setViewAllOpen(true)}
                >
                  Join Meeting
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<GroupIcon />}
                  fullWidth
                  sx={{ 
                    justifyContent: 'flex-start',
                    borderColor: '#667eea',
                    color: '#667eea',
                    '&:hover': {
                      borderColor: '#5a6fd8',
                      background: 'rgba(102, 126, 234, 0.05)'
                    }
                  }}
                  onClick={() => setViewAllOpen(true)}
                >
                  View All Meetings
                </Button>
              </Box>
              </Paper>
            </Grid>
          </Grid>
        </Container>

      <Dialog 
        open={openDialog} 
        onClose={() => setOpenDialog(false)}
        PaperProps={{
          sx: { borderRadius: 3, minWidth: 400 }
        }}
      >
        <DialogTitle sx={{ 
          background: 'linear-gradient(45deg, #667eea, #764ba2)',
          color: 'white',
          fontWeight: 600
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
              background: 'linear-gradient(45deg, #667eea, #764ba2)',
              '&:hover': {
                background: 'linear-gradient(45deg, #5a6fd8, #6a4190)'
              }
            }}
          >
            {isLoading ? 'Creating...' : 'Create Meeting'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog to view all meetings */}
      <Dialog open={viewAllOpen} onClose={() => setViewAllOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>All Meetings</DialogTitle>
        <DialogContent>
          {isMeetingsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
              <CircularProgress />
            </Box>
          ) : meetings.length === 0 ? (
            <Typography variant="body1" sx={{ color: '#888', mt: 2 }}>
              No meetings found.
          </Typography>
          ) : (
            <Box sx={{ mt: 2 }}>
              {meetings.map((m, idx) => (
                <Card key={m[0] || idx} sx={{ mb: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>{m[2]}</Typography>
                    <Typography variant="body2" sx={{ color: '#666', mb: 1 }}>{m[3]}</Typography>
                    <Typography variant="caption" sx={{ color: '#999' }}>ID: {m[0]}</Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => handleJoinMeeting(m[0])}
                        disabled={isLoading}
                      >
                        Join
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewAllOpen(false)}>Close</Button>
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
