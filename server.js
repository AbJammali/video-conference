const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Room management
const rooms = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Route for the landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route for creating new rooms - redirects to a random room
app.get('/new', (req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  res.redirect(`/${roomId}`);
});

// Route for specific rooms
app.get('/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'conference.html'));
});
// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  let currentRoom = null;
  let currentUser = null;

  // Handle joining a room
  socket.on('join', ({ room, user }) => {
    try {
      if (!room || !user) {
        throw new Error('Room and user information required');
      }

      currentRoom = room;
      currentUser = user;

      // Initialize room if it doesn't exist
      if (!rooms.has(room)) {
        rooms.set(room, {
          participants: new Map(),
          createdAt: new Date()
        });
      }

      const roomData = rooms.get(room);

      // Add user to room
      roomData.participants.set(socket.id, {
        id: socket.id,
        user,
        joinedAt: new Date()
      });

      // Join the socket room
      socket.join(room);

      // Notify the user they've joined successfully
      socket.emit('joined', { 
        room, 
        user, 
        participantCount: roomData.participants.size 
      });

      // Update all clients in the room with new participant count
      updateRoomInfo(room);

      // Notify other users in the room about the new connection
      socket.to(room).emit('user-connected', user);

      console.log(`User ${user} joined room ${room}`);
    } catch (error) {
      console.error('Join error:', error.message);
      socket.emit('error', { message: error.message });
    }
  });

  // Handle signaling messages
  socket.on('signal', (data) => {
    try {
      if (!currentRoom) {
        throw new Error('Not in a room');
      }

      if (!data || !data.type) {
        throw new Error('Invalid signal data');
      }

      // Validate the target user exists in the room
      const roomData = rooms.get(currentRoom);
      if (data.target) {
        const targetExists = [...roomData.participants.values()].some(
          p => p.user === data.target
        );
        
        if (!targetExists) {
          throw new Error('Target user not found in room');
        }
      }

      // Broadcast to specific target or to all in room except sender
      if (data.target) {
        const targetSocket = [...roomData.participants.keys()].find(
          key => roomData.participants.get(key).user === data.target
        );
        
        if (targetSocket) {
          socket.to(targetSocket).emit('signal', {
            ...data,
            user: currentUser
          });
        }
      } else {
        socket.to(currentRoom).emit('signal', {
          ...data,
          user: currentUser
        });
      }
    } catch (error) {
      console.error('Signal error:', error.message);
      socket.emit('error', { message: error.message });
    }
  });

  // Handle chat messages (fallback if WebRTC data channel fails)
  socket.on('chat-message', (message) => {
    if (currentRoom && currentUser) {
      const timestamp = new Date().toISOString();
      io.to(currentRoom).emit('chat-message', {
        text: message,
        sender: currentUser,
        timestamp
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (currentRoom) {
      const roomData = rooms.get(currentRoom);
      if (roomData) {
        // Remove user from room
        roomData.participants.delete(socket.id);

        // Notify other users in the room
        if (currentUser) {
          socket.to(currentRoom).emit('user-disconnected', currentUser);
        }

        // Update participant count
        updateRoomInfo(currentRoom);

        // Clean up empty rooms
        if (roomData.participants.size === 0) {
          rooms.delete(currentRoom);
          console.log(`Room ${currentRoom} cleaned up`);
        }

        console.log(`User ${currentUser} left room ${currentRoom}`);
      }
    }
  });

  // Handle explicit leave event
  socket.on('leave', (room) => {
    if (room && rooms.has(room)) {
      const roomData = rooms.get(room);
      roomData.participants.delete(socket.id);
      updateRoomInfo(room);

      if (roomData.participants.size === 0) {
        rooms.delete(room);
      }
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket error from ${socket.id}:`, error);
  });

  // Function to update all clients in a room with current info
  function updateRoomInfo(room) {
    if (rooms.has(room)) {
      const roomData = rooms.get(room);
      io.to(room).emit('room-info', {
        participantCount: roomData.participants.size,
        room
      });
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Clean up empty rooms periodically
setInterval(() => {
  const now = new Date();
  const timeout = 30 * 60 * 1000; // 30 minutes

  rooms.forEach((roomData, room) => {
    if (roomData.participants.size === 0 && 
        now - roomData.createdAt > timeout) {
      rooms.delete(room);
      console.log(`Cleaned up inactive room: ${room}`);
    }
  });
}, 60 * 60 * 1000); // Check every hour
