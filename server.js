const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Route all /room/* URLs to index.html
app.get('/room/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket handling
io.on('connection', socket => {
  socket.on('join', room => {
    socket.join(room);
    socket.to(room).emit('user-connected', socket.id);

    socket.on('signal', data => {
      socket.to(room).emit('signal', data);
    });

    socket.on('disconnect', () => {
      socket.to(room).emit('user-disconnected', socket.id);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
