import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Box, 
  Button, 
  Dialog, 
  Typography, 
  IconButton, 
  TextField,
  List,
  ListItem,
  ListItemText,
  Paper,
  Divider,
  Tooltip,
  Alert,
  Snackbar,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Popover,
  ListItemAvatar,
  Chip,
  Badge,
  Fab,
  Zoom,
  Slide,
  Fade
} from '@mui/material';
import { 
  Mic, 
  MicOff, 
  Videocam, 
  VideocamOff, 
  ScreenShare, 
  CallEnd,
  Send,
  Chat,
  FiberManualRecord,
  Stop,
  Download,
  ClosedCaption,
  ClosedCaptionOff,
  Settings,
  Group,
  MoreVert,
  Share,
  PresentToAll,
  StopScreenShare,
  HandRaise,
  HandRaiseAlt,
  People,
  Info,
  Security,
  Report,
  Block,
  VolumeUp,
  VolumeOff,
  Fullscreen,
  FullscreenExit,
  Keyboard,
  Help,
  Feedback,
  ExitToApp,
  PersonAdd,
  Link,
  ContentCopy,
  CheckCircle,
  Error,
  Warning,
  Info as InfoIcon
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { useHotkeys } from 'react-hotkeys-hook';
import { useToggle, useLocalStorage, useKey } from 'react-use';
import { format } from 'date-fns';
import WebRTCService from './services/WebRTCService';
import PersonIcon from '@mui/icons-material/Person';

const VideoChat = ({ open, onClose, roomName }) => {
  // Core state
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  
  // UI state
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showConnectionInfo, setShowConnectionInfo] = useState(false);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedChunks, setRecordedChunks] = useState([]);
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatEndRef] = useLocalStorage('chatScrollPosition', 0);
  
  // Participants state
  const [raisedHands, setRaisedHands] = useState(new Set());
  const [participantsAnchorEl, setParticipantsAnchorEl] = useState(null);
  
  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [shareSnackbar, setShareSnackbar] = useState(false);
  const [recordingAlert, setRecordingAlert] = useState(false);
  
  // Refs
  const localVideoRef = useRef();
  const remoteVideosRef = useRef(new Map());
  const chatEndRef = useRef();
  const mediaRecorderRef = useRef();
  const recordingTimerRef = useRef();
  const controlsTimeoutRef = useRef();
  const webrtcServiceRef = useRef();
  const dialogRef = useRef();

  // Hotkeys
  useHotkeys('ctrl+m, cmd+m', () => toggleMute(), { preventDefault: true });
  useHotkeys('ctrl+v, cmd+v', () => toggleVideo(), { preventDefault: true });
  useHotkeys('ctrl+d, cmd+d', () => toggleScreenShare(), { preventDefault: true });
  useHotkeys('ctrl+h, cmd+h', () => toggleHandRaise(), { preventDefault: true });
  useHotkeys('ctrl+shift+c, cmd+shift+c', () => setShowChat(!showChat), { preventDefault: true });
  useHotkeys('escape', () => {
    if (showChat) setShowChat(false);
    else if (showParticipants) setShowParticipants(false);
    else if (showSettings) setShowSettings(false);
    else onClose();
  }, { preventDefault: true });

  // Auto-hide controls
  useEffect(() => {
    if (open) {
      const handleMouseMove = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
        controlsTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, 3000);
      };

      document.addEventListener('mousemove', handleMouseMove);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
      };
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      initializeMeeting();
      // Auto-copy meeting link
      const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
      navigator.clipboard.writeText(url).then(() => setShareSnackbar(true));
    }
    return () => cleanup();
  }, [open]);

  useEffect(() => {
    // Auto-scroll chat
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording]);

  const initializeMeeting = async () => {
    try {
      setConnectionStatus('Initializing...');
      
      // Initialize WebRTC service
      webrtcServiceRef.current = new WebRTCService();
      
      // Set up event handlers
      webrtcServiceRef.current.onParticipantJoined((participant) => {
        setParticipants(prev => [...prev, participant]);
        setConnectionStatus('Connected');
        setIsConnected(true);
        addNotification(`${participant.username} joined the meeting`, 'info');
      });

      webrtcServiceRef.current.onParticipantLeft((participantId) => {
        setParticipants(prev => prev.filter(p => p.id !== participantId));
        setRemoteStreams(prev => {
          const newStreams = new Map(prev);
          newStreams.delete(participantId);
          return newStreams;
        });
        addNotification('A participant left the meeting', 'info');
      });

      webrtcServiceRef.current.onTrack((participantId, stream) => {
        setRemoteStreams(prev => {
          const newStreams = new Map(prev);
          newStreams.set(participantId, stream);
          return newStreams;
        });
      });

      webrtcServiceRef.current.onMessage((message) => {
        setMessages(prev => [...prev, message]);
      });

      webrtcServiceRef.current.onRoomJoined((roomData) => {
        setParticipants(roomData.participants || []);
        setMessages(roomData.messages || []);
        setConnectionStatus('Connected');
        setIsConnected(true);
      });

      // Connect to signaling server
      await webrtcServiceRef.current.connect();
      
      // Initialize media
      await initializeMedia();
      
      // Join room
      const roomId = roomName.replace(/\s+/g, '-').toLowerCase();
      webrtcServiceRef.current.joinRoom(roomId, 'User', 'user@example.com');
      
    } catch (error) {
      console.error('Error initializing meeting:', error);
      setConnectionStatus('Connection failed');
      addNotification('Failed to connect to meeting', 'error');
    }
  };

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      if (webrtcServiceRef.current) {
        webrtcServiceRef.current.setLocalStream(stream);
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
      addNotification('Could not access camera/microphone', 'error');
    }
  };

  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (webrtcServiceRef.current) {
      webrtcServiceRef.current.leaveRoom();
      webrtcServiceRef.current.disconnect();
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    
    setLocalStream(null);
    setRemoteStreams(new Map());
    setParticipants([]);
    setIsConnected(false);
    setIsScreenSharing(false);
    setIsRecording(false);
    setRecordingTime(0);
    setRecordedChunks([]);
    setMessages([]);
    setRaisedHands(new Set());
    setConnectionStatus('Disconnected');
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        addNotification(audioTrack.enabled ? 'Microphone unmuted' : 'Microphone muted', 'info');
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
        addNotification(videoTrack.enabled ? 'Camera turned on' : 'Camera turned off', 'info');
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      setIsScreenSharing(false);
      addNotification('Screen sharing stopped', 'info');
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
            displaySurface: 'monitor'
          },
          audio: false
        });
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        setIsScreenSharing(true);
        addNotification('Screen sharing started', 'info');
        
        screenStream.getVideoTracks()[0].onended = () => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
          }
          setIsScreenSharing(false);
          addNotification('Screen sharing stopped', 'info');
        };
      } catch (error) {
        console.error('Error sharing screen:', error);
        addNotification('Could not start screen sharing', 'error');
      }
    }
  };

  const toggleHandRaise = () => {
    // Simulate hand raise for demo
    const isRaised = raisedHands.has('local');
    setRaisedHands(prev => {
      const newSet = new Set(prev);
      if (!isRaised) {
        newSet.add('local');
        addNotification('Hand raised', 'info');
      } else {
        newSet.delete('local');
        addNotification('Hand lowered', 'info');
      }
      return newSet;
    });
  };

  const startRecording = async () => {
    try {
      const stream = localStream;
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9,opus'
      });

      const chunks = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        setRecordedChunks(prev => [...prev, blob]);
        setIsRecording(false);
        setRecordingTime(0);
        setRecordingAlert(true);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      addNotification('Recording started', 'info');
      
    } catch (error) {
      console.error('Error starting recording:', error);
      addNotification('Could not start recording', 'error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      addNotification('Recording stopped', 'info');
    }
  };

  const downloadRecording = (blob, index) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-recording-${roomName}-${format(new Date(), 'yyyy-MM-dd-HH-mm-ss')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sendMessage = () => {
    if (newMessage.trim() && webrtcServiceRef.current) {
      webrtcServiceRef.current.sendChatMessage(newMessage);
      setNewMessage('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleShareLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
    navigator.clipboard.writeText(url).then(() => setShareSnackbar(true));
  };

  const addNotification = (message, type = 'info') => {
    const notification = {
      id: Date.now(),
      message,
      type,
      timestamp: new Date()
    };
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const hangUp = () => {
    cleanup();
    onClose();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      dialogRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircle />;
      case 'error': return <Error />;
      case 'warning': return <Warning />;
      default: return <InfoIcon />;
    }
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      fullWidth 
      maxWidth="xl" 
      fullScreen
      PaperProps={{ 
        sx: { 
          background: '#1a1a1a',
          borderRadius: 0,
          overflow: 'hidden'
        } 
      }}
      ref={dialogRef}
    >
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        px: 3, 
        py: 2, 
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
            {roomName}
          </Typography>
          <Chip 
            label={connectionStatus}
            size="small"
            color={isConnected ? 'success' : 'warning'}
            sx={{ 
              background: isConnected ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 193, 7, 0.2)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
          />
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>
            {participants.length} participant{participants.length !== 1 ? 's' : ''}
          </Typography>
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Share meeting link">
            <IconButton onClick={handleShareLink} sx={{ color: 'white' }}>
              <Share />
            </IconButton>
          </Tooltip>
          <Tooltip title="Meeting info">
            <IconButton onClick={() => setShowConnectionInfo(true)} sx={{ color: 'white' }}>
              <Info />
            </IconButton>
          </Tooltip>
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            <IconButton onClick={toggleFullscreen} sx={{ color: 'white' }}>
              {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
            </IconButton>
          </Tooltip>
          <Button 
            onClick={hangUp} 
            variant="contained" 
            color="error" 
            sx={{ 
              fontWeight: 600, 
              borderRadius: 2, 
              px: 3, 
              py: 1,
              background: '#d32f2f',
              '&:hover': { background: '#c62828' }
            }}
          >
            Leave
          </Button>
        </Box>
      </Box>

      {/* Main Content */}
      <Box sx={{ 
        display: 'flex', 
        flex: 1, 
        minHeight: 0,
        position: 'relative',
        background: '#000'
      }}>
        {/* Video Grid */}
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Recording Indicator */}
          {isRecording && (
            <Box sx={{ 
              position: 'absolute', 
              top: 16, 
              left: 16, 
              zIndex: 10,
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              bgcolor: 'error.main', 
              color: 'white', 
              px: 2, 
              py: 1, 
              borderRadius: 2, 
              boxShadow: 4 
            }}>
              <FiberManualRecord sx={{ animation: 'pulse 1s infinite' }} />
              <Typography variant="body2">REC {formatTime(recordingTime)}</Typography>
            </Box>
          )}

          {/* Video Grid */}
          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 2, 
            p: 3, 
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {/* Local Video */}
            <Box sx={{ 
              position: 'relative', 
              aspectRatio: '16/9',
              borderRadius: 2, 
              overflow: 'hidden', 
              bgcolor: '#111',
              boxShadow: 4,
              border: '2px solid rgba(255,255,255,0.1)'
            }}>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'cover',
                  background: '#111'
                }}
              />
              <Box sx={{ 
                position: 'absolute', 
                bottom: 8, 
                left: 8, 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1,
                bgcolor: 'rgba(0,0,0,0.7)',
                px: 2,
                py: 1,
                borderRadius: 1
              }}>
                <Avatar sx={{ width: 24, height: 24, bgcolor: '#1976d2' }}>
                  <PersonIcon />
                </Avatar>
                <Typography variant="caption" sx={{ color: 'white' }}>
                  You {isScreenSharing ? '(Screen Share)' : ''}
                </Typography>
                {isMuted && <MicOff sx={{ color: 'white', fontSize: 16 }} />}
                {isVideoOff && <VideocamOff sx={{ color: 'white', fontSize: 16 }} />}
              </Box>
            </Box>

            {/* Remote Videos */}
            {Array.from(remoteStreams.entries()).map(([participantId, stream], idx) => {
              const participant = participants.find(p => p.id === participantId);
              const hasRaisedHand = raisedHands.has(participantId);
              
              return (
                <Box key={participantId} sx={{ 
                  position: 'relative', 
                  aspectRatio: '16/9',
                  borderRadius: 2, 
                  overflow: 'hidden', 
                  bgcolor: '#111',
                  boxShadow: 4,
                  border: '2px solid rgba(255,255,255,0.1)'
                }}>
                  <video
                    ref={el => { 
                      if (el) { 
                        el.srcObject = stream; 
                        remoteVideosRef.current.set(participantId, el); 
                      } 
                    }}
                    autoPlay
                    playsInline
                    controls={false}
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover',
                      background: '#111'
                    }}
                  />
                  <Box sx={{ 
                    position: 'absolute', 
                    bottom: 8, 
                    left: 8, 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1,
                    bgcolor: 'rgba(0,0,0,0.7)',
                    px: 2,
                    py: 1,
                    borderRadius: 1
                  }}>
                    <Avatar sx={{ width: 24, height: 24, bgcolor: '#9c27b0' }}>
                      <PersonIcon />
                    </Avatar>
                    <Typography variant="caption" sx={{ color: 'white' }}>
                      {participant?.username || `Participant ${idx + 1}`}
                    </Typography>
                    {hasRaisedHand && (
                      <HandRaise sx={{ color: '#ff9800', fontSize: 16 }} />
                    )}
                  </Box>
                </Box>
              );
            })}

            {/* Empty State */}
            {remoteStreams.size === 0 && (
              <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                justifyContent: 'center', 
                bgcolor: 'rgba(255,255,255,0.05)',
                borderRadius: 2,
                p: 4,
                border: '2px dashed rgba(255,255,255,0.2)'
              }}>
                <People sx={{ fontSize: 60, color: 'rgba(255,255,255,0.3)', mb: 2 }} />
                <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>
                  Waiting for others to join
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
                  Share the meeting link with others to start collaborating
                </Typography>
              </Box>
            )}
          </Box>

          {/* Controls Bar */}
          <AnimatePresence>
            {showControls && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Box sx={{ 
                  position: 'absolute', 
                  bottom: 0, 
                  left: 0, 
                  right: 0,
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: 2,
                  p: 3,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                  backdropFilter: 'blur(10px)'
                }}>
                  {/* Left Controls */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title={isMuted ? 'Unmute (Ctrl+M)' : 'Mute (Ctrl+M)'}>
                      <IconButton 
                        onClick={toggleMute} 
                        color={isMuted ? 'error' : 'primary'} 
                        size="large"
                        sx={{ 
                          bgcolor: isMuted ? 'rgba(244,67,54,0.2)' : 'rgba(25,118,210,0.2)',
                          color: 'white',
                          '&:hover': { 
                            bgcolor: isMuted ? 'rgba(244,67,54,0.3)' : 'rgba(25,118,210,0.3)' 
                          }
                        }}
                      >
                        {isMuted ? <MicOff /> : <Mic />}
                      </IconButton>
                    </Tooltip>
                    
                    <Tooltip title={isVideoOff ? 'Turn on camera (Ctrl+V)' : 'Turn off camera (Ctrl+V)'}>
                      <IconButton 
                        onClick={toggleVideo} 
                        color={isVideoOff ? 'error' : 'primary'} 
                        size="large"
                        sx={{ 
                          bgcolor: isVideoOff ? 'rgba(244,67,54,0.2)' : 'rgba(25,118,210,0.2)',
                          color: 'white',
                          '&:hover': { 
                            bgcolor: isVideoOff ? 'rgba(244,67,54,0.3)' : 'rgba(25,118,210,0.3)' 
                          }
                        }}
                      >
                        {isVideoOff ? <VideocamOff /> : <Videocam />}
                      </IconButton>
                    </Tooltip>
                  </Box>

                  {/* Center Controls */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title={isScreenSharing ? 'Stop sharing screen (Ctrl+D)' : 'Share screen (Ctrl+D)'}>
                      <IconButton 
                        onClick={toggleScreenShare} 
                        color={isScreenSharing ? 'error' : 'primary'} 
                        size="large"
                        sx={{ 
                          bgcolor: isScreenSharing ? 'rgba(244,67,54,0.2)' : 'rgba(25,118,210,0.2)',
                          color: 'white',
                          '&:hover': { 
                            bgcolor: isScreenSharing ? 'rgba(244,67,54,0.3)' : 'rgba(25,118,210,0.3)' 
                          }
                        }}
                      >
                        {isScreenSharing ? <StopScreenShare /> : <PresentToAll />}
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="Raise hand (Ctrl+H)">
                      <IconButton 
                        onClick={toggleHandRaise}
                        color={raisedHands.has('local') ? 'warning' : 'primary'} 
                        size="large"
                        sx={{ 
                          bgcolor: raisedHands.has('local') ? 'rgba(255,152,0,0.2)' : 'rgba(25,118,210,0.2)',
                          color: 'white',
                          '&:hover': { 
                            bgcolor: raisedHands.has('local') ? 'rgba(255,152,0,0.3)' : 'rgba(25,118,210,0.3)' 
                          }
                        }}
                      >
                        {raisedHands.has('local') ? <HandRaiseAlt /> : <HandRaise />}
                      </IconButton>
                    </Tooltip>

                    {!isRecording ? (
                      <Tooltip title="Start recording">
                        <IconButton 
                          onClick={startRecording} 
                          color="primary" 
                          size="large"
                          sx={{ 
                            bgcolor: 'rgba(25,118,210,0.2)',
                            color: 'white',
                            '&:hover': { bgcolor: 'rgba(25,118,210,0.3)' }
                          }}
                        >
                          <FiberManualRecord />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Stop recording">
                        <IconButton 
                          onClick={stopRecording} 
                          color="error" 
                          size="large"
                          sx={{ 
                            bgcolor: 'rgba(244,67,54,0.2)',
                            color: 'white',
                            '&:hover': { bgcolor: 'rgba(244,67,54,0.3)' }
                          }}
                        >
                          <Stop />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>

                  {/* Right Controls */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Chat (Ctrl+Shift+C)">
                      <IconButton 
                        onClick={() => setShowChat(!showChat)} 
                        color="primary" 
                        size="large"
                        sx={{ 
                          bgcolor: showChat ? 'rgba(25,118,210,0.3)' : 'rgba(25,118,210,0.2)',
                          color: 'white',
                          '&:hover': { bgcolor: 'rgba(25,118,210,0.3)' }
                        }}
                      >
                        <Badge badgeContent={messages.length} color="error">
                          <Chat />
                        </Badge>
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="Participants">
                      <IconButton 
                        onClick={() => setShowParticipants(!showParticipants)} 
                        color="primary" 
                        size="large"
                        sx={{ 
                          bgcolor: showParticipants ? 'rgba(25,118,210,0.3)' : 'rgba(25,118,210,0.2)',
                          color: 'white',
                          '&:hover': { bgcolor: 'rgba(25,118,210,0.3)' }
                        }}
                      >
                        <Badge badgeContent={participants.length} color="error">
                          <Group />
                        </Badge>
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="More options">
                      <IconButton 
                        onClick={() => setShowSettings(!showSettings)} 
                        color="primary" 
                        size="large"
                        sx={{ 
                          bgcolor: showSettings ? 'rgba(25,118,210,0.3)' : 'rgba(25,118,210,0.2)',
                          color: 'white',
                          '&:hover': { bgcolor: 'rgba(25,118,210,0.3)' }
                        }}
                      >
                        <MoreVert />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </motion.div>
            )}
          </AnimatePresence>
        </Box>

        {/* Chat Panel */}
        <Slide direction="left" in={showChat} mountOnEnter unmountOnExit>
          <Box sx={{ 
            width: 400, 
            display: 'flex', 
            flexDirection: 'column',
            bgcolor: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(10px)',
            borderLeft: '1px solid rgba(0,0,0,0.1)'
          }}>
            <Box sx={{ 
              p: 2, 
              borderBottom: '1px solid rgba(0,0,0,0.1)',
              bgcolor: 'rgba(25,118,210,0.1)'
            }}>
              <Typography variant="h6" sx={{ fontWeight: 600, color: '#1976d2' }}>
                Chat
              </Typography>
            </Box>
            
            <List sx={{ flex: 1, overflow: 'auto', p: 1 }}>
              {messages.map((message) => (
                <ListItem key={message.id} sx={{ flexDirection: 'column', alignItems: 'flex-start', mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <Typography variant="subtitle2" color="#9c27b0" sx={{ fontWeight: 600 }}>
                      {message.sender}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {format(new Date(message.timestamp), 'HH:mm')}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ 
                    mt: 0.5, 
                    color: '#fff', 
                    bgcolor: '#1976d2', 
                    px: 2, 
                    py: 1, 
                    borderRadius: 2, 
                    boxShadow: 1,
                    maxWidth: '100%',
                    wordBreak: 'break-word'
                  }}>
                    {message.text}
                  </Typography>
                </ListItem>
              ))}
              <div ref={chatEndRef} />
            </List>
            
            <Divider />
            <Box sx={{ p: 2, display: 'flex', gap: 1 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                sx={{ bgcolor: '#fff', borderRadius: 2 }}
              />
              <IconButton 
                onClick={sendMessage} 
                color="primary" 
                sx={{ 
                  bgcolor: '#1976d2', 
                  color: '#fff', 
                  borderRadius: 2, 
                  '&:hover': { bgcolor: '#1565c0' } 
                }}
              >
                <Send />
              </IconButton>
            </Box>
          </Box>
        </Slide>

        {/* Participants Panel */}
        <Slide direction="left" in={showParticipants} mountOnEnter unmountOnExit>
          <Box sx={{ 
            width: 350, 
            display: 'flex', 
            flexDirection: 'column',
            bgcolor: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(10px)',
            borderLeft: '1px solid rgba(0,0,0,0.1)'
          }}>
            <Box sx={{ 
              p: 2, 
              borderBottom: '1px solid rgba(0,0,0,0.1)',
              bgcolor: 'rgba(25,118,210,0.1)'
            }}>
              <Typography variant="h6" sx={{ fontWeight: 600, color: '#1976d2' }}>
                Participants ({participants.length})
              </Typography>
            </Box>
            
            <List sx={{ flex: 1, overflow: 'auto', p: 1 }}>
              {participants.map((participant, idx) => (
                <ListItem key={participant.id || idx} sx={{ mb: 1 }}>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: '#1976d2' }}>
                      <PersonIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText 
                    primary={participant.username || `Participant ${idx + 1}`}
                    secondary={participant.email}
                  />
                  {raisedHands.has(participant.id) && (
                    <HandRaise sx={{ color: '#ff9800' }} />
                  )}
                </ListItem>
              ))}
            </List>
          </Box>
        </Slide>
      </Box>

      {/* Notifications */}
      <Box sx={{ 
        position: 'fixed', 
        top: 20, 
        right: 20, 
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 1
      }}>
        <AnimatePresence>
          {notifications.map((notification) => (
            <motion.div
              key={notification.id}
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Alert 
                severity={notification.type}
                icon={getNotificationIcon(notification.type)}
                sx={{ 
                  minWidth: 300,
                  boxShadow: 4,
                  borderRadius: 2
                }}
              >
                {notification.message}
              </Alert>
            </motion.div>
          ))}
        </AnimatePresence>
      </Box>

      {/* Snackbars */}
      <Snackbar
        open={shareSnackbar}
        autoHideDuration={3000}
        onClose={() => setShareSnackbar(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setShareSnackbar(false)} severity="success" sx={{ width: '100%' }}>
          Meeting link copied to clipboard!
        </Alert>
      </Snackbar>

      <Snackbar
        open={recordingAlert}
        autoHideDuration={4000}
        onClose={() => setRecordingAlert(false)}
      >
        <Alert onClose={() => setRecordingAlert(false)} severity="success">
          Recording saved! You can download it from the recordings section.
        </Alert>
      </Snackbar>

      {/* Recordings Section */}
      {recordedChunks.length > 0 && (
        <Box sx={{ 
          position: 'fixed', 
          bottom: 100, 
          right: 20, 
          zIndex: 1000,
          bgcolor: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(10px)',
          borderRadius: 2,
          p: 2,
          boxShadow: 4,
          minWidth: 250
        }}>
          <Typography variant="h6" gutterBottom>
            Recordings ({recordedChunks.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {recordedChunks.map((blob, index) => (
              <Button
                key={index}
                variant="outlined"
                startIcon={<Download />}
                onClick={() => downloadRecording(blob, index)}
                size="small"
                fullWidth
              >
                Recording {index + 1}
              </Button>
            ))}
          </Box>
        </Box>
      )}
    </Dialog>
  );
};

export default VideoChat;