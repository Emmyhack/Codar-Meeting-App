class WebRTCService {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.roomId = null;
    this.peers = new Map();
    this.localStream = null;
    this.onMessageCallback = null;
    this.onParticipantJoinedCallback = null;
    this.onParticipantLeftCallback = null;
    this.onOfferCallback = null;
    this.onAnswerCallback = null;
    this.onIceCandidateCallback = null;
    this.onRoomJoinedCallback = null;
  }

  connect(signalingServerUrl = 'ws://localhost:3002') {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(signalingServerUrl);
        
        this.ws.onopen = () => {
          console.log('Connected to signaling server');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleSignalingMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('Disconnected from signaling server');
          this.cleanup();
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.cleanup();
  }

  joinRoom(roomId, username, email) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to signaling server');
    }

    this.roomId = roomId;
    this.sendMessage({
      type: 'join-room',
      roomId: roomId,
      payload: {
        username: username,
        email: email
      }
    });
  }

  leaveRoom() {
    if (this.roomId) {
      this.sendMessage({
        type: 'leave-room',
        roomId: this.roomId
      });
      this.roomId = null;
    }
    
    // Close all peer connections
    for (const [peerId, peer] of this.peers.entries()) {
      peer.close();
    }
    this.peers.clear();
  }

  async createPeerConnection(targetId) {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
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
        this.sendMessage({
          type: 'ice-candidate',
          roomId: this.roomId,
          payload: {
            targetId: targetId,
            candidate: event.candidate
          }
        });
      }
    };

    // Handle incoming streams
    peer.ontrack = (event) => {
      if (this.onIceCandidateCallback) {
        this.onIceCandidateCallback(targetId, event.streams[0]);
      }
    };

    this.peers.set(targetId, peer);
    return peer;
  }

  async createOffer(targetId) {
    const peer = await this.createPeerConnection(targetId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    this.sendMessage({
      type: 'offer',
      roomId: this.roomId,
      payload: {
        targetId: targetId,
        offer: offer
      }
    });

    return peer;
  }

  async handleOffer(fromId, offer) {
    const peer = await this.createPeerConnection(fromId);
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    this.sendMessage({
      type: 'answer',
      roomId: this.roomId,
      payload: {
        targetId: fromId,
        answer: answer
      }
    });
  }

  async handleAnswer(fromId, answer) {
    const peer = this.peers.get(fromId);
    if (peer) {
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async handleIceCandidate(fromId, candidate) {
    const peer = this.peers.get(fromId);
    if (peer) {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  sendChatMessage(text) {
    this.sendMessage({
      type: 'chat-message',
      roomId: this.roomId,
      payload: {
        text: text
      }
    });
  }

  setLocalStream(stream) {
    this.localStream = stream;
    
    // Update existing peer connections
    for (const [peerId, peer] of this.peers.entries()) {
      const senders = peer.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            sender.replaceTrack(videoTrack);
          }
        }
        if (sender.track && sender.track.kind === 'audio') {
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            sender.replaceTrack(audioTrack);
          }
        }
      });
    }
  }

  handleSignalingMessage(data) {
    const { type, roomId, from, payload } = data;

    switch (type) {
      case 'client-id':
        this.clientId = payload.clientId;
        console.log('Received client ID:', this.clientId);
        break;

      case 'room-joined':
        console.log('Joined room:', roomId);
        if (this.onRoomJoinedCallback) {
          this.onRoomJoinedCallback(payload);
        }
        break;

      case 'participant-joined':
        console.log('Participant joined:', payload);
        if (this.onParticipantJoinedCallback) {
          this.onParticipantJoinedCallback(payload);
        }
        // Create offer for new participant
        if (payload.id !== this.clientId) {
          this.createOffer(payload.id);
        }
        break;

      case 'participant-left':
        console.log('Participant left:', payload);
        const peer = this.peers.get(payload.participantId);
        if (peer) {
          peer.close();
          this.peers.delete(payload.participantId);
        }
        if (this.onParticipantLeftCallback) {
          this.onParticipantLeftCallback(payload.participantId);
        }
        break;

      case 'offer':
        console.log('Received offer from:', from);
        this.handleOffer(from, payload.offer);
        break;

      case 'answer':
        console.log('Received answer from:', from);
        this.handleAnswer(from, payload.answer);
        break;

      case 'ice-candidate':
        console.log('Received ICE candidate from:', from);
        this.handleIceCandidate(from, payload.candidate);
        break;

      case 'chat-message':
        console.log('Received chat message:', payload);
        if (this.onMessageCallback) {
          this.onMessageCallback(payload.message);
        }
        break;

      default:
        console.log('Unknown message type:', type);
    }
  }

  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  cleanup() {
    this.ws = null;
    this.clientId = null;
    this.roomId = null;
    
    for (const [peerId, peer] of this.peers.entries()) {
      peer.close();
    }
    this.peers.clear();
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

  onRoomJoined(callback) {
    this.onRoomJoinedCallback = callback;
  }

  onTrack(callback) {
    this.onIceCandidateCallback = callback;
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
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export default WebRTCService; 