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
    
    // ICE servers configuration (including free STUN servers)
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
    
    // Media constraints
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
  }

  // Initialize connection to signaling server
  async connect(serverUrl = 'http://localhost:3002') {
    try {
      console.log('🔌 Connecting to signaling server...');
      
      this.socket = io(serverUrl, {
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectInterval,
        timeout: 10000,
        forceNew: true
      });

      await new Promise((resolve, reject) => {
        // Connection established
        this.socket.on('connect', () => {
          console.log('✅ Connected to signaling server:', this.socket.id);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.callbacks.onConnectionStateChange?.('connected');
          resolve();
        });

        // Connection error
        this.socket.on('connect_error', (error) => {
          console.error('❌ Connection error:', error);
          this.isConnected = false;
          this.callbacks.onConnectionStateChange?.('error');
          this.callbacks.onError?.(`Connection failed: ${error.message}`);
          reject(error);
        });

        // Disconnect
        this.socket.on('disconnect', (reason) => {
          console.log('❌ Disconnected:', reason);
          this.isConnected = false;
          this.callbacks.onConnectionStateChange?.('disconnected');
          
          if (reason === 'io server disconnect') {
            // Server disconnected, try to reconnect
            this.handleReconnection();
          }
        });

        // Reconnection attempt
        this.socket.on('reconnect_attempt', (attemptNumber) => {
          console.log(`🔄 Reconnection attempt ${attemptNumber}/${this.maxReconnectAttempts}`);
          this.callbacks.onConnectionStateChange?.('reconnecting');
        });

        // Reconnection successful
        this.socket.on('reconnect', () => {
          console.log('✅ Reconnected successfully');
          this.isConnected = true;
          this.callbacks.onConnectionStateChange?.('connected');
          
          // Rejoin room if we were in one
          if (this.roomId) {
            this.rejoinRoom();
          }
        });

        // Reconnection failed
        this.socket.on('reconnect_failed', () => {
          console.error('❌ Reconnection failed');
          this.callbacks.onConnectionStateChange?.('failed');
          this.callbacks.onError?.('Failed to reconnect to server');
        });

        // Set up signaling message handlers
        this.setupSignalingHandlers();
        
        // Timeout fallback
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      });

    } catch (error) {
      console.error('❌ Failed to connect:', error);
      this.callbacks.onError?.(`Failed to connect: ${error.message}`);
      throw error;
    }
  }

  // Set up all signaling message handlers
  setupSignalingHandlers() {
    // Successfully joined room
    this.socket.on('joined-room', (data) => {
      console.log('✅ Joined room:', data);
      this.roomId = data.roomId;
      this.callbacks.onJoinedRoom?.(data);
      
      // Initiate connections to existing participants
      data.existingParticipants?.forEach(participant => {
        this.createPeerConnection(participant.id, true); // true = create offer
      });
    });

    // New user joined
    this.socket.on('user-joined', (data) => {
      console.log('👤 User joined:', data);
      this.callbacks.onUserJoined?.(data);
      
      // Create peer connection but don't create offer (wait for their offer)
      this.createPeerConnection(data.participant.id, false);
    });

    // User left
    this.socket.on('user-left', (data) => {
      console.log('👋 User left:', data);
      this.callbacks.onUserLeft?.(data);
      this.removePeerConnection(data.participantId);
    });

    // WebRTC offer received
    this.socket.on('offer', async (data) => {
      console.log('📞 Received offer from:', data.fromId);
      await this.handleOffer(data);
    });

    // WebRTC answer received
    this.socket.on('answer', async (data) => {
      console.log('📱 Received answer from:', data.fromId);
      await this.handleAnswer(data);
    });

    // ICE candidate received
    this.socket.on('ice-candidate', async (data) => {
      await this.handleIceCandidate(data);
    });

    // Chat message received
    this.socket.on('chat-message', (data) => {
      console.log('💬 Chat message:', data);
      this.callbacks.onChatMessage?.(data);
    });

    // Media state update
    this.socket.on('participant-media-update', (data) => {
      console.log('🎤📹 Media state update:', data);
      this.callbacks.onMediaStateUpdate?.(data);
    });

    // Screen share events
    this.socket.on('participant-screen-share-start', (data) => {
      console.log('🖥️ Screen share started:', data);
      this.callbacks.onScreenShareStart?.(data);
    });

    this.socket.on('participant-screen-share-stop', (data) => {
      console.log('🖥️ Screen share stopped:', data);
      this.callbacks.onScreenShareStop?.(data);
    });

    // Host changed
    this.socket.on('host-changed', (data) => {
      console.log('👑 Host changed:', data);
      this.callbacks.onHostChanged?.(data);
    });

    // Join error
    this.socket.on('join-error', (data) => {
      console.error('❌ Join error:', data);
      this.callbacks.onError?.(data.error);
    });
  }

  // Join a room
  async joinRoom(roomId, userInfo = {}) {
    if (!this.isConnected) {
      throw new Error('Not connected to signaling server');
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
    if (this.roomId) {
      console.log('🔄 Rejoining room after reconnection:', this.roomId);
      await this.joinRoom(this.roomId);
    }
  }

  // Leave current room
  leaveRoom() {
    if (this.socket && this.roomId) {
      console.log('👋 Leaving room:', this.roomId);
      this.socket.emit('leave-room');
      
      // Close all peer connections
      this.peers.forEach((peer, peerId) => {
        peer.close();
      });
      this.peers.clear();
      
      this.roomId = null;
    }
  }

  // Initialize local media
  async initializeMedia(constraints = this.mediaConstraints) {
    try {
      console.log('🎥 Initializing media with constraints:', constraints);
      
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('✅ Local media initialized:', {
        videoTracks: this.localStream.getVideoTracks().length,
        audioTracks: this.localStream.getAudioTracks().length
      });

      // Add tracks to existing peer connections
      this.peers.forEach((peer) => {
        this.localStream.getTracks().forEach(track => {
          const sender = peer.getSenders().find(s => s.track?.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            peer.addTrack(track, this.localStream);
          }
        });
      });

      return this.localStream;
    } catch (error) {
      console.error('❌ Failed to initialize media:', error);
      this.callbacks.onError?.(`Failed to access camera/microphone: ${error.message}`);
      throw error;
    }
  }

  // Create peer connection
  async createPeerConnection(peerId, shouldCreateOffer = false) {
    try {
      console.log(`🔗 Creating peer connection with ${peerId}, shouldCreateOffer: ${shouldCreateOffer}`);
      
      const peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers
      });

      // Add local stream tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.localStream);
        });
      }

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.socket) {
          this.socket.emit('ice-candidate', {
            targetId: peerId,
            candidate: event.candidate,
            roomId: this.roomId
          });
        }
      };

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('📺 Received remote stream from:', peerId);
        const remoteStream = event.streams[0];
        this.callbacks.onRemoteStream?.(peerId, remoteStream);
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log(`🔗 Connection state with ${peerId}:`, peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'failed') {
          console.log(`🔄 Peer connection failed with ${peerId}, attempting to restart ICE`);
          peerConnection.restartIce();
        }
        
        if (peerConnection.connectionState === 'disconnected') {
          console.log(`❌ Peer disconnected: ${peerId}`);
          // Don't automatically remove - might reconnect
        }
        
        if (peerConnection.connectionState === 'closed') {
          console.log(`🚫 Peer connection closed: ${peerId}`);
          this.removePeerConnection(peerId);
        }
      };

      // Handle ICE connection state changes
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`🧊 ICE connection state with ${peerId}:`, peerConnection.iceConnectionState);
      };

      this.peers.set(peerId, peerConnection);

      // Create offer if we should
      if (shouldCreateOffer) {
        await this.createOffer(peerId);
      }

      return peerConnection;
    } catch (error) {
      console.error(`❌ Failed to create peer connection with ${peerId}:`, error);
      this.callbacks.onError?.(`Failed to connect to participant: ${error.message}`);
      throw error;
    }
  }

  // Create and send offer
  async createOffer(peerId) {
    try {
      const peerConnection = this.peers.get(peerId);
      if (!peerConnection) {
        throw new Error(`No peer connection found for ${peerId}`);
      }

      console.log(`📞 Creating offer for ${peerId}`);
      
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnection.setLocalDescription(offer);

      this.socket.emit('offer', {
        targetId: peerId,
        offer: offer,
        roomId: this.roomId
      });

      console.log(`📞 Offer sent to ${peerId}`);
    } catch (error) {
      console.error(`❌ Failed to create offer for ${peerId}:`, error);
      this.callbacks.onError?.(`Failed to create offer: ${error.message}`);
    }
  }

  // Handle incoming offer
  async handleOffer(data) {
    try {
      const { fromId, offer } = data;
      console.log(`📞 Handling offer from ${fromId}`);

      let peerConnection = this.peers.get(fromId);
      if (!peerConnection) {
        peerConnection = await this.createPeerConnection(fromId, false);
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.socket.emit('answer', {
        targetId: fromId,
        answer: answer,
        roomId: this.roomId
      });

      console.log(`📱 Answer sent to ${fromId}`);
    } catch (error) {
      console.error(`❌ Failed to handle offer from ${data.fromId}:`, error);
      this.callbacks.onError?.(`Failed to handle offer: ${error.message}`);
    }
  }

  // Handle incoming answer
  async handleAnswer(data) {
    try {
      const { fromId, answer } = data;
      console.log(`📱 Handling answer from ${fromId}`);

      const peerConnection = this.peers.get(fromId);
      if (!peerConnection) {
        console.error(`❌ No peer connection found for ${fromId}`);
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
    try {
      const { fromId, candidate } = data;
      const peerConnection = this.peers.get(fromId);
      
      if (peerConnection && candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error(`❌ Failed to handle ICE candidate from ${data.fromId}:`, error);
    }
  }

  // Remove peer connection
  removePeerConnection(peerId) {
    const peerConnection = this.peers.get(peerId);
    if (peerConnection) {
      peerConnection.close();
      this.peers.delete(peerId);
      console.log(`🗑️ Removed peer connection: ${peerId}`);
    }
  }

  // Toggle audio
  toggleAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        this.broadcastMediaState();
        return audioTrack.enabled;
      }
    }
    return false;
  }

  // Toggle video
  toggleVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        this.broadcastMediaState();
        return videoTrack.enabled;
      }
    }
    return false;
  }

  // Start screen sharing
  async startScreenShare() {
    try {
      console.log('🖥️ Starting screen share...');
      
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          cursor: 'always',
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: true
      });

      // Replace video track in all peer connections
      const videoTrack = this.screenStream.getVideoTracks()[0];
      this.peers.forEach((peer) => {
        const sender = peer.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });

      // Handle screen share end
      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      this.socket.emit('start-screen-share', { roomId: this.roomId });
      
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
    try {
      console.log('🖥️ Stopping screen share...');
      
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(track => track.stop());
        this.screenStream = null;
      }

      // Replace back to camera video
      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        this.peers.forEach((peer) => {
          const sender = peer.getSenders().find(s => s.track?.kind === 'video');
          if (sender && videoTrack) {
            sender.replaceTrack(videoTrack);
          }
        });
      }

      this.socket.emit('stop-screen-share', { roomId: this.roomId });
      
      console.log('✅ Screen share stopped');
    } catch (error) {
      console.error('❌ Failed to stop screen share:', error);
      this.callbacks.onError?.(`Failed to stop screen share: ${error.message}`);
    }
  }

  // Send chat message
  sendChatMessage(message) {
    if (this.socket && this.roomId) {
      this.socket.emit('chat-message', {
        roomId: this.roomId,
        message
      });
    }
  }

  // Broadcast media state
  broadcastMediaState() {
    if (!this.socket || !this.roomId || !this.localStream) return;

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
    if (!this.localStream) {
      return { audio: false, video: false, screenShare: false };
    }

    const audioTrack = this.localStream.getAudioTracks()[0];
    const videoTrack = this.localStream.getVideoTracks()[0];

    return {
      audio: audioTrack ? audioTrack.enabled : false,
      video: videoTrack ? videoTrack.enabled : false,
      screenShare: !!this.screenStream
    };
  }

  // Set callback functions
  onJoinedRoom(callback) { this.callbacks.onJoinedRoom = callback; }
  onUserJoined(callback) { this.callbacks.onUserJoined = callback; }
  onUserLeft(callback) { this.callbacks.onUserLeft = callback; }
  onRemoteStream(callback) { this.callbacks.onRemoteStream = callback; }
  onChatMessage(callback) { this.callbacks.onChatMessage = callback; }
  onConnectionStateChange(callback) { this.callbacks.onConnectionStateChange = callback; }
  onError(callback) { this.callbacks.onError = callback; }
  onMediaStateUpdate(callback) { this.callbacks.onMediaStateUpdate = callback; }
  onScreenShareStart(callback) { this.callbacks.onScreenShareStart = callback; }
  onScreenShareStop(callback) { this.callbacks.onScreenShareStop = callback; }
  onHostChanged(callback) { this.callbacks.onHostChanged = callback; }

  // Cleanup
  disconnect() {
    console.log('🧹 Cleaning up WebRTC service...');
    
    this.leaveRoom();
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.isConnected = false;
    this.roomId = null;
    
    console.log('✅ WebRTC service cleaned up');
  }
}

export default WebRTCService; 