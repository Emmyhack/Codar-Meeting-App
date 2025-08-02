const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Enable CORS
app.use(cors());
app.use(express.json());

// Store rooms and participants
const rooms = new Map();
const participants = new Map();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'CodarMeet Signaling Server is running',
    timestamp: new Date().toISOString(),
    connectedClients: io.engine.clientsCount,
    activeRooms: rooms.size,
    totalParticipants: participants.size
  });
});

// Get room info endpoint
app.get('/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    roomId,
    participants: Array.from(room.participants.values()),
    createdAt: room.createdAt,
    isActive: room.isActive
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send welcome message with client ID
  socket.emit('welcome', { 
    clientId: socket.id,
    timestamp: new Date().toISOString()
  });

  // Handle joining a room
  socket.on('join-room', (data) => {
    const { roomId, username, email } = data;
    
    if (!roomId || !username) {
      socket.emit('error', { message: 'Room ID and username are required' });
      return;
    }

    // Leave previous room if any
    if (socket.roomId) {
      handleLeaveRoom(socket);
    }

    // Join new room
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;
    socket.email = email;

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        participants: new Map(),
        createdAt: new Date(),
        isActive: true
      });
    }

    const room = rooms.get(roomId);
    const participant = {
      id: socket.id,
      username,
      email,
      joinedAt: new Date(),
      isHost: room.participants.size === 0
    };

    room.participants.set(socket.id, participant);
    participants.set(socket.id, { roomId, participant });

    // Notify the joining user about the room
    socket.emit('room-joined', {
      roomId,
      clientId: socket.id,
      participants: Array.from(room.participants.values()),
      isHost: participant.isHost
    });

    // Notify other participants in the room
    socket.to(roomId).emit('participant-joined', participant);

    console.log(`Client ${socket.id} (${username}) joined room ${roomId}`);
    console.log(`Room ${roomId} now has ${room.participants.size} participants`);
  });

  // Handle WebRTC signaling
  socket.on('offer', (data) => {
    const { targetId, offer } = data;
    socket.to(targetId).emit('offer', {
      from: socket.id,
      offer
    });
  });

  socket.on('answer', (data) => {
    const { targetId, answer } = data;
    socket.to(targetId).emit('answer', {
      from: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', (data) => {
    const { targetId, candidate } = data;
    socket.to(targetId).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Handle chat messages
  socket.on('chat-message', (data) => {
    const { text } = data;
    const participant = participants.get(socket.id);
    
    if (!participant) return;

    const message = {
      id: uuidv4(),
      text,
      sender: participant.participant.username,
      senderId: socket.id,
      timestamp: new Date().toISOString(),
      roomId: participant.roomId
    };

    // Broadcast to all participants in the room
    io.to(participant.roomId).emit('chat-message', message);
  });

  // Handle screen sharing
  socket.on('screen-share-started', () => {
    const participant = participants.get(socket.id);
    if (participant) {
      socket.to(participant.roomId).emit('screen-share-started', {
        from: socket.id,
        username: participant.participant.username
      });
    }
  });

  socket.on('screen-share-stopped', () => {
    const participant = participants.get(socket.id);
    if (participant) {
      socket.to(participant.roomId).emit('screen-share-stopped', {
        from: socket.id,
        username: participant.participant.username
      });
    }
  });

  // Handle recording
  socket.on('recording-started', () => {
    const participant = participants.get(socket.id);
    if (participant) {
      socket.to(participant.roomId).emit('recording-started', {
        from: socket.id,
        username: participant.participant.username
      });
    }
  });

  socket.on('recording-stopped', () => {
    const participant = participants.get(socket.id);
    if (participant) {
      socket.to(participant.roomId).emit('recording-stopped', {
        from: socket.id,
        username: participant.participant.username
      });
    }
  });

  // Handle participant actions (mute/unmute, video on/off)
  socket.on('participant-action', (data) => {
    const { action, value } = data;
    const participant = participants.get(socket.id);
    
    if (participant) {
      socket.to(participant.roomId).emit('participant-action', {
        from: socket.id,
        action,
        value,
        username: participant.participant.username
      });
    }
  });

  // Handle room management
  socket.on('leave-room', () => {
    handleLeaveRoom(socket);
  });

  socket.on('disconnect', () => {
    handleLeaveRoom(socket);
    participants.delete(socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
    socket.emit('error', { message: 'An error occurred' });
  });
});

function handleLeaveRoom(socket) {
  if (!socket.roomId) return;

  const room = rooms.get(socket.roomId);
  if (!room) return;

  const participant = room.participants.get(socket.id);
  if (!participant) return;

  // Remove participant from room
  room.participants.delete(socket.id);
  participants.delete(socket.id);

  // Notify other participants
  socket.to(socket.roomId).emit('participant-left', {
    participantId: socket.id,
    username: participant.username
  });

  // If room is empty, mark it as inactive
  if (room.participants.size === 0) {
    room.isActive = false;
    // Optionally delete the room after some time
    setTimeout(() => {
      if (rooms.has(socket.roomId) && rooms.get(socket.roomId).participants.size === 0) {
        rooms.delete(socket.roomId);
        console.log(`Room ${socket.roomId} deleted (empty)`);
      }
    }, 300000); // 5 minutes
  }

  socket.leave(socket.roomId);
  socket.roomId = null;
  socket.username = null;
  socket.email = null;

  console.log(`Client ${socket.id} left room ${socket.roomId}`);
  console.log(`Room ${socket.roomId} now has ${room.participants.size} participants`);
}

// Cleanup inactive rooms periodically
setInterval(() => {
  const now = new Date();
  for (const [roomId, room] of rooms.entries()) {
    if (!room.isActive && room.participants.size === 0) {
      const timeSinceLastActivity = now - room.createdAt;
      if (timeSinceLastActivity > 3600000) { // 1 hour
        rooms.delete(roomId);
        console.log(`Cleaned up inactive room: ${roomId}`);
      }
    }
  }
}, 300000); // Check every 5 minutes

const PORT = process.env.PORT || 3002;

server.listen(PORT, () => {
  console.log(`🚀 CodarMeet Signaling Server running on port ${PORT}`);
  console.log(`📡 Socket.IO server started`);
  console.log(`🌐 Health check: http://localhost:${PORT}/`);
  console.log(`📊 Active rooms: ${rooms.size}`);
}); 