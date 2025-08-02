import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Box, 
  Button, 
  Dialog, 
  Typography, 
  IconButton, 
  TextField,
  Paper,
  Alert,
  Snackbar,
  Card,
  CardContent,
  CircularProgress,
  Tooltip,
  Chip,
  Avatar,
  Badge
} from '@mui/material';
import { 
  Mic, 
  MicOff, 
  Videocam, 
  VideocamOff, 
  ScreenShare, 
  StopScreenShare,
  CallEnd,
  Send,
  Chat,
  ChatBubbleOutline,
  Settings,
  Group,
  Share,
  ContentCopy,
  Close,
  Fullscreen,
  FullscreenExit,
  VolumeUp,
  VolumeOff
} from '@mui/icons-material';
import WebRTCService from './services/WebRTCService';

// Error Boundary Component
class VideoCallErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('VideoCall Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Dialog open={true} maxWidth="sm" fullWidth>
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Alert severity="error" sx={{ mb: 2 }}>
              Something went wrong with the video call. Please refresh the page to try again.
            </Alert>
            <Button 
              variant="contained" 
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </Button>
          </Box>
        </Dialog>
      );
    }

    return this.props.children;
  }
}

const VideoChat = ({ open, onClose, roomName }) => {
  // Create WebRTC service instance with useMemo to prevent recreation
  const webrtcService = useMemo(() => new WebRTCService(), []);
  
  // Core state
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  
  // Connection state
  const [connectionState, setConnectionState] = useState('disconnected');
  const [isJoining, setIsJoining] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  
  // Media controls
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [participantMediaStates, setParticipantMediaStates] = useState(new Map());
  
  // UI state
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mainVideoId, setMainVideoId] = useState(null);
  
  // Notifications
  const [notification, setNotification] = useState({ open: false, message: '', severity: 'info' });
  
  // Refs
  const localVideoRef = useRef();
  const remoteVideoRefs = useRef(new Map());
  const chatEndRef = useRef();
  const dialogRef = useRef();
  const isMountedRef = useRef(true);
  const cleanupCallbacksRef = useRef([]);

  // Cleanup function to prevent memory leaks
  const cleanup = useCallback(() => {
    console.log('🧹 Cleaning up VideoChat component...');
    
    // Stop all video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    
    remoteVideoRefs.current.forEach((videoRef) => {
      if (videoRef) {
        videoRef.srcObject = null;
      }
    });
    remoteVideoRefs.current.clear();
    
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (error) {
          console.error('Error stopping track:', error);
        }
      });
      setLocalStream(null);
    }
    
    // Clean up WebRTC service
    if (webrtcService) {
      webrtcService.disconnect();
    }
    
    // Clear all state
    setRemoteStreams(new Map());
    setParticipants([]);
    setParticipantMediaStates(new Map());
    setChatMessages([]);
    setConnectionError('');
    setConnectionState('disconnected');
    
    // Run any additional cleanup callbacks
    cleanupCallbacksRef.current.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in cleanup callback:', error);
      }
    });
    cleanupCallbacksRef.current = [];
    
    console.log('✅ VideoChat component cleaned up');
  }, [localStream, webrtcService]);

  // Set mounted flag
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Setup WebRTC service callbacks
  const setupWebRTCCallbacks = useCallback(() => {
    if (!webrtcService || !isMountedRef.current) return;

    webrtcService.onConnectionStateChange((state) => {
      if (!isMountedRef.current) return;
      setConnectionState(state);
      if (state === 'connected') {
        setConnectionError('');
      }
    });

    webrtcService.onError((error) => {
      if (!isMountedRef.current) return;
      setConnectionError(error);
      showNotification(error, 'error');
    });

    webrtcService.onJoinedRoom((data) => {
      if (!isMountedRef.current) return;
      console.log('Joined room successfully:', data);
      setParticipants(data.existingParticipants || []);
      showNotification('Joined meeting successfully!', 'success');
    });

    webrtcService.onUserJoined((data) => {
      if (!isMountedRef.current) return;
      setParticipants(prev => {
        const exists = prev.some(p => p.id === data.participant.id);
        if (exists) return prev;
        return [...prev, data.participant];
      });
      showNotification(`${data.participant.userInfo?.name || 'Someone'} joined the meeting`, 'info');
    });

    webrtcService.onUserLeft((data) => {
      if (!isMountedRef.current) return;
      setParticipants(prev => prev.filter(p => p.id !== data.participantId));
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.delete(data.participantId);
        return newStreams;
      });
      setParticipantMediaStates(prev => {
        const newStates = new Map(prev);
        newStates.delete(data.participantId);
        return newStates;
      });
      
      // Clean up video ref
      const videoRef = remoteVideoRefs.current.get(data.participantId);
      if (videoRef) {
        videoRef.srcObject = null;
        remoteVideoRefs.current.delete(data.participantId);
      }
      
      showNotification('Someone left the meeting', 'info');
    });

    webrtcService.onRemoteStream((participantId, stream) => {
      if (!isMountedRef.current) return;
      console.log('Received remote stream from:', participantId);
      
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.set(participantId, stream);
        return newStreams;
      });
      
      // Auto-set main video to first remote participant
      setMainVideoId(prevMain => {
        if (!prevMain && participantId) {
          return participantId;
        }
        return prevMain;
      });
    });

    webrtcService.onChatMessage((message) => {
      if (!isMountedRef.current) return;
      setChatMessages(prev => {
        const participant = participants.find(p => p.id === message.fromId);
        return [...prev, {
          ...message,
          senderName: participant?.userInfo?.name || 'Unknown'
        }];
      });
      
      if (!showChat) {
        showNotification('New chat message', 'info');
      }
    });

    webrtcService.onMediaStateUpdate((data) => {
      if (!isMountedRef.current) return;
      setParticipantMediaStates(prev => {
        const newStates = new Map(prev);
        newStates.set(data.participantId, data.mediaState);
        return newStates;
      });
    });

    webrtcService.onScreenShareStart((data) => {
      if (!isMountedRef.current) return;
      const participantName = getParticipantName(data.participantId);
      showNotification(`${participantName} started screen sharing`, 'info');
    });

    webrtcService.onScreenShareStop((data) => {
      if (!isMountedRef.current) return;
      const participantName = getParticipantName(data.participantId);
      showNotification(`${participantName} stopped screen sharing`, 'info');
    });
  }, [webrtcService, participants, showChat]);

  // Initialize the call
  const initializeCall = useCallback(async () => {
    if (!isMountedRef.current) return;
    
    try {
      setIsJoining(true);
      setConnectionState('connecting');

      // Copy meeting link to clipboard
      const meetingUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
      try {
        await navigator.clipboard.writeText(meetingUrl);
        showNotification('Meeting link copied to clipboard!', 'success');
      } catch (err) {
        console.log('Could not copy to clipboard:', err);
      }

      // Setup callbacks first
      setupWebRTCCallbacks();

      // Connect to signaling server
      await webrtcService.connect();

      if (!isMountedRef.current) return;

      // Initialize media
      const stream = await webrtcService.initializeMedia();
      
      if (!isMountedRef.current) return;
      
      setLocalStream(stream);
      
      // Set video source after state update
      setTimeout(() => {
        if (localVideoRef.current && stream) {
          localVideoRef.current.srcObject = stream;
        }
      }, 100);

      // Join room
      const roomId = roomName.replace(/\s+/g, '-').toLowerCase();
      await webrtcService.joinRoom(roomId, {
        name: `User-${Date.now().toString().slice(-4)}`,
        email: 'user@example.com'
      });

    } catch (error) {
      console.error('Failed to initialize call:', error);
      if (isMountedRef.current) {
        setConnectionError(`Failed to join meeting: ${error.message}`);
        setConnectionState('error');
      }
    } finally {
      if (isMountedRef.current) {
        setIsJoining(false);
      }
    }
  }, [roomName, webrtcService, setupWebRTCCallbacks]);

  // Main effect for handling component open/close
  useEffect(() => {
    if (open && isMountedRef.current) {
      initializeCall();
    }
    
    return () => {
      if (!open) {
        cleanup();
      }
    };
  }, [open, initializeCall, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Media controls with error handling
  const toggleAudio = useCallback(() => {
    try {
      const enabled = webrtcService.toggleAudio();
      setIsAudioMuted(!enabled);
      showNotification(enabled ? 'Microphone on' : 'Microphone off', 'info');
    } catch (error) {
      console.error('Error toggling audio:', error);
      showNotification('Failed to toggle microphone', 'error');
    }
  }, [webrtcService]);

  const toggleVideo = useCallback(() => {
    try {
      const enabled = webrtcService.toggleVideo();
      setIsVideoOff(!enabled);
      showNotification(enabled ? 'Camera on' : 'Camera off', 'info');
    } catch (error) {
      console.error('Error toggling video:', error);
      showNotification('Failed to toggle camera', 'error');
    }
  }, [webrtcService]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (isScreenSharing) {
        await webrtcService.stopScreenShare();
        setIsScreenSharing(false);
      } else {
        await webrtcService.startScreenShare();
        setIsScreenSharing(true);
      }
    } catch (error) {
      console.error('Screen share error:', error);
      showNotification(`Screen share failed: ${error.message}`, 'error');
    }
  }, [isScreenSharing, webrtcService]);

  const endCall = useCallback(() => {
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  // Chat functions
  const sendMessage = useCallback((e) => {
    e.preventDefault();
    if (newMessage.trim() && webrtcService) {
      try {
        webrtcService.sendChatMessage(newMessage.trim());
        setNewMessage('');
      } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message', 'error');
      }
    }
  }, [newMessage, webrtcService]);

  const toggleChat = useCallback(() => {
    setShowChat(prev => !prev);
  }, []);

  // Utility functions
  const showNotification = useCallback((message, severity = 'info') => {
    if (isMountedRef.current) {
      setNotification({ open: true, message, severity });
    }
  }, []);

  const hideNotification = useCallback(() => {
    setNotification(prev => ({ ...prev, open: false }));
  }, []);

  const getParticipantName = useCallback((participantId) => {
    const participant = participants.find(p => p.id === participantId);
    return participant?.userInfo?.name || 'Unknown';
  }, [participants]);

  const copyMeetingLink = useCallback(async () => {
    const meetingUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
    try {
      await navigator.clipboard.writeText(meetingUrl);
      showNotification('Meeting link copied!', 'success');
    } catch (error) {
      showNotification('Failed to copy link', 'error');
    }
  }, [roomName, showNotification]);

  const toggleFullscreen = useCallback(() => {
    try {
      if (!document.fullscreenElement) {
        dialogRef.current?.requestFullscreen?.();
        setIsFullscreen(true);
      } else {
        document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
      showNotification('Fullscreen not supported', 'warning');
    }
  }, [showNotification]);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    cleanupCallbacksRef.current.push(() => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    });

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Render video element with proper error handling
  const renderVideoElement = useCallback((participantId, stream, isLocal = false) => {
    const mediaState = participantMediaStates.get(participantId) || { video: true, audio: true };
    const participant = participants.find(p => p.id === participantId);
    const name = isLocal ? 'You' : (participant?.userInfo?.name || 'Unknown');
    
    return (
      <Card 
        key={participantId || 'local'} 
        sx={{ 
          position: 'relative', 
          minHeight: 200,
          cursor: 'pointer',
          border: mainVideoId === participantId ? '3px solid #1976d2' : 'none',
          overflow: 'hidden'
        }}
        onClick={() => setMainVideoId(participantId)}
      >
        <video
          ref={isLocal ? localVideoRef : (el) => {
            if (el && participantId) {
              remoteVideoRefs.current.set(participantId, el);
              if (stream) {
                el.srcObject = stream;
              }
            }
          }}
          autoPlay
          playsInline
          muted={isLocal}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            backgroundColor: '#000'
          }}
          onError={(e) => {
            console.error('Video element error:', e);
          }}
          onLoadedMetadata={(e) => {
            console.log('Video metadata loaded for:', isLocal ? 'local' : participantId);
          }}
        />
        
        {/* Video overlay with participant info */}
        <Box sx={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <Chip
            label={name}
            size="small"
            sx={{
              backgroundColor: 'rgba(0,0,0,0.7)',
              color: 'white',
              fontSize: '0.75rem'
            }}
          />
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {!mediaState.audio && (
              <MicOff sx={{ color: 'red', fontSize: 16 }} />
            )}
            {!mediaState.video && (
              <VideocamOff sx={{ color: 'red', fontSize: 16 }} />
            )}
          </Box>
        </Box>

        {/* No video placeholder */}
        {(!stream || !mediaState.video) && (
          <Box sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.8)'
          }}>
            <Avatar sx={{ width: 80, height: 80, fontSize: '2rem' }}>
              {name.charAt(0).toUpperCase()}
            </Avatar>
          </Box>
        )}
      </Card>
    );
  }, [participantMediaStates, participants, mainVideoId]);

  // Get main video stream
  const mainStream = useMemo(() => {
    return mainVideoId ? remoteStreams.get(mainVideoId) : localStream;
  }, [mainVideoId, remoteStreams, localStream]);

  const isMainLocal = !mainVideoId;

  // Loading state
  if (isJoining) {
    return (
      <VideoCallErrorBoundary>
        <Dialog open={open} maxWidth="sm" fullWidth>
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6">Joining meeting...</Typography>
            <Typography color="text.secondary">
              Setting up your camera and microphone
            </Typography>
          </Box>
        </Dialog>
      </VideoCallErrorBoundary>
    );
  }

  // Error state
  if (connectionState === 'error') {
    return (
      <VideoCallErrorBoundary>
        <Dialog open={open} maxWidth="sm" fullWidth>
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Alert severity="error" sx={{ mb: 2 }}>
              {connectionError || 'Failed to join the meeting'}
            </Alert>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Button variant="contained" onClick={initializeCall}>
                Try Again
              </Button>
              <Button variant="outlined" onClick={onClose}>
                Cancel
              </Button>
            </Box>
          </Box>
        </Dialog>
      </VideoCallErrorBoundary>
    );
  }

  return (
    <VideoCallErrorBoundary>
      <Dialog 
        open={open} 
        maxWidth={false}
        fullWidth
        fullScreen={isFullscreen}
        ref={dialogRef}
        PaperProps={{
          sx: {
            height: isFullscreen ? '100vh' : '90vh',
            maxHeight: isFullscreen ? '100vh' : '90vh',
            m: isFullscreen ? 0 : 2
          }
        }}
        onClose={null} // Prevent accidental close
      >
        <Box sx={{ 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column',
          backgroundColor: '#000'
        }}>
          {/* Header */}
          <Box sx={{
            p: 2,
            backgroundColor: '#1a1a1a',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h6" noWrap>
                {roomName}
              </Typography>
              <Chip 
                size="small"
                label={`${participants.length + 1} participant${participants.length !== 0 ? 's' : ''}`}
                icon={<Group />}
              />
              <Chip
                size="small"
                label={connectionState}
                color={connectionState === 'connected' ? 'success' : 
                       connectionState === 'reconnecting' ? 'warning' : 'default'}
              />
            </Box>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title="Copy meeting link">
                <IconButton onClick={copyMeetingLink} sx={{ color: 'white' }}>
                  <ContentCopy />
                </IconButton>
              </Tooltip>
              <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                <IconButton onClick={toggleFullscreen} sx={{ color: 'white' }}>
                  {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Close">
                <IconButton onClick={endCall} sx={{ color: 'white' }}>
                  <Close />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Main content area */}
          <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Video area */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 1 }}>
              {/* Main video */}
              <Box sx={{ flex: 1, mb: 1 }}>
                {renderVideoElement(mainVideoId, mainStream, isMainLocal)}
              </Box>

              {/* Participant thumbnails */}
              {(participants.length > 0 || !isMainLocal) && (
                <Box sx={{
                  height: 120,
                  display: 'flex',
                  gap: 1,
                  overflowX: 'auto',
                  pb: 1
                }}>
                  {/* Local video thumbnail (if not main) */}
                  {!isMainLocal && (
                    <Box sx={{ minWidth: 160 }}>
                      {renderVideoElement(null, localStream, true)}
                    </Box>
                  )}
                  
                  {/* Remote video thumbnails */}
                  {participants.map(participant => {
                    if (participant.id === mainVideoId) return null;
                    return (
                      <Box key={participant.id} sx={{ minWidth: 160 }}>
                        {renderVideoElement(
                          participant.id,
                          remoteStreams.get(participant.id),
                          false
                        )}
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>

            {/* Chat sidebar */}
            {showChat && (
              <Paper sx={{ 
                width: 320, 
                display: 'flex', 
                flexDirection: 'column',
                borderRadius: 0
              }}>
                <Box sx={{ 
                  p: 2, 
                  borderBottom: 1, 
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <Typography variant="h6">Chat</Typography>
                  <IconButton onClick={toggleChat} size="small">
                    <Close />
                  </IconButton>
                </Box>
                
                <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
                  {chatMessages.map((message, index) => (
                    <Box key={`${message.id || index}-${message.timestamp}`} sx={{ mb: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {message.senderName}
                      </Typography>
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                        {message.message}
                      </Typography>
                    </Box>
                  ))}
                  <div ref={chatEndRef} />
                </Box>
                
                <Box component="form" onSubmit={sendMessage} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      inputProps={{ maxLength: 500 }}
                    />
                    <IconButton type="submit" disabled={!newMessage.trim()}>
                      <Send />
                    </IconButton>
                  </Box>
                </Box>
              </Paper>
            )}
          </Box>

          {/* Controls */}
          <Box sx={{
            p: 2,
            backgroundColor: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2
          }}>
            <Tooltip title={isAudioMuted ? 'Unmute' : 'Mute'}>
              <IconButton
                onClick={toggleAudio}
                sx={{
                  backgroundColor: isAudioMuted ? 'error.main' : 'grey.700',
                  color: 'white',
                  '&:hover': { backgroundColor: isAudioMuted ? 'error.dark' : 'grey.600' }
                }}
              >
                {isAudioMuted ? <MicOff /> : <Mic />}
              </IconButton>
            </Tooltip>

            <Tooltip title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}>
              <IconButton
                onClick={toggleVideo}
                sx={{
                  backgroundColor: isVideoOff ? 'error.main' : 'grey.700',
                  color: 'white',
                  '&:hover': { backgroundColor: isVideoOff ? 'error.dark' : 'grey.600' }
                }}
              >
                {isVideoOff ? <VideocamOff /> : <Videocam />}
              </IconButton>
            </Tooltip>

            <Tooltip title={isScreenSharing ? 'Stop sharing' : 'Share screen'}>
              <IconButton
                onClick={toggleScreenShare}
                sx={{
                  backgroundColor: isScreenSharing ? 'primary.main' : 'grey.700',
                  color: 'white',
                  '&:hover': { backgroundColor: isScreenSharing ? 'primary.dark' : 'grey.600' }
                }}
              >
                {isScreenSharing ? <StopScreenShare /> : <ScreenShare />}
              </IconButton>
            </Tooltip>

            <Tooltip title="Chat">
              <IconButton
                onClick={toggleChat}
                sx={{
                  backgroundColor: showChat ? 'primary.main' : 'grey.700',
                  color: 'white',
                  '&:hover': { backgroundColor: showChat ? 'primary.dark' : 'grey.600' }
                }}
              >
                <Badge badgeContent={chatMessages.length > 0 ? chatMessages.length : null} color="error">
                  <ChatBubbleOutline />
                </Badge>
              </IconButton>
            </Tooltip>

            <Tooltip title="End call">
              <IconButton
                onClick={endCall}
                sx={{
                  backgroundColor: 'error.main',
                  color: 'white',
                  '&:hover': { backgroundColor: 'error.dark' }
                }}
              >
                <CallEnd />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Dialog>

      {/* Notifications */}
      <Snackbar
        open={notification.open}
        autoHideDuration={4000}
        onClose={hideNotification}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert onClose={hideNotification} severity={notification.severity}>
          {notification.message}
        </Alert>
      </Snackbar>
    </VideoCallErrorBoundary>
  );
};

export default VideoChat;