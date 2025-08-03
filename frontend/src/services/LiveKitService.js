import { Room, RoomEvent, RemoteParticipant, LocalParticipant, DataPacket_Kind, Track } from 'livekit-client';

class LiveKitService {
  constructor() {
    this.room = null;
    this.localParticipant = null;
    this.remoteParticipants = new Map();
    this.isConnected = false;
    
    // Callbacks
    this.onParticipantJoinedCallback = null;
    this.onParticipantLeftCallback = null;
    this.onTrackCallback = null;
    this.onMessageCallback = null;
    this.onHandRaiseCallback = null;
    this.onRoomJoinedCallback = null;
    this.onTrackMutedCallback = null;
    this.onTrackUnmutedCallback = null;
  }

  async connect(url = 'wss://livekit-server.example.com', token = null) {
    try {
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
          videoSimulcastLayers: [
            { width: 320, height: 180, fps: 15 },
            { width: 640, height: 360, fps: 30 },
            { width: 1280, height: 720, fps: 30 },
          ],
        },
        subscribeDefaults: {
          video: true,
          audio: true,
        },
      });

      // Set up event listeners
      this.setupEventListeners();
      
      // Connect to the room
      if (token) {
        await this.room.connect(url, token, {
          autoSubscribe: true,
        });
      } else {
        // For demo purposes, we'll use a mock connection
        console.log('LiveKit: Mock connection for demo');
        this.isConnected = true;
        this.localParticipant = {
          identity: 'Local User',
          sid: 'local',
          isLocal: true,
          publishTrack: (track, options) => {
            console.log('Publishing track:', track.kind, options);
            return Promise.resolve();
          },
          publishData: (data, options) => {
            console.log('Publishing data:', data);
            return Promise.resolve();
          },
          setTrackEnabled: (track, enabled) => {
            console.log('Setting track enabled:', track.kind, enabled);
          }
        };
      }

      console.log('Connected to LiveKit room');
      return true;
    } catch (error) {
      console.error('Failed to connect to LiveKit:', error);
      throw error;
    }
  }

  setupEventListeners() {
    if (!this.room) return;

    // Participant joined
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('Participant joined:', participant.identity);
      
      if (this.onParticipantJoinedCallback) {
        this.onParticipantJoinedCallback({
          id: participant.sid,
          name: participant.identity,
          email: participant.metadata || '',
          isLocal: false
        });
      }
    });

    // Participant left
    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('Participant left:', participant.identity);
      
      if (this.onParticipantLeftCallback) {
        this.onParticipantLeftCallback(participant.sid);
      }
    });

    // Track subscribed
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log('Track subscribed:', track.kind, 'from', participant.identity);
      
      if (this.onTrackCallback) {
        // Create a MediaStream from the track
        const stream = new MediaStream([track.mediaStreamTrack]);
        this.onTrackCallback(participant.sid, stream);
      }
    });

    // Track unsubscribed
    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log('Track unsubscribed:', track.kind, 'from', participant.identity);
    });

    // Data received
    this.room.on(RoomEvent.DataReceived, (payload, participant) => {
      console.log('Data received from:', participant.identity);
      
      try {
        const data = JSON.parse(new TextDecoder().decode(payload.data));
        
        if (data.type === 'chat') {
          if (this.onMessageCallback) {
            this.onMessageCallback({
              id: Date.now(),
              text: data.message,
              sender: participant.identity,
              timestamp: new Date().toISOString()
            });
          }
        } else if (data.type === 'hand-raise') {
          if (this.onHandRaiseCallback) {
            this.onHandRaiseCallback(participant.sid, data.raised);
          }
        }
      } catch (error) {
        console.error('Error parsing data message:', error);
      }
    });

    // Room joined
    this.room.on(RoomEvent.Connected, () => {
      console.log('Room connected');
      
      if (this.onRoomJoinedCallback) {
        const participants = Array.from(this.room.participants.values()).map(p => ({
          id: p.sid,
          name: p.identity,
          email: p.metadata || '',
          isLocal: false
        }));
        
        this.onRoomJoinedCallback({
          participants,
          messages: []
        });
      }
    });

    // Track muted/unmuted
    this.room.on(RoomEvent.TrackMuted, (track, participant) => {
      console.log('Track muted:', track.kind, 'from', participant.identity);
      if (this.onTrackMutedCallback) {
        this.onTrackMutedCallback(participant.sid, track.kind);
      }
    });

    this.room.on(RoomEvent.TrackUnmuted, (track, participant) => {
      console.log('Track unmuted:', track.kind, 'from', participant.identity);
      if (this.onTrackUnmutedCallback) {
        this.onTrackUnmutedCallback(participant.sid, track.kind);
      }
    });
  }

  async joinRoom(roomName, username, email) {
    if (!this.room && !this.localParticipant) {
      throw new Error('Not connected to LiveKit');
    }

    try {
      if (this.localParticipant) {
        // For demo purposes, simulate joining
        console.log('Joined room:', roomName);
        return true;
      }

      // Set local participant metadata
      this.localParticipant.setMetadata(JSON.stringify({
        email: email,
        username: username
      }));

      console.log('Joined room:', roomName);
      return true;
    } catch (error) {
      console.error('Failed to join room:', error);
      throw error;
    }
  }

  setLocalStream(stream) {
    if (!this.localParticipant) return;

    // Publish audio and video tracks
    stream.getTracks().forEach(track => {
      if (track.kind === 'audio') {
        this.localParticipant.publishTrack(track, {
          name: 'audio',
          source: 'microphone'
        });
      } else if (track.kind === 'video') {
        this.localParticipant.publishTrack(track, {
          name: 'camera',
          source: 'camera'
        });
      }
    });
  }

  async publishScreenShare(stream) {
    if (!this.localParticipant) return;

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      await this.localParticipant.publishTrack(videoTrack, {
        name: 'screen-share',
        source: 'screen-share'
      });
    }
  }

  async stopScreenShare() {
    if (!this.localParticipant) return;

    if (this.room) {
      const publications = this.localParticipant.getTrackPublications();
      for (const pub of publications) {
        if (pub.source === 'screen-share') {
          await pub.unpublish();
        }
      }
    }
  }

  sendChatMessage(message) {
    if (!this.localParticipant) return;

    const data = {
      type: 'chat',
      message: message,
      timestamp: new Date().toISOString()
    };

    this.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(data)),
      DataPacket_Kind.RELIABLE
    );
  }

  toggleHandRaise(raised) {
    if (!this.localParticipant) return;

    const data = {
      type: 'hand-raise',
      raised: raised,
      timestamp: new Date().toISOString()
    };

    this.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(data)),
      DataPacket_Kind.RELIABLE
    );
  }

  async leaveRoom() {
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
      this.localParticipant = null;
      this.remoteParticipants.clear();
      this.isConnected = false;
    } else {
      // For demo purposes
      this.isConnected = false;
      this.localParticipant = null;
    }
  }

  disconnect() {
    this.leaveRoom();
  }

  // Callback setters
  onParticipantJoined(callback) {
    this.onParticipantJoinedCallback = callback;
  }

  onParticipantLeft(callback) {
    this.onParticipantLeftCallback = callback;
  }

  onTrack(callback) {
    this.onTrackCallback = callback;
  }

  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onHandRaise(callback) {
    this.onHandRaiseCallback = callback;
  }

  onRoomJoined(callback) {
    this.onRoomJoinedCallback = callback;
  }

  onTrackMuted(callback) {
    this.onTrackMutedCallback = callback;
  }

  onTrackUnmuted(callback) {
    this.onTrackUnmutedCallback = callback;
  }

  // Getters
  getLocalParticipant() {
    return this.localParticipant;
  }

  getRemoteParticipants() {
    return this.remoteParticipants;
  }

  isConnected() {
    return this.isConnected;
  }

  getRoom() {
    return this.room;
  }
}

export default LiveKitService;