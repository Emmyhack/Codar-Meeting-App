const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Enable CORS for HTTP endpoints
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));
app.use(express.json());

// Store room and user data
const rooms = new Map();
const users = new Map();

// Health check endpoint
app.get('/', (req, res) => {
  const roomsInfo = Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    participants: room.participants.length,
    host: room.host
  }));
  
  res.json({ 
    message: 'CodarMeet Signaling Server is running',
    timestamp: new Date().toISOString(),
    connectedUsers: users.size,
    activeRooms: rooms.size,
    rooms: roomsInfo
  });
});

// Get room info endpoint
app.get('/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.json({ exists: false });
  }
  
  res.json({
    exists: true,
    roomId: room.id,
    participants: room.participants.length,
    maxParticipants: room.maxParticipants,
    createdAt: room.createdAt,
    host: room.host
  });
});

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  
  // Store user connection
  users.set(socket.id, {
    id: socket.id,
    connectedAt: new Date(),
    currentRoom: null
  });

  // Handle joining a room
  socket.on('join-room', (data) => {
    try {
      const { roomId, userInfo } = data;
      console.log(`🚪 User ${socket.id} attempting to join room: ${roomId}`);
      
      // Leave any previous room
      leaveCurrentRoom(socket);
      
      // Create room if it doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          participants: [],
          host: socket.id,
          createdAt: new Date(),
          maxParticipants: 50 // Google Meet like limit
        });
        console.log(`🏠 Created new room: ${roomId}`);
      }
      
      const room = rooms.get(roomId);
      
      // Check room capacity
      if (room.participants.length >= room.maxParticipants) {
        socket.emit('join-error', { 
          error: 'Room is full',
          code: 'ROOM_FULL'
        });
        return;
      }
      
      // Add user to room
      const participant = {
        id: socket.id,
        userInfo: userInfo || { name: `User ${socket.id.substring(0, 6)}` },
        joinedAt: new Date(),
        isHost: room.participants.length === 0
      };
      
      room.participants.push(participant);
      socket.join(roomId);
      
      // Update user's current room
      users.get(socket.id).currentRoom = roomId;
      
      // Notify user of successful join
      socket.emit('joined-room', {
        roomId,
        participant,
        room: {
          id: room.id,
          host: room.host,
          participantCount: room.participants.length
        },
        existingParticipants: room.participants.filter(p => p.id !== socket.id)
      });
      
      // Notify other participants
      socket.to(roomId).emit('user-joined', {
        participant,
        roomId,
        totalParticipants: room.participants.length
      });
      
      console.log(`✅ User ${socket.id} joined room ${roomId}. Room now has ${room.participants.length} participants`);
      
    } catch (error) {
      console.error('❌ Error joining room:', error);
      socket.emit('join-error', { 
        error: 'Failed to join room',
        code: 'JOIN_FAILED'
      });
    }
  });

  // Handle WebRTC offer
  socket.on('offer', (data) => {
    try {
      const { targetId, offer, roomId } = data;
      console.log(`📞 Forwarding offer from ${socket.id} to ${targetId} in room ${roomId}`);
      
      socket.to(targetId).emit('offer', {
        fromId: socket.id,
        offer,
        roomId
      });
    } catch (error) {
      console.error('❌ Error handling offer:', error);
    }
  });

  // Handle WebRTC answer
  socket.on('answer', (data) => {
    try {
      const { targetId, answer, roomId } = data;
      console.log(`📱 Forwarding answer from ${socket.id} to ${targetId} in room ${roomId}`);
      
      socket.to(targetId).emit('answer', {
        fromId: socket.id,
        answer,
        roomId
      });
    } catch (error) {
      console.error('❌ Error handling answer:', error);
    }
  });

  // Handle ICE candidates
  socket.on('ice-candidate', (data) => {
    try {
      const { targetId, candidate, roomId } = data;
      
      socket.to(targetId).emit('ice-candidate', {
        fromId: socket.id,
        candidate,
        roomId
      });
    } catch (error) {
      console.error('❌ Error handling ICE candidate:', error);
    }
  });

  // Handle media state updates (mute/unmute, video on/off)
  socket.on('media-state-update', (data) => {
    try {
      const { roomId, mediaState } = data;
      const user = users.get(socket.id);
      
      if (user && user.currentRoom === roomId) {
        socket.to(roomId).emit('participant-media-update', {
          participantId: socket.id,
          mediaState
        });
        console.log(`🎤📹 Media state update from ${socket.id}:`, mediaState);
      }
    } catch (error) {
      console.error('❌ Error handling media state update:', error);
    }
  });

  // Handle chat messages
  socket.on('chat-message', (data) => {
    try {
      const { roomId, message } = data;
      const user = users.get(socket.id);
      
      if (user && user.currentRoom === roomId) {
        const chatMessage = {
          id: uuidv4(),
          message,
          fromId: socket.id,
          timestamp: new Date(),
          type: 'text'
        };
        
        // Broadcast to all participants in the room
        io.to(roomId).emit('chat-message', chatMessage);
        console.log(`💬 Chat message in room ${roomId} from ${socket.id}`);
      }
    } catch (error) {
      console.error('❌ Error handling chat message:', error);
    }
  });

  // Handle screen share start
  socket.on('start-screen-share', (data) => {
    try {
      const { roomId } = data;
      const user = users.get(socket.id);
      
      if (user && user.currentRoom === roomId) {
        socket.to(roomId).emit('participant-screen-share-start', {
          participantId: socket.id
        });
        console.log(`🖥️ Screen share started by ${socket.id} in room ${roomId}`);
      }
    } catch (error) {
      console.error('❌ Error handling screen share start:', error);
    }
  });

  // Handle screen share stop
  socket.on('stop-screen-share', (data) => {
    try {
      const { roomId } = data;
      const user = users.get(socket.id);
      
      if (user && user.currentRoom === roomId) {
        socket.to(roomId).emit('participant-screen-share-stop', {
          participantId: socket.id
        });
        console.log(`🖥️ Screen share stopped by ${socket.id} in room ${roomId}`);
      }
    } catch (error) {
      console.error('❌ Error handling screen share stop:', error);
    }
  });

  // Handle leaving room
  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`❌ User ${socket.id} disconnected: ${reason}`);
    leaveCurrentRoom(socket);
    users.delete(socket.id);
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

