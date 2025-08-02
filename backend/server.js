const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Rate limiting map to prevent abuse
const rateLimitMap = new Map();

// Input validation helpers
const validateRoomId = (roomId) => {
  if (!roomId || typeof roomId !== 'string') {
    return { isValid: false, error: 'Room ID must be a non-empty string' };
  }
  if (roomId.length < 3 || roomId.length > 50) {
    return { isValid: false, error: 'Room ID must be between 3-50 characters' };
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(roomId)) {
    return { isValid: false, error: 'Room ID can only contain letters, numbers, hyphens, and underscores' };
  }
  return { isValid: true };
};

const validateUserInfo = (userInfo) => {
  if (!userInfo || typeof userInfo !== 'object') {
    return { isValid: false, error: 'User info must be an object' };
  }
  if (userInfo.name && typeof userInfo.name !== 'string') {
    return { isValid: false, error: 'User name must be a string' };
  }
  if (userInfo.name && userInfo.name.length > 50) {
    return { isValid: false, error: 'User name must be less than 50 characters' };
  }
  return { isValid: true };
};

const checkRateLimit = (socketId) => {
  const now = Date.now();
  const userActions = rateLimitMap.get(socketId) || [];
  
  // Remove actions older than 1 minute
  const recentActions = userActions.filter(time => now - time < 60000);
  
  // Allow max 30 actions per minute
  if (recentActions.length >= 30) {
    return false;
  }
  
  recentActions.push(now);
  rateLimitMap.set(socketId, recentActions);
  return true;
};

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [socketId, actions] of rateLimitMap.entries()) {
    const recentActions = actions.filter(time => now - time < 60000);
    if (recentActions.length === 0) {
      rateLimitMap.delete(socketId);
    } else {
      rateLimitMap.set(socketId, recentActions);
    }
  }
}, 60000);

// Configure Socket.IO with CORS and security settings
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB limit
  allowEIO3: false
});

// Enable CORS for HTTP endpoints
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Store room and user data with thread safety
const rooms = new Map();
const users = new Map();
const roomLocks = new Map(); // Prevent race conditions

// Thread-safe room operations
const withRoomLock = async (roomId, operation) => {
  if (roomLocks.has(roomId)) {
    await roomLocks.get(roomId);
  }
  
  let resolvelock;
  const lockPromise = new Promise(resolve => { resolvelock = resolve; });
  roomLocks.set(roomId, lockPromise);
  
  try {
    const result = await operation();
    return result;
  } finally {
    roomLocks.delete(roomId);
    resolvelock();
  }
};

// Health check endpoint
app.get('/', (req, res) => {
  try {
    const roomsInfo = Array.from(rooms.entries()).map(([roomId, room]) => ({
      roomId,
      participants: room.participants.length,
      host: room.host,
      createdAt: room.createdAt
    }));
    
    res.json({ 
      message: 'CodarMeet Signaling Server is running',
      timestamp: new Date().toISOString(),
      connectedUsers: users.size,
      activeRooms: rooms.size,
      rooms: roomsInfo,
      serverHealth: 'healthy'
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ error: 'Health check failed' });
  }
});

