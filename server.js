const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for room links
app.get('/room/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};

io.on('connection', socket => {
  socket.on('join', roomId => {
    socket.join(roomId);

    // Track users in the room
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);

    // Send list of users to new user
    const otherUsers = rooms[roomId].filter(id => id !== socket.id);
    socket.emit('users', otherUsers);

    // Notify existing users
    socket.to(roomId).emit('user-connected', socket.id);

    // Relay signaling messages
    socket.on('offer', ({ target, sdp }) => {
      io.to(target).emit('offer', { sender: socket.id, sdp });
    });

    socket.on('answer', ({ target, sdp }) => {
      io.to(target).emit('answer', { sender: socket.id, sdp });
    });

    socket.on('ice-candidate', ({ target, candidate }) => {
      io.to(target).emit('ice-candidate', { sender: socket.id, candidate });
    });

    socket.on('disconnect', () => {
      // Remove user from room
      for (const room in rooms) {
        rooms[room] = rooms[room].filter(id => id !== socket.id);
        socket.to(room).emit('user-disconnected', socket.id);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
