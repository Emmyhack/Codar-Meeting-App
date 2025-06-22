const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Store active rooms and connections
const rooms = new Map();
const clients = new Map();

// WebSocket connection handling
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  
  console.log(`Client connected: ${clientId}`);

  // Send client their ID
  ws.send(JSON.stringify({
    type: 'client-id',
    clientId: clientId
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(clientId, data);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    handleClientDisconnect(clientId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    handleClientDisconnect(clientId);
  });
});

function handleMessage(clientId, data) {
  const { type, roomId, payload } = data;

  switch (type) {
    case 'join-room':
      handleJoinRoom(clientId, roomId, payload);
      break;
    case 'leave-room':
      handleLeaveRoom(clientId, roomId);
      break;
    case 'offer':
      handleOffer(clientId, roomId, payload);
      break;
    case 'answer':
      handleAnswer(clientId, roomId, payload);
      break;
    case 'ice-candidate':
      handleIceCandidate(clientId, roomId, payload);
      break;
    case 'chat-message':
      handleChatMessage(clientId, roomId, payload);
      break;
    default:
      console.log('Unknown message type:', type);
  }
}

function handleJoinRoom(clientId, roomId, payload) {
  const { username, email } = payload;
  
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      messages: []
    });
  }

  const room = rooms.get(roomId);
  const client = clients.get(clientId);
  
  if (!client) return;

  // Add participant to room
  room.participants.set(clientId, {
    id: clientId,
    username: username || 'Anonymous',
    email: email || '',
    joinedAt: new Date().toISOString()
  });

  // Send room info to the joining client
  client.send(JSON.stringify({
    type: 'room-joined',
    roomId: roomId,
    participants: Array.from(room.participants.values()),
    messages: room.messages.slice(-50) // Last 50 messages
  }));

  // Notify other participants
  broadcastToRoom(roomId, {
    type: 'participant-joined',
    participant: room.participants.get(clientId)
  }, clientId);

  console.log(`Client ${clientId} joined room ${roomId}`);
}

function handleLeaveRoom(clientId, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(clientId);
  if (participant) {
    room.participants.delete(clientId);
    
    // Notify other participants
    broadcastToRoom(roomId, {
      type: 'participant-left',
      participantId: clientId
    });

    // If room is empty, remove it
    if (room.participants.size === 0) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty)`);
    }
  }

  console.log(`Client ${clientId} left room ${roomId}`);
}

function handleOffer(clientId, roomId, payload) {
  const { targetId, offer } = payload;
  const targetClient = clients.get(targetId);
  
  if (targetClient) {
    targetClient.send(JSON.stringify({
      type: 'offer',
      from: clientId,
      offer: offer
    }));
  }
}

function handleAnswer(clientId, roomId, payload) {
  const { targetId, answer } = payload;
  const targetClient = clients.get(targetId);
  
  if (targetClient) {
    targetClient.send(JSON.stringify({
      type: 'answer',
      from: clientId,
      answer: answer
    }));
  }
}

function handleIceCandidate(clientId, roomId, payload) {
  const { targetId, candidate } = payload;
  const targetClient = clients.get(targetId);
  
  if (targetClient) {
    targetClient.send(JSON.stringify({
      type: 'ice-candidate',
      from: clientId,
      candidate: candidate
    }));
  }
}

function handleChatMessage(clientId, roomId, payload) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(clientId);
  if (!participant) return;

  const message = {
    id: uuidv4(),
    text: payload.text,
    sender: participant.username,
    senderId: clientId,
    timestamp: new Date().toISOString()
  };

  room.messages.push(message);

  // Broadcast to all participants in the room
  broadcastToRoom(roomId, {
    type: 'chat-message',
    message: message
  });

  console.log(`Chat message in room ${roomId}: ${message.text}`);
}

function handleClientDisconnect(clientId) {
  console.log(`Client disconnected: ${clientId}`);
  
  // Remove from all rooms
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.has(clientId)) {
      handleLeaveRoom(clientId, roomId);
    }
  }
  
  // Remove from clients
  clients.delete(clientId);
}

function broadcastToRoom(roomId, message, excludeClientId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const [participantId, participant] of room.participants.entries()) {
    if (participantId === excludeClientId) continue;
    
    const client = clients.get(participantId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

// REST API endpoints
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    id: room.id,
    participantCount: room.participants.size,
    participants: Array.from(room.participants.values()),
    messageCount: room.messages.length
  });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    participantCount: room.participants.size,
    messageCount: room.messages.length
  }));
  
  res.json(roomList);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeRooms: rooms.size,
    activeClients: clients.size,
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3002;

server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready for connections`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
}); 