// Get room info endpoint with validation
app.get('/room/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    
    const validation = validateRoomId(roomId);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: validation.error,
        exists: false 
      });
    }
    
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
  } catch (error) {
    console.error('Room info error:', error);
    res.status(500).json({ error: 'Failed to get room info' });
  }
});

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  
  // Store user connection with safety checks
  try {
    users.set(socket.id, {
      id: socket.id,
      connectedAt: new Date(),
      currentRoom: null,
      lastActivity: new Date()
    });
  } catch (error) {
    console.error('Error storing user connection:', error);
  }

  // Handle joining a room with comprehensive validation
  socket.on('join-room', async (data) => {
    try {
      // Rate limiting
      if (!checkRateLimit(socket.id)) {
        socket.emit('join-error', { 
          error: 'Too many requests. Please slow down.',
          code: 'RATE_LIMITED'
        });
        return;
      }

      // Input validation
      if (!data || typeof data !== 'object') {
        socket.emit('join-error', { 
          error: 'Invalid request data',
          code: 'INVALID_DATA'
        });
        return;
      }

      const { roomId, userInfo } = data;
      
      const roomValidation = validateRoomId(roomId);
      if (!roomValidation.isValid) {
        socket.emit('join-error', { 
          error: roomValidation.error,
          code: 'INVALID_ROOM_ID'
        });
        return;
      }

      const userValidation = validateUserInfo(userInfo);
      if (!userValidation.isValid) {
        socket.emit('join-error', { 
          error: userValidation.error,
          code: 'INVALID_USER_INFO'
        });
        return;
      }

      console.log(`🚪 User ${socket.id} attempting to join room: ${roomId}`);
      
      await withRoomLock(roomId, async () => {
        // Leave any previous room
        await leaveCurrentRoom(socket);
        
        // Create or get room
        let room = rooms.get(roomId);
        if (!room) {
          room = {
            id: roomId,
            participants: [],
            host: socket.id,
            createdAt: new Date(),
            maxParticipants: 50,
            lastActivity: new Date()
          };
          rooms.set(roomId, room);
          console.log(`🏠 Created new room: ${roomId}`);
        }
        
        // Check room capacity
        if (room.participants.length >= room.maxParticipants) {
          socket.emit('join-error', { 
            error: 'Room is full',
            code: 'ROOM_FULL'
          });
          return;
        }
        
        // Check if user is already in room (edge case)
        const existingParticipant = room.participants.find(p => p.id === socket.id);
        if (existingParticipant) {
          console.log(`User ${socket.id} already in room ${roomId}`);
          socket.emit('join-error', { 
            error: 'Already in room',
            code: 'ALREADY_IN_ROOM'
          });
          return;
        }
        
        // Add user to room
        const participant = {
          id: socket.id,
          userInfo: {
            name: userInfo?.name || `User ${socket.id.substring(0, 6)}`,
            email: userInfo?.email || '',
            ...userInfo
          },
          joinedAt: new Date(),
          isHost: room.participants.length === 0 || socket.id === room.host
        };
        
        room.participants.push(participant);
        room.lastActivity = new Date();
        socket.join(roomId);
        
        // Update user's current room
        const user = users.get(socket.id);
        if (user) {
          user.currentRoom = roomId;
          user.lastActivity = new Date();
        }
        
        // Notify user of successful join
        socket.emit('joined-room', {
          roomId,
          participant,
          room: {
            id: room.id,
            host: room.host,
            participantCount: room.participants.length,
            createdAt: room.createdAt
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
      });
      
    } catch (error) {
      console.error('❌ Error joining room:', error);
      socket.emit('join-error', { 
        error: 'Failed to join room',
        code: 'JOIN_FAILED',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Handle WebRTC offer with validation
  socket.on('offer', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        return;
      }

      const { targetId, offer, roomId } = data;
      
      if (!targetId || !offer || !roomId) {
        console.error('Invalid offer data');
        return;
      }

      const user = users.get(socket.id);
      if (!user || user.currentRoom !== roomId) {
        console.error('User not in room for offer');
        return;
      }

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

  // Handle WebRTC answer with validation
  socket.on('answer', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        return;
      }

      const { targetId, answer, roomId } = data;
      
      if (!targetId || !answer || !roomId) {
        console.error('Invalid answer data');
        return;
      }

      const user = users.get(socket.id);
      if (!user || user.currentRoom !== roomId) {
        console.error('User not in room for answer');
        return;
      }

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

  // Handle ICE candidates with validation
  socket.on('ice-candidate', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        return;
      }

      const { targetId, candidate, roomId } = data;
      
      if (!targetId || !candidate || !roomId) {
        return;
      }

      const user = users.get(socket.id);
      if (!user || user.currentRoom !== roomId) {
        return;
      }
      
      socket.to(targetId).emit('ice-candidate', {
        fromId: socket.id,
        candidate,
        roomId
      });
    } catch (error) {
      console.error('❌ Error handling ICE candidate:', error);
    }
  });

  // Handle media state updates with validation
  socket.on('media-state-update', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        return;
      }

      const { roomId, mediaState } = data;
      
      if (!roomId || !mediaState || typeof mediaState !== 'object') {
        return;
      }

      const user = users.get(socket.id);
      if (!user || user.currentRoom !== roomId) {
        return;
      }

      socket.to(roomId).emit('participant-media-update', {
        participantId: socket.id,
        mediaState
      });
      console.log(`🎤📹 Media state update from ${socket.id}:`, mediaState);
    } catch (error) {
      console.error('❌ Error handling media state update:', error);
    }
  });

  // Handle chat messages with validation and sanitization
  socket.on('chat-message', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        return;
      }

      const { roomId, message } = data;
      
      if (!roomId || !message || typeof message !== 'string') {
        return;
      }

      // Sanitize message
      const sanitizedMessage = message.trim().substring(0, 1000); // Limit message length
      if (!sanitizedMessage) {
        return;
      }

      const user = users.get(socket.id);
      if (!user || user.currentRoom !== roomId) {
        return;
      }

      const chatMessage = {
        id: uuidv4(),
        message: sanitizedMessage,
        fromId: socket.id,
        timestamp: new Date(),
        type: 'text'
      };
      
      // Broadcast to all participants in the room
      io.to(roomId).emit('chat-message', chatMessage);
      console.log(`💬 Chat message in room ${roomId} from ${socket.id}`);
    } catch (error) {
      console.error('❌ Error handling chat message:', error);
    }
  });

  // Handle screen share events
  socket.on('start-screen-share', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        return;
      }

      const { roomId } = data;
      const user = users.get(socket.id);
      
      if (!user || user.currentRoom !== roomId) {
        return;
      }

      socket.to(roomId).emit('participant-screen-share-start', {
        participantId: socket.id
      });
      console.log(`🖥️ Screen share started by ${socket.id} in room ${roomId}`);
    } catch (error) {
      console.error('❌ Error handling screen share start:', error);
    }
  });

  socket.on('stop-screen-share', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        return;
      }

      const { roomId } = data;
      const user = users.get(socket.id);
      
      if (!user || user.currentRoom !== roomId) {
        return;
      }

      socket.to(roomId).emit('participant-screen-share-stop', {
        participantId: socket.id
      });
      console.log(`🖥️ Screen share stopped by ${socket.id} in room ${roomId}`);
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
    rateLimitMap.delete(socket.id);
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

