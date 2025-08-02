import { io } from 'socket.io-client';

class WebRTCService {
  constructor() {
    this.socket = null;
    this.localStream = null;
    this.screenStream = null;
    this.peers = new Map();
    this.roomId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 1000;
    this.isCleanedUp = false;
    this.connectionTimeout = null;
    this.heartbeatInterval = null;
    
    // ICE servers configuration (including free STUN servers)
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
    
    // Media constraints with fallback options
    this.mediaConstraints = {
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000
      }
    };

    // Fallback constraints for older devices
    this.fallbackMediaConstraints = {
      video: {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 15, max: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
    
    // Callbacks
    this.callbacks = {
      onJoinedRoom: null,
      onUserJoined: null,
      onUserLeft: null,
      onRemoteStream: null,
      onChatMessage: null,
      onConnectionStateChange: null,
      onError: null,
      onMediaStateUpdate: null,
      onScreenShareStart: null,
      onScreenShareStop: null,
      onHostChanged: null
    };

    // Bind methods to prevent memory leaks
    this.handleConnect = this.handleConnect.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleReconnect = this.handleReconnect.bind(this);
    this.handleReconnectFailed = this.handleReconnectFailed.bind(this);

    // Start heartbeat to keep connection alive
    this.startHeartbeat();
  }

  // Initialize connection to signaling server
  async connect(serverUrl = 'http://localhost:3002') {
    if (this.isCleanedUp) {
      throw new Error('WebRTC service has been cleaned up');
    }

    try {
      console.log('🔌 Connecting to signaling server...');
      
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      }

      this.socket = io(serverUrl, {
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectInterval,
        timeout: 10000,
        forceNew: true,
        transports: ['websocket', 'polling'] // Allow fallback
      });

      return new Promise((resolve, reject) => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }

        this.connectionTimeout = setTimeout(() => {
          this.callbacks.onError?.('Connection timeout');
          reject(new Error('Connection timeout'));
        }, 15000);

        // Connection established
        this.socket.once('connect', () => {
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          this.handleConnect();
          resolve();
        });

        // Connection error
        this.socket.once('connect_error', (error) => {
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          this.handleError(error);
          reject(error);
        });

        // Set up all event handlers
        this.setupEventHandlers();
      });

    } catch (error) {
      console.error('❌ Failed to connect:', error);
      this.callbacks.onError?.(`Failed to connect: ${error.message}`);
      throw error;
    }
  }

  handleConnect() {
    console.log('✅ Connected to signaling server:', this.socket.id);
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.callbacks.onConnectionStateChange?.('connected');
  }

  handleDisconnect(reason) {
    console.log('❌ Disconnected:', reason);
    this.isConnected = false;
    this.callbacks.onConnectionStateChange?.('disconnected');
    
    if (reason === 'io server disconnect' && !this.isCleanedUp) {
      // Server disconnected, try to reconnect
      this.handleReconnection();
    }
  }

  handleError(error) {
    console.error('❌ Connection error:', error);
    this.isConnected = false;
    this.callbacks.onConnectionStateChange?.('error');
    this.callbacks.onError?.(`Connection failed: ${error.message}`);
  }

  handleReconnect() {
    console.log('✅ Reconnected successfully');
    this.isConnected = true;
    this.callbacks.onConnectionStateChange?.('connected');
    
    // Rejoin room if we were in one
    if (this.roomId && !this.isCleanedUp) {
      this.rejoinRoom();
    }
  }

  handleReconnectFailed() {
    console.error('❌ Reconnection failed');
    this.callbacks.onConnectionStateChange?.('failed');
    this.callbacks.onError?.('Failed to reconnect to server');
  }

  // Set up all signaling message handlers
  setupEventHandlers() {
    if (!this.socket || this.isCleanedUp) return;

    // Connection events
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('connect_error', this.handleError);
    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}/${this.maxReconnectAttempts}`);
      this.callbacks.onConnectionStateChange?.('reconnecting');
    });
    this.socket.on('reconnect', this.handleReconnect);
    this.socket.on('reconnect_failed', this.handleReconnectFailed);

    // Room events
    this.socket.on('joined-room', (data) => {
      if (this.isCleanedUp) return;
      console.log('✅ Joined room:', data);
      this.roomId = data.roomId;
      this.callbacks.onJoinedRoom?.(data);
      
      // Initiate connections to existing participants
      if (data.existingParticipants?.length > 0) {
        data.existingParticipants.forEach(participant => {
          if (participant.id !== this.socket.id) {
            this.createPeerConnection(participant.id, true); // true = create offer
          }
        });
      }
    });

    this.socket.on('user-joined', (data) => {
      if (this.isCleanedUp) return;
      console.log('👤 User joined:', data);
      this.callbacks.onUserJoined?.(data);
      
      // Create peer connection but don't create offer (wait for their offer)
      if (data.participant?.id && data.participant.id !== this.socket.id) {
        this.createPeerConnection(data.participant.id, false);
      }
    });

    this.socket.on('user-left', (data) => {
      if (this.isCleanedUp) return;
      console.log('👋 User left:', data);
      this.callbacks.onUserLeft?.(data);
      if (data.participantId) {
        this.removePeerConnection(data.participantId);
      }
    });

    // WebRTC signaling events
    this.socket.on('offer', async (data) => {
      if (this.isCleanedUp) return;
      console.log('📞 Received offer from:', data.fromId);
      await this.handleOffer(data);
    });

    this.socket.on('answer', async (data) => {
      if (this.isCleanedUp) return;
      console.log('📱 Received answer from:', data.fromId);
      await this.handleAnswer(data);
    });

    this.socket.on('ice-candidate', async (data) => {
      if (this.isCleanedUp) return;
      await this.handleIceCandidate(data);
    });

    // Other events
    this.socket.on('chat-message', (data) => {
      if (this.isCleanedUp) return;
      console.log('💬 Chat message:', data);
      this.callbacks.onChatMessage?.(data);
    });

    this.socket.on('participant-media-update', (data) => {
      if (this.isCleanedUp) return;
      console.log('🎤📹 Media state update:', data);
      this.callbacks.onMediaStateUpdate?.(data);
    });

    this.socket.on('participant-screen-share-start', (data) => {
      if (this.isCleanedUp) return;
      console.log('🖥️ Screen share started:', data);
      this.callbacks.onScreenShareStart?.(data);
    });

    this.socket.on('participant-screen-share-stop', (data) => {
      if (this.isCleanedUp) return;
      console.log('🖥️ Screen share stopped:', data);
      this.callbacks.onScreenShareStop?.(data);
    });

    this.socket.on('host-changed', (data) => {
      if (this.isCleanedUp) return;
      console.log('👑 Host changed:', data);
      this.callbacks.onHostChanged?.(data);
    });

    this.socket.on('join-error', (data) => {
      if (this.isCleanedUp) return;
      console.error('❌ Join error:', data);
      this.callbacks.onError?.(data.error);
    });

    this.socket.on('server-shutdown', (data) => {
      console.log('🔄 Server is shutting down:', data.message);
      this.callbacks.onError?.('Server is shutting down. Please refresh the page.');
    });
  }

  // Start heartbeat to keep connection alive
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.socket.connected && !this.isCleanedUp) {
        this.socket.emit('ping');
      }
    }, 30000); // Every 30 seconds
  }

  // Join a room
  async joinRoom(roomId, userInfo = {}) {
    if (this.isCleanedUp) {
      throw new Error('WebRTC service has been cleaned up');
    }

    if (!this.isConnected) {
      throw new Error('Not connected to signaling server');
    }

    // Validate inputs
    if (!roomId || typeof roomId !== 'string') {
      throw new Error('Room ID must be a non-empty string');
    }

    if (!userInfo || typeof userInfo !== 'object') {
      throw new Error('User info must be an object');
    }

    console.log('🚪 Joining room:', roomId);
    this.roomId = roomId;
    
    this.socket.emit('join-room', {
      roomId,
      userInfo: {
        name: userInfo.name || 'Anonymous',
        email: userInfo.email || '',
        ...userInfo
      }
    });
  }

  // Rejoin room after reconnection
  async rejoinRoom() {
    if (this.roomId && !this.isCleanedUp) {
      console.log('🔄 Rejoining room after reconnection:', this.roomId);
      try {
        await this.joinRoom(this.roomId);
      } catch (error) {
        console.error('Failed to rejoin room:', error);
        this.callbacks.onError?.('Failed to rejoin room after reconnection');
      }
    }
  }

  // Leave current room
  leaveRoom() {
    if (this.socket && this.roomId && !this.isCleanedUp) {
      console.log('👋 Leaving room:', this.roomId);
      this.socket.emit('leave-room');
      
      // Close all peer connections
      this.peers.forEach((peer, peerId) => {
        this.removePeerConnection(peerId);
      });
      
      this.roomId = null;
    }
  }

  // Initialize local media with fallback
  async initializeMedia(constraints = this.mediaConstraints) {
    if (this.isCleanedUp) {
      throw new Error('WebRTC service has been cleaned up');
    }

    try {
      console.log('🎥 Initializing media with constraints:', constraints);
      
      // Stop any existing stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }

      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (primaryError) {
        console.warn('Primary media constraints failed, trying fallback:', primaryError);
        // Try fallback constraints
        this.localStream = await navigator.mediaDevices.getUserMedia(this.fallbackMediaConstraints);
      }
      
      console.log('✅ Local media initialized:', {
        videoTracks: this.localStream.getVideoTracks().length,
        audioTracks: this.localStream.getAudioTracks().length
      });

      // Add tracks to existing peer connections
      this.peers.forEach((peer) => {
        if (peer.connectionState !== 'closed') {
          this.localStream.getTracks().forEach(track => {
            const sender = peer.getSenders().find(s => s.track?.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track).catch(error => {
                console.error('Failed to replace track:', error);
              });
            } else {
              peer.addTrack(track, this.localStream);
            }
          });
        }
      });

      return this.localStream;
    } catch (error) {
      console.error('❌ Failed to initialize media:', error);
      this.callbacks.onError?.(`Failed to access camera/microphone: ${error.message}`);
      throw error;
    }
  }

  // Create peer connection with comprehensive error handling
  async createPeerConnection(peerId, shouldCreateOffer = false) {
    if (this.isCleanedUp) {
      return null;
    }

    try {
      console.log(`🔗 Creating peer connection with ${peerId}, shouldCreateOffer: ${shouldCreateOffer}`);
      
      // Remove existing connection if any
      this.removePeerConnection(peerId);
      
      const peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
        iceCandidatePoolSize: 10
      });

      // Set up connection state monitoring
      peerConnection.onconnectionstatechange = () => {
        console.log(`🔗 Connection state with ${peerId}:`, peerConnection.connectionState);
        
        switch (peerConnection.connectionState) {
          case 'failed':
            console.log(`🔄 Peer connection failed with ${peerId}, attempting to restart ICE`);
            peerConnection.restartIce();
            break;
          case 'disconnected':
            console.log(`❌ Peer disconnected: ${peerId}`);
            setTimeout(() => {
              if (peerConnection.connectionState === 'disconnected') {
                this.removePeerConnection(peerId);
              }
            }, 5000);
            break;
          case 'closed':
            console.log(`🚫 Peer connection closed: ${peerId}`);
            this.removePeerConnection(peerId);
            break;
        }
      };

      // Handle ICE connection state changes
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`🧊 ICE connection state with ${peerId}:`, peerConnection.iceConnectionState);
        
        if (peerConnection.iceConnectionState === 'failed') {
          console.log(`🔄 ICE connection failed with ${peerId}, restarting ICE`);
          peerConnection.restartIce();
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.socket && !this.isCleanedUp) {
          this.socket.emit('ice-candidate', {
            targetId: peerId,
            candidate: event.candidate,
            roomId: this.roomId
          });
        }
      };

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        if (this.isCleanedUp) return;
        console.log('📺 Received remote stream from:', peerId);
        const remoteStream = event.streams[0];
        if (remoteStream) {
          this.callbacks.onRemoteStream?.(peerId, remoteStream);
        }
      };

      // Add local stream tracks if available
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.localStream);
        });
      }

      this.peers.set(peerId, peerConnection);

      // Create offer if we should
      if (shouldCreateOffer) {
        await this.createOffer(peerId);
      }

      return peerConnection;
    } catch (error) {
      console.error(`❌ Failed to create peer connection with ${peerId}:`, error);
      this.callbacks.onError?.(`Failed to connect to participant: ${error.message}`);
      this.removePeerConnection(peerId);
      throw error;
    }
  }

  // Create and send offer
  async createOffer(peerId) {
    if (this.isCleanedUp) {
      return;
    }

    try {
      const peerConnection = this.peers.get(peerId);
      if (!peerConnection || peerConnection.connectionState === 'closed') {
        throw new Error(`No valid peer connection found for ${peerId}`);
      }

      console.log(`📞 Creating offer for ${peerId}`);
      
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnection.setLocalDescription(offer);

      if (this.socket && !this.isCleanedUp) {
        this.socket.emit('offer', {
          targetId: peerId,
          offer: offer,
          roomId: this.roomId
        });
      }

      console.log(`📞 Offer sent to ${peerId}`);
    } catch (error) {
      console.error(`❌ Failed to create offer for ${peerId}:`, error);
      this.callbacks.onError?.(`Failed to create offer: ${error.message}`);
    }
  }

  // Handle incoming offer
  async handleOffer(data) {
    if (this.isCleanedUp) {
      return;
    }

    try {
      const { fromId, offer } = data;
      console.log(`📞 Handling offer from ${fromId}`);

      let peerConnection = this.peers.get(fromId);
      if (!peerConnection || peerConnection.connectionState === 'closed') {
        peerConnection = await this.createPeerConnection(fromId, false);
      }

      if (!peerConnection) {
        throw new Error('Failed to create peer connection');
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      if (this.socket && !this.isCleanedUp) {
        this.socket.emit('answer', {
          targetId: fromId,
          answer: answer,
          roomId: this.roomId
        });
      }

      console.log(`📱 Answer sent to ${fromId}`);
    } catch (error) {
      console.error(`❌ Failed to handle offer from ${data.fromId}:`, error);
      this.callbacks.onError?.(`Failed to handle offer: ${error.message}`);
    }
  }

  // Handle incoming answer
  async handleAnswer(data) {
    if (this.isCleanedUp) {
      return;
    }

    try {
      const { fromId, answer } = data;
      console.log(`📱 Handling answer from ${fromId}`);

      const peerConnection = this.peers.get(fromId);
      if (!peerConnection || peerConnection.connectionState === 'closed') {
        console.error(`❌ No valid peer connection found for ${fromId}`);
        return;
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log(`✅ Answer processed from ${fromId}`);
    } catch (error) {
      console.error(`❌ Failed to handle answer from ${data.fromId}:`, error);
      this.callbacks.onError?.(`Failed to handle answer: ${error.message}`);
    }
  }

  // Handle ICE candidate
  async handleIceCandidate(data) {
    if (this.isCleanedUp) {
      return;
    }

    try {
      const { fromId, candidate } = data;
      const peerConnection = this.peers.get(fromId);
      
      if (peerConnection && peerConnection.connectionState !== 'closed' && candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error(`❌ Failed to handle ICE candidate from ${data.fromId}:`, error);
    }
  }

  // Remove peer connection with proper cleanup
  removePeerConnection(peerId) {
    const peerConnection = this.peers.get(peerId);
    if (peerConnection) {
      try {
        peerConnection.close();
      } catch (error) {
        console.error(`Error closing peer connection for ${peerId}:`, error);
      }
      this.peers.delete(peerId);
      console.log(`🗑️ Removed peer connection: ${peerId}`);
    }
  }

  // Toggle audio with error handling
  toggleAudio() {
    if (this.isCleanedUp) {
      return false;
    }

    try {
      if (this.localStream) {
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = !audioTrack.enabled;
          this.broadcastMediaState();
          return audioTrack.enabled;
        }
      }
      return false;
    } catch (error) {
      console.error('Error toggling audio:', error);
      this.callbacks.onError?.('Failed to toggle audio');
      return false;
    }
  }

  // Toggle video with error handling
  toggleVideo() {
    if (this.isCleanedUp) {
      return false;
    }

    try {
      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = !videoTrack.enabled;
          this.broadcastMediaState();
          return videoTrack.enabled;
        }
      }
      return false;
    } catch (error) {
      console.error('Error toggling video:', error);
      this.callbacks.onError?.('Failed to toggle video');
      return false;
    }
  }

  // Start screen sharing with comprehensive error handling
  async startScreenShare() {
    if (this.isCleanedUp) {
      throw new Error('WebRTC service has been cleaned up');
    }

    try {
      console.log('🖥️ Starting screen share...');
      
      // Stop existing screen stream
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(track => track.stop());
        this.screenStream = null;
      }
      
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          cursor: 'always',
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Replace video track in all peer connections
      const videoTrack = this.screenStream.getVideoTracks()[0];
      const promises = [];
      
      this.peers.forEach((peer) => {
        if (peer.connectionState !== 'closed') {
          const sender = peer.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            promises.push(sender.replaceTrack(videoTrack).catch(error => {
              console.error('Failed to replace video track with screen share:', error);
            }));
          }
        }
      });

      await Promise.all(promises);

      // Handle screen share end
      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      if (this.socket && !this.isCleanedUp) {
        this.socket.emit('start-screen-share', { roomId: this.roomId });
      }
      
      console.log('✅ Screen share started');
      return this.screenStream;
    } catch (error) {
      console.error('❌ Failed to start screen share:', error);
      this.callbacks.onError?.(`Failed to start screen share: ${error.message}`);
      throw error;
    }
  }

  // Stop screen sharing
  async stopScreenShare() {
    if (this.isCleanedUp) {
      return;
    }

    try {
      console.log('🖥️ Stopping screen share...');
      
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(track => track.stop());
        this.screenStream = null;
      }

      // Replace back to camera video
      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        const promises = [];
        
        this.peers.forEach((peer) => {
          if (peer.connectionState !== 'closed') {
            const sender = peer.getSenders().find(s => s.track?.kind === 'video');
            if (sender && videoTrack) {
              promises.push(sender.replaceTrack(videoTrack).catch(error => {
                console.error('Failed to replace screen share with camera:', error);
              }));
            }
          }
        });

        await Promise.all(promises);
      }

      if (this.socket && !this.isCleanedUp) {
        this.socket.emit('stop-screen-share', { roomId: this.roomId });
      }
      
      console.log('✅ Screen share stopped');
    } catch (error) {
      console.error('❌ Failed to stop screen share:', error);
      this.callbacks.onError?.(`Failed to stop screen share: ${error.message}`);
    }
  }

  // Send chat message with validation
  sendChatMessage(message) {
    if (this.isCleanedUp) {
      return;
    }

    if (!message || typeof message !== 'string') {
      console.error('Invalid chat message');
      return;
    }

    const sanitizedMessage = message.trim();
    if (!sanitizedMessage) {
      return;
    }

    if (this.socket && this.roomId) {
      this.socket.emit('chat-message', {
        roomId: this.roomId,
        message: sanitizedMessage
      });
    }
  }

  // Broadcast media state
  broadcastMediaState() {
    if (!this.socket || !this.roomId || !this.localStream || this.isCleanedUp) return;

    try {
      const audioTrack = this.localStream.getAudioTracks()[0];
      const videoTrack = this.localStream.getVideoTracks()[0];

      const mediaState = {
        audio: audioTrack ? audioTrack.enabled : false,
        video: videoTrack ? videoTrack.enabled : false,
        screenShare: !!this.screenStream
      };

      this.socket.emit('media-state-update', {
        roomId: this.roomId,
        mediaState
      });
    } catch (error) {
      console.error('Error broadcasting media state:', error);
    }
  }

  // Handle reconnection
  handleReconnection() {
    this.reconnectAttempts++;
    console.log(`🔄 Handling reconnection, attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      this.callbacks.onError?.('Connection lost. Please refresh the page.');
      return;
    }
    
    this.callbacks.onConnectionStateChange?.('reconnecting');
  }

  // Get current media state
  getMediaState() {
    if (!this.localStream || this.isCleanedUp) {
      return { audio: false, video: false, screenShare: false };
    }

    try {
      const audioTrack = this.localStream.getAudioTracks()[0];
      const videoTrack = this.localStream.getVideoTracks()[0];

      return {
        audio: audioTrack ? audioTrack.enabled : false,
        video: videoTrack ? videoTrack.enabled : false,
        screenShare: !!this.screenStream
      };
    } catch (error) {
      console.error('Error getting media state:', error);
      return { audio: false, video: false, screenShare: false };
    }
  }

  // Set callback functions with validation
  onJoinedRoom(callback) { 
    if (typeof callback === 'function') this.callbacks.onJoinedRoom = callback; 
  }
  onUserJoined(callback) { 
    if (typeof callback === 'function') this.callbacks.onUserJoined = callback; 
  }
  onUserLeft(callback) { 
    if (typeof callback === 'function') this.callbacks.onUserLeft = callback; 
  }
  onRemoteStream(callback) { 
    if (typeof callback === 'function') this.callbacks.onRemoteStream = callback; 
  }
  onChatMessage(callback) { 
    if (typeof callback === 'function') this.callbacks.onChatMessage = callback; 
  }
  onConnectionStateChange(callback) { 
    if (typeof callback === 'function') this.callbacks.onConnectionStateChange = callback; 
  }
  onError(callback) { 
    if (typeof callback === 'function') this.callbacks.onError = callback; 
  }
  onMediaStateUpdate(callback) { 
    if (typeof callback === 'function') this.callbacks.onMediaStateUpdate = callback; 
  }
  onScreenShareStart(callback) { 
    if (typeof callback === 'function') this.callbacks.onScreenShareStart = callback; 
  }
  onScreenShareStop(callback) { 
    if (typeof callback === 'function') this.callbacks.onScreenShareStop = callback; 
  }
  onHostChanged(callback) { 
    if (typeof callback === 'function') this.callbacks.onHostChanged = callback; 
  }

  // Comprehensive cleanup
  disconnect() {
    if (this.isCleanedUp) {
      return;
    }

    console.log('🧹 Cleaning up WebRTC service...');
    this.isCleanedUp = true;
    
    // Clear timeouts and intervals
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    // Leave room
    this.leaveRoom();
    
    // Stop all media streams
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (error) {
          console.error('Error stopping track:', error);
        }
      });
      this.localStream = null;
    }
    
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (error) {
          console.error('Error stopping screen track:', error);
        }
      });
      this.screenStream = null;
    }
    
    // Close all peer connections
    this.peers.forEach((peer, peerId) => {
      this.removePeerConnection(peerId);
    });
    
    // Disconnect socket
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Clear state
    this.isConnected = false;
    this.roomId = null;
    this.reconnectAttempts = 0;
    
    // Clear callbacks to prevent memory leaks
    Object.keys(this.callbacks).forEach(key => {
      this.callbacks[key] = null;
    });
    
    console.log('✅ WebRTC service cleaned up');
  }
}

export default WebRTCService; 