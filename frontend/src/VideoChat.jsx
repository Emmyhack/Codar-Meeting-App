import React, { useState, useRef, useEffect } from 'react';
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
  ListItemAvatar
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
  Group
} from '@mui/icons-material';
import WebRTCService from './services/WebRTCService';
import PersonIcon from '@mui/icons-material/Person';

const VideoChat = ({ open, onClose, roomName }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingType, setRecordingType] = useState('video');
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showRecordingAlert, setShowRecordingAlert] = useState(false);
  
  // Closed Captions state
  const [ccEnabled, setCcEnabled] = useState(false);
  const [ccLanguage, setCcLanguage] = useState('en-US');
  const [ccTranscript, setCcTranscript] = useState([]);
  const [ccInterim, setCcInterim] = useState('');
  const [showCcSettings, setShowCcSettings] = useState(false);
  const [ccFontSize, setCcFontSize] = useState('medium');
  const [ccPosition, setCcPosition] = useState('bottom');
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(true);

  const localVideoRef = useRef();
  const remoteVideosRef = useRef(new Map());
  const chatEndRef = useRef();
  const mediaRecorderRef = useRef();
  const recordingTimerRef = useRef();
  const recognitionRef = useRef();
  const webrtcServiceRef = useRef();

  const [participantsAnchorEl, setParticipantsAnchorEl] = useState(null);
  const [shareSnackbar, setShareSnackbar] = useState(false);

  // Available languages for speech recognition
  const availableLanguages = [
    { code: 'en-US', name: 'English (US)' },
    { code: 'en-GB', name: 'English (UK)' },
    { code: 'es-ES', name: 'Spanish' },
    { code: 'fr-FR', name: 'French' },
    { code: 'de-DE', name: 'German' },
    { code: 'it-IT', name: 'Italian' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)' },
    { code: 'ja-JP', name: 'Japanese' },
    { code: 'ko-KR', name: 'Korean' },
    { code: 'zh-CN', name: 'Chinese (Simplified)' },
  ];

  useEffect(() => {
    if (open) {
      // Auto-copy meeting link to clipboard and show snackbar
      const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
      navigator.clipboard.writeText(url).then(() => setShareSnackbar(true));
      initializeMeeting();
    }
    return () => cleanup();
  }, [open]);

  useEffect(() => {
    // Auto-scroll to bottom of chat
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Recording timer effect
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

  // Closed Captions effect
  useEffect(() => {
    if (ccEnabled && open) {
      initializeSpeechRecognition();
    } else {
      stopSpeechRecognition();
    }

    return () => {
      stopSpeechRecognition();
    };
  }, [ccEnabled, ccLanguage, open]);

  const initializeMeeting = async () => {
    try {
      setConnectionStatus('Initializing...');
      
      // Initialize WebRTC service
      webrtcServiceRef.current = new WebRTCService();
      
      // Set up callbacks
      webrtcServiceRef.current.onMessage((message) => {
        setMessages(prev => [...prev, message]);
      });

      webrtcServiceRef.current.onParticipantJoined((participant) => {
        setParticipants(prev => [...prev, participant]);
        setConnectionStatus('Connected');
        setIsConnected(true);
      });

      webrtcServiceRef.current.onParticipantLeft((participantId) => {
        setParticipants(prev => prev.filter(p => p.id !== participantId));
        setRemoteStreams(prev => {
          const newStreams = new Map(prev);
          newStreams.delete(participantId);
          return newStreams;
        });
      });

      webrtcServiceRef.current.onTrack((participantId, stream) => {
        setRemoteStreams(prev => {
          const newStreams = new Map(prev);
          newStreams.set(participantId, stream);
          return newStreams;
        });
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
      alert('Failed to connect to meeting. Please try again.');
    }
  };

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      // Log audio track info for debugging
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log('Local audio track initialized:', {
          enabled: audioTrack.enabled,
          muted: audioTrack.muted,
          readyState: audioTrack.readyState,
          id: audioTrack.id
        });
      }
      
      // Set local stream in WebRTC service
      if (webrtcServiceRef.current) {
        webrtcServiceRef.current.setLocalStream(stream);
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
      alert('Could not access camera/microphone. Please check permissions.');
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
    stopSpeechRecognition();
    setLocalStream(null);
    setRemoteStreams(new Map());
    setParticipants([]);
    setIsConnected(false);
    setIsScreenSharing(false);
    setIsRecording(false);
    setRecordingTime(0);
    setRecordedChunks([]);
    setCcTranscript([]);
    setCcInterim('');
    setMessages([]);
    setConnectionStatus('Disconnected');
  };

  const initializeSpeechRecognition = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      setCcEnabled(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = ccLanguage;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('Speech recognition started');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        const newEntry = {
          id: Date.now(),
          text: finalTranscript,
          timestamp: new Date().toLocaleTimeString(),
          speaker: 'Speaker'
        };
        setCcTranscript(prev => [...prev.slice(-50), newEntry]); // Keep last 50 entries
        setCcInterim('');
      } else {
        setCcInterim(interimTranscript);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        // Restart recognition after a brief pause
        setTimeout(() => {
          if (ccEnabled) {
            recognition.start();
          }
        }, 1000);
      }
    };

    recognition.onend = () => {
      if (ccEnabled) {
        recognition.start();
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const toggleClosedCaptions = () => {
    setCcEnabled(!ccEnabled);
    if (!ccEnabled) {
      setCcTranscript([]);
      setCcInterim('');
    }
  };

  const clearTranscript = () => {
    setCcTranscript([]);
    setCcInterim('');
  };

  const startRecording = async () => {
    try {
      let streamToRecord;
      
      if (recordingType === 'screen') {
        streamToRecord = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } else if (recordingType === 'audio') {
        streamToRecord = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
      } else {
        // Video recording - combine local video and audio
        streamToRecord = localStream;
      }

      const mediaRecorder = new MediaRecorder(streamToRecord, {
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
        setRecordedChunks([...recordedChunks, blob]);
        setIsRecording(false);
        setRecordingTime(0);
        setShowRecordingAlert(true);
        
        // Stop the screen stream if it was for recording
        if (recordingType === 'screen') {
          streamToRecord.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not start recording. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
  };

  const downloadRecording = (blob, index) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `codarmeet-recording-${roomName}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        console.log('Audio track enabled:', audioTrack.enabled);
      }
    }
  };

  const testAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        console.log('Audio track info:', {
          enabled: audioTrack.enabled,
          muted: audioTrack.muted,
          readyState: audioTrack.readyState,
          id: audioTrack.id
        });
        
        // Create a test tone
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 note
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime); // Low volume
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.5); // Play for 0.5 seconds
        
        alert('Audio test completed. Check console for audio track info.');
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        setIsScreenSharing(true);
        
        screenStream.getVideoTracks()[0].onended = () => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
          }
          setIsScreenSharing(false);
        };
      } catch (error) {
        console.error('Error sharing screen:', error);
        alert('Could not start screen sharing.');
      }
    }
  };

  const sendMessage = () => {
    if (newMessage.trim() && webrtcServiceRef.current) {
      webrtcServiceRef.current.sendChatMessage(newMessage);
      setNewMessage('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const hangUp = () => {
    cleanup();
    onClose();
  };

  const handleShareLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
    navigator.clipboard.writeText(url).then(() => setShareSnackbar(true));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xl" PaperProps={{ sx: { background: 'linear-gradient(135deg, #232526 0%, #414345 100%)', boxShadow: 24, borderRadius: 4 } }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, py: 2, background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h5" sx={{ color: 'white', fontWeight: 700, letterSpacing: 1 }}>
            {roomName}
          </Typography>
          <Tooltip title="Share Meeting Link">
            <IconButton onClick={handleShareLink} sx={{ color: 'white' }}>
              <Send />
            </IconButton>
          </Tooltip>
          <Tooltip title="View Participants">
            <IconButton onClick={e => setParticipantsAnchorEl(e.currentTarget)} sx={{ color: 'white' }}>
              <Group />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(participantsAnchorEl)}
            anchorEl={participantsAnchorEl}
            onClose={() => setParticipantsAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <Box sx={{ p: 2, minWidth: 220 }}>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>Participants</Typography>
              <List>
                {participants.map((p, idx) => (
                  <ListItem key={p.id || idx}>
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: '#667eea' }}><PersonIcon /></Avatar>
                    </ListItemAvatar>
                    <ListItemText primary={p.username || `User ${idx + 1}`} />
                  </ListItem>
                ))}
              </List>
            </Box>
          </Popover>
        </Box>
        <Button onClick={hangUp} variant="contained" color="error" sx={{ fontWeight: 600, borderRadius: 2, px: 4, py: 1, fontSize: '1.1rem', boxShadow: 2 }}>
          Leave
        </Button>
      </Box>

      {/* Recording/CC Indicators */}
      <Box sx={{ position: 'absolute', top: 24, left: 32, zIndex: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
            {isRecording && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'error.main', color: 'white', px: 2, py: 1, borderRadius: 2, boxShadow: 2 }}>
                <FiberManualRecord sx={{ animation: 'pulse 1s infinite' }} />
            <Typography variant="body2">REC {formatTime(recordingTime)}</Typography>
              </Box>
            )}
            {ccEnabled && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'success.main', color: 'white', px: 2, py: 1, borderRadius: 2, boxShadow: 2 }}>
                <ClosedCaption />
                <Typography variant="body2">CC ON</Typography>
              </Box>
            )}
        </Box>
        
      {/* Main Content */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, background: 'rgba(30,32,34,0.98)', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
        {/* Video Grid */}
        <Box sx={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 2, p: 3, position: 'relative' }}>
            {/* Connection Status */}
            <Box sx={{ textAlign: 'center', mb: 1 }}>
            <Typography variant="body2" color="#bdbdbd">
                {connectionStatus} • {participants.length} participant{participants.length !== 1 ? 's' : ''}
              </Typography>
            </Box>
          <Box sx={{ display: 'flex', gap: 2, flex: 1, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
              {/* Local Video */}
            <Box sx={{ flex: 1, minWidth: 320, maxWidth: 420, position: 'relative', boxShadow: 4, borderRadius: 3, overflow: 'hidden', bgcolor: '#222' }}>
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#111' }}
              />
              <Box sx={{ position: 'absolute', left: 0, bottom: 0, width: '100%', bgcolor: 'rgba(0,0,0,0.5)', color: 'white', px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar sx={{ width: 24, height: 24, bgcolor: '#667eea', fontSize: 16 }}><PersonIcon /></Avatar>
                <Typography variant="caption">You {isScreenSharing ? '(Screen Share)' : ''}</Typography>
              </Box>
            </Box>
              {/* Remote Videos */}
            {Array.from(remoteStreams.entries()).map(([participantId, stream], idx) => {
                const participant = participants.find(p => p.id === participantId);
                return (
                <Box key={participantId} sx={{ flex: 1, minWidth: 320, maxWidth: 420, position: 'relative', boxShadow: 4, borderRadius: 3, overflow: 'hidden', bgcolor: '#222' }}>
                    <video
                    ref={el => { if (el) { el.srcObject = stream; remoteVideosRef.current.set(participantId, el); } }}
                      autoPlay
                      playsInline
                      controls={false}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#111' }}
                  />
                  <Box sx={{ position: 'absolute', left: 0, bottom: 0, width: '100%', bgcolor: 'rgba(0,0,0,0.5)', color: 'white', px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar sx={{ width: 24, height: 24, bgcolor: '#764ba2', fontSize: 16 }}><PersonIcon /></Avatar>
                    <Typography variant="caption">{participant?.username || `Remote User ${idx + 1}`}</Typography>
                  </Box>
                  </Box>
                );
              })}
              {/* Placeholder for waiting participants */}
              {remoteStreams.size === 0 && (
              <Box sx={{ flex: 1, minWidth: 320, maxWidth: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#18191a', borderRadius: 3, boxShadow: 2 }}>
                <PersonIcon sx={{ fontSize: 60, color: '#444' }} />
                <Typography variant="body1" color="#888" sx={{ ml: 2 }}>
                    Waiting for participants to join...
                  </Typography>
                </Box>
              )}
            </Box>
            {/* Closed Captions Overlay */}
            {ccEnabled && (ccTranscript.length > 0 || ccInterim) && (
              <Box
                sx={{
                  position: 'absolute',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  bottom: ccPosition === 'bottom' ? '120px' : '50%',
                  top: ccPosition === 'top' ? '20px' : 'auto',
                  zIndex: 1000,
                  bgcolor: 'rgba(0, 0, 0, 0.8)',
                  color: 'white',
                  px: 3,
                  py: 2,
                  borderRadius: 2,
                  maxWidth: '80%',
                  textAlign: 'center',
                  backdropFilter: 'blur(4px)',
                  fontSize: ccFontSize === 'small' ? '14px' : ccFontSize === 'large' ? '20px' : '16px',
                  fontWeight: 'bold',
                  textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                  lineHeight: 1.4,
                  maxHeight: '120px',
                overflow: 'hidden',
                boxShadow: 4
                }}
              >
                {ccTranscript.length > 0 && (
                  <Typography variant="body1" sx={{ mb: 1 }}>
                    {ccTranscript[ccTranscript.length - 1]?.text}
                  </Typography>
                )}
                {ccInterim && (
                  <Typography variant="body2" sx={{ opacity: 0.7, fontStyle: 'italic' }}>
                    {ccInterim}
                  </Typography>
                )}
              </Box>
            )}
          {/* Floating Controls Bar */}
          <Box sx={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 20, bgcolor: 'rgba(30,32,34,0.95)', borderRadius: 3, boxShadow: 4, px: 3, py: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
            <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
              <IconButton onClick={toggleMute} color={isMuted ? 'error' : 'primary'} size="large">
                {isMuted ? <MicOff /> : <Mic />}
                    </IconButton>
                  </Tooltip>
            <Tooltip title={isVideoOff ? 'Turn on Camera' : 'Turn off Camera'}>
              <IconButton onClick={toggleVideo} color={isVideoOff ? 'error' : 'primary'} size="large">
                {isVideoOff ? <VideocamOff /> : <Videocam />}
                    </IconButton>
                  </Tooltip>
            <Tooltip title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}>
              <IconButton onClick={toggleScreenShare} color={isScreenSharing ? 'error' : 'primary'} size="large">
                <ScreenShare />
                    </IconButton>
                  </Tooltip>
            <Tooltip title={ccEnabled ? 'Turn off Closed Captions' : 'Turn on Closed Captions'}>
              <IconButton onClick={toggleClosedCaptions} color={ccEnabled ? 'success' : 'primary'} size="large">
                {ccEnabled ? <ClosedCaption /> : <ClosedCaptionOff />}
                  </IconButton>
                </Tooltip>
              <Tooltip title="Test Audio">
              <IconButton onClick={testAudio} color="primary" size="large">
                  <Settings />
                </IconButton>
              </Tooltip>
            {!isRecording ? (
              <Tooltip title="Start Recording">
                <IconButton onClick={() => { setRecordingType('video'); startRecording(); }} color="primary" size="large">
                  <FiberManualRecord />
              </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title="Stop Recording">
                <IconButton onClick={stopRecording} color="error" size="large">
                  <Stop />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={showChat ? 'Hide Chat' : 'Show Chat'}>
              <IconButton onClick={() => setShowChat(!showChat)} color="primary" size="large">
                <Chat />
              </IconButton>
            </Tooltip>
            </Box>
          </Box>
        {/* Chat Panel */}
          {showChat && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 340, maxWidth: 400, bgcolor: 'rgba(36,37,38,0.98)', borderLeft: '2px solid #222', borderBottomRightRadius: 16, boxShadow: 2 }}>
            <Paper elevation={0} sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: 'transparent', boxShadow: 'none' }}>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'rgba(102,126,234,0.08)' }}>
                <Typography variant="h6" sx={{ color: '#667eea', fontWeight: 700 }}>Chat</Typography>
                </Box>
                <List sx={{ flex: 1, overflow: 'auto', p: 1 }}>
                  {messages.map((message) => (
                  <ListItem key={message.id} sx={{ flexDirection: 'column', alignItems: 'flex-start', mb: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <Typography variant="subtitle2" color="#764ba2" sx={{ fontWeight: 600 }}>
                          {message.sender}
                        </Typography>
                      <Typography variant="caption" color="#bdbdbd">
                          {message.timestamp}
                        </Typography>
                      </Box>
                    <Typography variant="body2" sx={{ mt: 0.5, color: '#fff', bgcolor: '#667eea', px: 2, py: 1, borderRadius: 2, boxShadow: 1 }}>
                        {message.text}
                      </Typography>
                    </ListItem>
                  ))}
                  <div ref={chatEndRef} />
                </List>
                <Divider />
              <Box sx={{ p: 1.5, display: 'flex', gap: 1, bgcolor: 'rgba(102,126,234,0.08)' }}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                  sx={{ bgcolor: '#fff', borderRadius: 2 }}
                  />
                <IconButton onClick={sendMessage} color="primary" sx={{ bgcolor: '#667eea', color: '#fff', borderRadius: 2, '&:hover': { bgcolor: '#5a6fd8' } }}>
                    <Send />
                  </IconButton>
                </Box>
              </Paper>
            </Box>
          )}
        </Box>
        {/* Recordings Section */}
        {recordedChunks.length > 0 && (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1, boxShadow: 2, mx: 4 }}>
            <Typography variant="h6" gutterBottom>
              Recordings ({recordedChunks.length})
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {recordedChunks.map((blob, index) => (
                <Button
                  key={index}
                  variant="outlined"
                  startIcon={<Download />}
                  onClick={() => downloadRecording(blob, index)}
                  size="small"
                >
                  Recording {index + 1}
                </Button>
              ))}
            </Box>
          </Box>
        )}
        {/* Closed Captions Transcript Section */}
        {ccEnabled && ccTranscript.length > 0 && (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'blue.50', borderRadius: 1, boxShadow: 2, mx: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6">
                Live Transcript ({ccTranscript.length} entries)
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" onClick={clearTranscript} sx={{ color: '#667eea' }}>
                  Clear
                </Button>
              <IconButton size="small" onClick={() => setShowCcSettings(true)} sx={{ color: '#667eea' }}>
                  <Settings />
                </IconButton>
              </Box>
            </Box>
            <Box sx={{ maxHeight: '150px', overflow: 'auto' }}>
              {ccTranscript.slice(-10).map((entry) => (
              <Box key={entry.id} sx={{ mb: 1, p: 1, bgcolor: 'white', borderRadius: 1, boxShadow: 1 }}>
                <Typography variant="caption" color="#bdbdbd">
                    {entry.timestamp}
                  </Typography>
                <Typography variant="body2" sx={{ color: '#232526' }}>
                    {entry.text}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      {/* Info Section */}
      <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1, mx: 4, boxShadow: 1 }}>
        <Typography variant="body2" color="#bdbdbd">
            WebRTC video call with chat, screen sharing, recording, and closed captions. In a real app, you would need a signaling server to connect peers and relay messages.
          </Typography>
        </Box>
      {/* Closed Captions Settings Dialog */}
      <Dialog open={showCcSettings} onClose={() => setShowCcSettings(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Closed Captions Settings</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Language</InputLabel>
              <Select
                value={ccLanguage}
                label="Language"
                onChange={(e) => setCcLanguage(e.target.value)}
              >
                {availableLanguages.map((lang) => (
                  <MenuItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Font Size</InputLabel>
              <Select
                value={ccFontSize}
                label="Font Size"
                onChange={(e) => setCcFontSize(e.target.value)}
              >
                <MenuItem value="small">Small</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="large">Large</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Position</InputLabel>
              <Select
                value={ccPosition}
                label="Position"
                onChange={(e) => setCcPosition(e.target.value)}
              >
                <MenuItem value="top">Top</MenuItem>
                <MenuItem value="bottom">Bottom</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCcSettings(false)} sx={{ color: '#667eea' }}>Close</Button>
        </DialogActions>
      </Dialog>
      {/* Recording Alert */}
      <Snackbar
        open={showRecordingAlert}
        autoHideDuration={4000}
        onClose={() => setShowRecordingAlert(false)}
      >
        <Alert onClose={() => setShowRecordingAlert(false)} severity="success">
          Recording saved! You can download it from the recordings section below.
        </Alert>
      </Snackbar>
      <Snackbar
        open={shareSnackbar}
        autoHideDuration={3000}
        onClose={() => setShareSnackbar(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setShareSnackbar(false)} severity="success" sx={{ width: '100%' }}>
          Meeting link copied! Share it with others to join this room.
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default VideoChat;