async function leaveCurrentRoom(socket) {
  try {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;
    
    const roomId = user.currentRoom;
    
    await withRoomLock(roomId, async () => {
      const room = rooms.get(roomId);
      if (!room) return;
      
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
        const newHost = room.participants[0];
        room.host = newHost.id;
        newHost.isHost = true;
        
        // Notify new host
        io.to(newHost.id).emit('host-transferred', {
          roomId,
          isHost: true
        });
        
        // Notify other participants
        socket.to(roomId).emit('host-changed', {
          newHostId: newHost.id,
          roomId
        });
        
        console.log(`👑 Host transferred to ${newHost.id} in room ${roomId}`);
      }
    });
    
  } catch (error) {
    console.error('❌ Error leaving room:', error);
  }
}

// Clean up inactive rooms periodically
setInterval(() => {
  const now = Date.now();
  const inactiveThreshold = 2 * 60 * 60 * 1000; // 2 hours
  
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.lastActivity.getTime() > inactiveThreshold) {
      console.log(`🧹 Cleaning up inactive room: ${roomId}`);
      rooms.delete(roomId);
    }
  }
}, 30 * 60 * 1000); // Check every 30 minutes

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('🔄 Shutting down gracefully...');
  
  // Notify all connected users
  io.emit('server-shutdown', { message: 'Server is shutting down' });
  
  // Close all connections
  io.close(() => {
    console.log('💤 Socket.IO server closed');
    server.close(() => {
      console.log('💤 HTTP server closed');
      process.exit(0);
    });
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('⚠️ Forced shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.SIGNALING_SERVER_PORT || 3002;

server.listen(PORT, () => {
  console.log(`🚀 CodarMeet Signaling Server running on port ${PORT}`);
  console.log(`📡 Socket.IO server started with CORS enabled`);
  console.log(`🌐 Health check: http://localhost:${PORT}/`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || "http://localhost:5173"}`);
  console.log(`🛡️  Rate limiting and security enabled`);
}); 