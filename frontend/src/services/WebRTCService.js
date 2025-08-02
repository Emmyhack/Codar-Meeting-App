import { io } from 'socket.io-client';

class WebRTCService {
  constructor() {
    this.socket = null;
    this.clientId = null;
    this.roomId = null;
    this.username = null;
    this.email = null;
    this.peers = new Map();
    this.localStream = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    
    // Callbacks
    this.onMessageCallback = null;
    this.onParticipantJoinedCallback = null;
    this.onParticipantLeftCallback = null;
    this.onTrackCallback = null;
    this.onRoomJoinedCallback = null;
    this.onConnectionStateChangeCallback = null;
    this.onErrorCallback = null;
    
    // ICE servers for production
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
  }

  async connect(signalingServerUrl = 'http://localhost:3002') {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(signalingServerUrl, {
          transports: ['websocket', 'polling'],
          timeout: 20000,
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: this.reconnectDelay,
          reconnectionDelayMax: 5000,
          maxReconnectionAttempts: this.maxReconnectAttempts
        });

        this.socket.on('connect', () => {
          console.log('Connected to signaling server');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.onConnectionStateChangeCallback?.('connected');
          resolve();
        });

        this.socket.on('disconnect', (reason) => {
          console.log('Disconnected from signaling server:', reason);
          this.isConnected = false;
          this.onConnectionStateChangeCallback?.('disconnected');
          
          if (reason === 'io server disconnect') {
            // Server disconnected us, try to reconnect
            this.socket.connect();
          }
        });

        this.socket.on('connect_error', (error) => {
          console.error('Connection error:', error);
          this.reconnectAttempts++;
          this.onErrorCallback?.(error);
          
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            reject(new Error('Failed to connect after maximum attempts'));
          }
        });

        this.socket.on('welcome', (data) => {
          this.clientId = data.clientId;
          console.log('Received client ID:', this.clientId);
        });

        this.socket.on('room-joined', (data) => {
          console.log('Joined room:', data);
          this.roomId = data.roomId;
          this.onRoomJoinedCallback?.(data);
        });

        this.socket.on('participant-joined', (participant) => {
          console.log('Participant joined:', participant);
          this.onParticipantJoinedCallback?.(participant);
          
          // Create peer connection for new participant
          if (participant.id !== this.clientId) {
            this.createPeerConnection(participant.id);
          }
        });

        this.socket.on('participant-left', (data) => {
          console.log('Participant left:', data);
          this.removePeerConnection(data.participantId);
          this.onParticipantLeftCallback?.(data.participantId);
        });

        this.socket.on('offer', async (data) => {
          console.log('Received offer from:', data.from);
          await this.handleOffer(data.from, data.offer);
        });

        this.socket.on('answer', async (data) => {
          console.log('Received answer from:', data.from);
          await this.handleAnswer(data.from, data.answer);
        });

        this.socket.on('ice-candidate', async (data) => {
          console.log('Received ICE candidate from:', data.from);
          await this.handleIceCandidate(data.from, data.candidate);
        });

        this.socket.on('chat-message', (message) => {
          console.log('Received chat message:', message);
          this.onMessageCallback?.(message);
        });

        this.socket.on('screen-share-started', (data) => {
          console.log('Screen share started by:', data.username);
        });

        this.socket.on('screen-share-stopped', (data) => {
          console.log('Screen share stopped by:', data.username);
        });

        this.socket.on('recording-started', (data) => {
          console.log('Recording started by:', data.username);
        });

        this.socket.on('recording-stopped', (data) => {
          console.log('Recording stopped by:', data.username);
        });

        this.socket.on('participant-action', (data) => {
          console.log('Participant action:', data);
        });