function leaveCurrentRoom(socket) {
  const user = users.get(socket.id);
  if (!user || !user.currentRoom) return;
  
  const roomId = user.currentRoom;
  const room = rooms.get(roomId);
  
  if (!room) return;
  
  try {
    // Remove participant from room
    room.participants = room.participants.filter(p => p.id !== socket.id);
    
    // Leave socket room
    socket.leave(roomId);
    
    // Update user's current room
    user.currentRoom = null;
    
    // Notify other participants
    socket.to(roomId).emit('user-left', {
      participantId: socket.id,
      roomId,
      totalParticipants: room.participants.length
    });
    
    console.log(`👋 User ${socket.id} left room ${roomId}. Room now has ${room.participants.length} participants`);
    
    // Delete room if empty
    if (room.participants.length === 0) {
      rooms.delete(roomId);
      console.log(`🏠 Deleted empty room: ${roomId}`);
    } else if (room.host === socket.id && room.participants.length > 0) {
      // Transfer host to another participant
      room.host = room.participants[0].id;
      room.participants[0].isHost = true;
      
      // Notify new host
      io.to(room.host).emit('host-transferred', {
        roomId,
        isHost: true
      });
      
      // Notify other participants
      socket.to(roomId).emit('host-changed', {
        newHostId: room.host,
        roomId
      });
      
      console.log(`👑 Host transferred to ${room.host} in room ${roomId}`);
    }
    
  } catch (error) {
    console.error('❌ Error leaving room:', error);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('💤 Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('💤 Server closed');
    process.exit(0);
  });
});

const PORT = process.env.SIGNALING_SERVER_PORT || 3002;

server.listen(PORT, () => {
  console.log(`🚀 CodarMeet Signaling Server running on port ${PORT}`);
  console.log(`📡 Socket.IO server started with CORS enabled`);
  console.log(`🌐 Health check: http://localhost:${PORT}/`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || "http://localhost:5173"}`);
}); 