import React, { useState, useRef, useEffect, useCallback } from 'react';
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

const VideoChat = ({ open, onClose, roomName }) => {
  // Core state
  const [webrtcService] = useState(() => new WebRTCService());
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  
  // Connection state
  const [connectionState, setConnectionState] = useState('disconnected'); // disconnected, connecting, connected, error, reconnecting
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
  const [mainVideoId, setMainVideoId] = useState(null); // null = local, or participant ID
  
  // Notifications
  const [notification, setNotification] = useState({ open: false, message: '', severity: 'info' });
  
  // Refs
  const localVideoRef = useRef();
  const remoteVideoRefs = useRef(new Map());
  const chatEndRef = useRef();
  const dialogRef = useRef();

  // Initialize WebRTC service and setup callbacks
  useEffect(() => {
    if (!open) return;

    setupWebRTCCallbacks();
    initializeCall();

    return () => {
      cleanup();
    };
  }, [open]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Setup WebRTC service callbacks
  const setupWebRTCCallbacks = useCallback(() => {
    webrtcService.onConnectionStateChange((state) => {
      setConnectionState(state);
      if (state === 'connected') {
        setConnectionError('');
      }
    });

    webrtcService.onError((error) => {
      setConnectionError(error);
      showNotification(error, 'error');
    });

    webrtcService.onJoinedRoom((data) => {
      console.log('Joined room successfully:', data);
      setParticipants(data.existingParticipants || []);
      showNotification('Joined meeting successfully!', 'success');
    });

    webrtcService.onUserJoined((data) => {
      setParticipants(prev => [...prev, data.participant]);
      showNotification(`${data.participant.userInfo?.name || 'Someone'} joined the meeting`, 'info');
    });

    webrtcService.onUserLeft((data) => {
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
      showNotification('Someone left the meeting', 'info');
    });

    webrtcService.onRemoteStream((participantId, stream) => {
      console.log('Received remote stream from:', participantId);
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.set(participantId, stream);
        return newStreams;
      });
      
      // Auto-set main video to first remote participant
      if (!mainVideoId && participantId) {
        setMainVideoId(participantId);
      }
    });

    webrtcService.onChatMessage((message) => {
      const participant = participants.find(p => p.id === message.fromId);
      setChatMessages(prev => [...prev, {
        ...message,
        senderName: participant?.userInfo?.name || 'Unknown'
      }]);
      
      if (!showChat) {
        showNotification('New chat message', 'info');
      }
    });

    webrtcService.onMediaStateUpdate((data) => {
      setParticipantMediaStates(prev => {
        const newStates = new Map(prev);
        newStates.set(data.participantId, data.mediaState);
        return newStates;
      });
    });

    webrtcService.onScreenShareStart((data) => {
      showNotification(`${getParticipantName(data.participantId)} started screen sharing`, 'info');
    });

    webrtcService.onScreenShareStop((data) => {
      showNotification(`${getParticipantName(data.participantId)} stopped screen sharing`, 'info');
    });
  }, [participants, mainVideoId, showChat]);

  // Initialize the call
  const initializeCall = async () => {
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

      // Connect to signaling server
      await webrtcService.connect();

      // Initialize media
      const stream = await webrtcService.initializeMedia();
      setLocalStream(stream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Join room
      const roomId = roomName.replace(/\s+/g, '-').toLowerCase();
      await webrtcService.joinRoom(roomId, {
        name: `User-${Date.now().toString().slice(-4)}`,
        email: 'user@example.com'
      });

    } catch (error) {
      console.error('Failed to initialize call:', error);
      setConnectionError(`Failed to join meeting: ${error.message}`);
      setConnectionState('error');
    } finally {
      setIsJoining(false);
    }
  };

  // Cleanup
  const cleanup = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    webrtcService.disconnect();
    setLocalStream(null);
    setRemoteStreams(new Map());
    setParticipants([]);
    setParticipantMediaStates(new Map());
    setChatMessages([]);
  }, [localStream, webrtcService]);

  // Media controls
  const toggleAudio = useCallback(() => {
    const enabled = webrtcService.toggleAudio();
    setIsAudioMuted(!enabled);
    showNotification(enabled ? 'Microphone on' : 'Microphone off', 'info');
  }, [webrtcService]);

  const toggleVideo = useCallback(() => {
    const enabled = webrtcService.toggleVideo();
    setIsVideoOff(!enabled);
    showNotification(enabled ? 'Camera on' : 'Camera off', 'info');
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
      webrtcService.sendChatMessage(newMessage.trim());
      setNewMessage('');
    }
  }, [newMessage, webrtcService]);

  const toggleChat = useCallback(() => {
    setShowChat(prev => !prev);
  }, []);

  // Utility functions
  const showNotification = useCallback((message, severity = 'info') => {
    setNotification({ open: true, message, severity });
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
  }, [roomName]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      dialogRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  // Render video element
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
          border: mainVideoId === participantId ? '3px solid #1976d2' : 'none'
        }}
        onClick={() => setMainVideoId(participantId)}
      >
        <video
          ref={isLocal ? localVideoRef : (el) => {
            if (el) remoteVideoRefs.current.set(participantId, el);
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
          onLoadedMetadata={(e) => {
            if (!isLocal && stream) {
              e.target.srcObject = stream;
            }
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

  // Loading state
  if (isJoining) {
    return (
      <Dialog open={open} maxWidth="sm" fullWidth>
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6">Joining meeting...</Typography>
          <Typography color="text.secondary">
            Setting up your camera and microphone
          </Typography>
        </Box>
      </Dialog>
    );
  }

  // Error state
  if (connectionState === 'error') {
    return (
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
    );
  }

  const mainStream = mainVideoId ? remoteStreams.get(mainVideoId) : localStream;
  const isMainLocal = !mainVideoId;

  return (
    <>
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
                <IconButton onClick={onClose} sx={{ color: 'white' }}>
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
                    <Box key={index} sx={{ mb: 1 }}>
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
                <Badge badgeContent={chatMessages.length} color="error">
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
    </>
  );
};

export default VideoChat;