        this.socket.on('error', (error) => {
          console.error('Signaling server error:', error);
          this.onErrorCallback?.(error);
        });

      } catch (error) {
        console.error('Error connecting to signaling server:', error);
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.cleanup();
  }

  joinRoom(roomId, username, email) {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Not connected to signaling server');
    }

    this.roomId = roomId;
    this.username = username;
    this.email = email;

    this.socket.emit('join-room', {
      roomId,
      username,
      email
    });
  }

  leaveRoom() {
    if (this.socket && this.roomId) {
      this.socket.emit('leave-room');
    }
    this.cleanup();
  }

  async createPeerConnection(targetId) {
    try {
      const peer = new RTCPeerConnection({
        iceServers: this.iceServers,
        iceCandidatePoolSize: 10
      });

      // Add local stream tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          peer.addTrack(track, this.localStream);
        });
      }

      // Handle ICE candidates
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('ice-candidate', {
            targetId,
            candidate: event.candidate
          });
        }
      };

      // Handle connection state changes
      peer.onconnectionstatechange = () => {
        console.log(`Peer connection state for ${targetId}:`, peer.connectionState);
        
        if (peer.connectionState === 'failed') {
          // Try to restart ICE
          peer.restartIce();
        }
      };

      // Handle ICE connection state changes
      peer.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${targetId}:`, peer.iceConnectionState);
      };

      // Handle incoming streams
      peer.ontrack = (event) => {
        console.log('Received track from:', targetId);
        if (this.onTrackCallback) {
          this.onTrackCallback(targetId, event.streams[0]);
        }
      };

      this.peers.set(targetId, peer);
      return peer;
    } catch (error) {
      console.error('Error creating peer connection:', error);
      throw error;
    }
  }

  async createOffer(targetId) {
    try {
      const peer = await this.createPeerConnection(targetId);
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await peer.setLocalDescription(offer);

      this.socket.emit('offer', {
        targetId,
        offer
      });

      return peer;
    } catch (error) {
      console.error('Error creating offer:', error);
      throw error;
    }
  }

  async handleOffer(fromId, offer) {
    try {
      const peer = await this.createPeerConnection(fromId);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      this.socket.emit('answer', {
        targetId: fromId,
        answer
      });
    } catch (error) {
      console.error('Error handling offer:', error);
      throw error;
    }
  }

  async handleAnswer(fromId, answer) {
    try {
      const peer = this.peers.get(fromId);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (error) {
      console.error('Error handling answer:', error);
      throw error;
    }
  }

  async handleIceCandidate(fromId, candidate) {
    try {
      const peer = this.peers.get(fromId);
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
      throw error;
    }
  }

  sendChatMessage(text) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('chat-message', { text });
    }
  }

  setLocalStream(stream) {
    this.localStream = stream;
    
    // Update existing peer connections with new stream
    for (const [peerId, peer] of this.peers.entries()) {
      const senders = peer.getSenders();
      senders.forEach(sender => {
        if (sender.track) {
          const newTrack = stream.getTracks().find(track => track.kind === sender.track.kind);
          if (newTrack) {
            sender.replaceTrack(newTrack);
          }
        }
      });
    }
  }

  removePeerConnection(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
    }
  }

  cleanup() {
    // Close all peer connections
    for (const [peerId, peer] of this.peers.entries()) {
      peer.close();
    }
    this.peers.clear();
    
    // Reset state
    this.clientId = null;
    this.roomId = null;
    this.username = null;
    this.email = null;
    this.localStream = null;
    this.isConnected = false;
  }

  // Callback setters
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onParticipantJoined(callback) {
    this.onParticipantJoinedCallback = callback;
  }

  onParticipantLeft(callback) {
    this.onParticipantLeftCallback = callback;
  }

  onTrack(callback) {
    this.onTrackCallback = callback;
  }

  onRoomJoined(callback) {
    this.onRoomJoinedCallback = callback;
  }

  onConnectionStateChange(callback) {
    this.onConnectionStateChangeCallback = callback;
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }

  // Getters
  getClientId() {
    return this.clientId;
  }

  getRoomId() {
    return this.roomId;
  }

  getPeers() {
    return this.peers;
  }

  isConnected() {
    return this.socket && this.socket.connected;
  }

  // Utility methods
  getConnectionStats() {
    const stats = {
      connected: this.isConnected(),
      roomId: this.roomId,
      clientId: this.clientId,
      peerCount: this.peers.size,
      reconnectAttempts: this.reconnectAttempts
    };

    // Get peer connection stats
    const peerStats = [];
    for (const [peerId, peer] of this.peers.entries()) {
      peerStats.push({
        peerId,
        connectionState: peer.connectionState,
        iceConnectionState: peer.iceConnectionState,
        iceGatheringState: peer.iceGatheringState
      });
    }
    stats.peers = peerStats;

    return stats;
  }
}

export default WebRTCService; 