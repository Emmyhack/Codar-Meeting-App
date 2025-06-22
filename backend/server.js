const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Enable CORS
app.use(cors());
app.use(express.json());

// Store connected clients
const clients = new Map();
const rooms = new Map();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'CodarMeet Signaling Server is running',
    timestamp: new Date().toISOString(),
    connectedClients: clients.size,
    activeRooms: rooms.size
  });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  clients.set(clientId, {
    ws,
    roomId: null,
    userId: null
  });

  console.log(`Client connected: ${clientId}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
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
    console.error(`WebSocket error for client ${clientId}:`, error);
    handleClientDisconnect(clientId);
  });
});

function handleMessage(clientId, data) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (data.type) {
    case 'join-room':
      handleJoinRoom(clientId, data);
      break;
    case 'leave-room':
      handleLeaveRoom(clientId);
      break;
    case 'offer':
    case 'answer':
    case 'ice-candidate':
      handleWebRTCMessage(clientId, data);
      break;
    case 'chat-message':
      handleChatMessage(clientId, data);
      break;
    default:
      console.log(`Unknown message type: ${data.type}`);
  }
}

function handleJoinRoom(clientId, data) {
  const client = clients.get(clientId);
  const { roomId, userId } = data;

  // Leave previous room if any
  if (client.roomId) {
    handleLeaveRoom(clientId);
  }

  // Join new room
  client.roomId = roomId;
  client.userId = userId;

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  rooms.get(roomId).add(clientId);

  // Notify others in the room
  broadcastToRoom(roomId, {
    type: 'user-joined',
    userId: userId,
    clientId: clientId
  }, clientId);

  console.log(`Client ${clientId} joined room ${roomId}`);
}

function handleLeaveRoom(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;

  const roomId = client.roomId;
  const room = rooms.get(roomId);
  
  if (room) {
    room.delete(clientId);
    if (room.size === 0) {
      rooms.delete(roomId);
    } else {
      // Notify others in the room
      broadcastToRoom(roomId, {
        type: 'user-left',
        userId: client.userId,
        clientId: clientId
      }, clientId);
    }
  }

  client.roomId = null;
  client.userId = null;

  console.log(`Client ${clientId} left room ${roomId}`);
}

function handleWebRTCMessage(clientId, data) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;

  // Forward WebRTC messages to other clients in the room
  broadcastToRoom(client.roomId, {
    ...data,
    from: clientId
  }, clientId);
}

function handleChatMessage(clientId, data) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;

  // Broadcast chat message to all clients in the room
  broadcastToRoom(client.roomId, {
    type: 'chat-message',
    message: data.message,
    userId: client.userId,
    timestamp: new Date().toISOString()
  });
}

function handleClientDisconnect(clientId) {
  handleLeaveRoom(clientId);
  clients.delete(clientId);
  console.log(`Client disconnected: ${clientId}`);
}

function broadcastToRoom(roomId, message, excludeClientId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.forEach(clientId => {
    if (clientId !== excludeClientId) {
      const client = clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  });
}

function generateClientId() {
  return Math.random().toString(36).substr(2, 9);
}

const PORT = process.env.SIGNALING_SERVER_PORT || 3002;

server.listen(PORT, () => {
  console.log(`🚀 CodarMeet Signaling Server running on port ${PORT}`);
  console.log(`📡 WebSocket server started`);
  console.log(`🌐 Health check: http://localhost:${PORT}/`);
}); 