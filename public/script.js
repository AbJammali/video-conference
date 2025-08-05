const socket = io();
let peerConnection;
let localStream;
let room = window.location.pathname.split('/').pop() || 'default-room';
let currentUser = sessionStorage.getItem('userName') || `user-${Math.floor(Math.random() * 10000)}`;
let isCallActive = false;
let screenSharingActive = false;
let dataChannel;

// DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const qualityIndicator = document.getElementById('qualityIndicator');
const muteAudioBtn = document.getElementById('muteAudio');
const muteVideoBtn = document.getElementById('muteVideo');
const screenShareBtn = document.getElementById('screenShare');
const endCallBtn = document.getElementById('endCall');
const toggleChatBtn = document.getElementById('toggleChat');
const chatContainer = document.querySelector('.chat-container');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessage');
const roomNameDisplay = document.getElementById('roomName');
const participantCountDisplay = document.getElementById('participantCount');
const connectionStatus = document.getElementById('connectionStatus');
const reconnectButton = document.getElementById('reconnectButton');

// Initialize the app
init();

function init() {
  setupEventListeners();
  updateRoomInfo();
  updateUserDisplay();
  connectToRoom();
  handleOrientationChange();
}

function setupEventListeners() {
  // Media control buttons
  muteAudioBtn.addEventListener('click', toggleAudio);
  muteVideoBtn.addEventListener('click', toggleVideo);
  screenShareBtn.addEventListener('click', toggleScreenShare);
  endCallBtn.addEventListener('click', endCall);
  
  // Chat controls
  toggleChatBtn.addEventListener('click', toggleChat);
  sendMessageBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  
  // Reconnection
  reconnectButton.addEventListener('click', reconnect);
  
  // Window events
  window.addEventListener('beforeunload', cleanupBeforeUnload);
}

function updateRoomInfo() {
  roomNameDisplay.textContent = `Room: ${room}`;
}

function updateUserDisplay() {
  // Clear any existing name displays
  document.querySelectorAll('.user-name-display').forEach(el => el.remove());
  
  // Add name under local video
  const localVideoWrapper = document.querySelector('.video-wrapper:first-child');
  const localNameDisplay = document.createElement('div');
  localNameDisplay.className = 'user-name-display local-name';
  localNameDisplay.textContent = currentUser;
  localVideoWrapper.appendChild(localNameDisplay);
}

async function connectToRoom() {
  try {
    showStatus('Connecting to room...');
    
    // Get user media
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    localVideo.srcObject = localStream;
    
    // Join the room
    socket.emit('join', { room, user: currentUser });
    
    hideStatus();
    isCallActive = true;
  } catch (error) {
    console.error('Error accessing media devices:', error);
    showStatus(`Error: ${error.message}`, true);
  }
}

function createPeerConnection() {
  const config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      // Add your TURN servers here if available
      // { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' }
    ]
  };
  
  peerConnection = new RTCPeerConnection(config);
  
  // Add local stream tracks
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  // Set up event handlers
  peerConnection.onicecandidate = handleICECandidateEvent;
  peerConnection.ontrack = handleTrackEvent;
  peerConnection.oniceconnectionstatechange = handleICEConnectionStateChange;
  peerConnection.ondatachannel = handleDataChannel;
  
  // Create data channel for chat
  dataChannel = peerConnection.createDataChannel('chat');
  setupDataChannel(dataChannel);
}

function handleICECandidateEvent(event) {
  if (event.candidate) {
    socket.emit('signal', { 
      type: 'ice', 
      candidate: event.candidate,
      room,
      user: currentUser
    });
  }
}

function handleTrackEvent(event) {
  remoteVideo.srcObject = event.streams[0];
  hideStatus();
  
  // Add name under remote video
  const remoteVideoWrapper = document.querySelector('.video-wrapper:last-child');
  const remoteNameDisplay = document.createElement('div');
  remoteNameDisplay.className = 'user-name-display remote-name';
  remoteNameDisplay.textContent = event.streams[0].id.split(' ')[0]; // Use stream ID or find better way to get remote user name
  remoteVideoWrapper.appendChild(remoteNameDisplay);
}

function handleICEConnectionStateChange() {
  if (peerConnection) {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'disconnected' || 
        peerConnection.iceConnectionState === 'failed') {
      showStatus('Connection lost. Attempting to reconnect...', true);
      reconnect();
    }
  }
}

function handleDataChannel(event) {
  if (event.channel.label === 'chat') {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  }
}

function setupDataChannel(channel) {
  channel.onopen = () => console.log('Data channel opened');
  channel.onclose = () => console.log('Data channel closed');
  channel.onmessage = (event) => {
    addMessageToChat(JSON.parse(event.data), 'received');
  };
}

// Signaling event handlers
socket.on('user-connected', async (userId) => {
  if (userId !== currentUser) {
    showStatus(`User ${userId} connected. Setting up call...`);
    createPeerConnection();
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('signal', { 
      type: 'offer', 
      offer,
      room,
      user: currentUser,
      target: userId
    });
  }
});

socket.on('signal', async (data) => {
  if (data.user === currentUser) return;
  
  try {
    if (data.type === 'offer') {
      if (!peerConnection) createPeerConnection();
      
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socket.emit('signal', { 
        type: 'answer', 
        answer,
        room,
        user: currentUser,
        target: data.user
      });
      hideStatus();
    } else if (data.type === 'answer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      hideStatus();
    } else if (data.type === 'ice') {
      try {
        await peerConnection.addIceCandidate(data.candidate);
      } catch (e) {
        console.error('Error adding ICE candidate:', e);
      }
    }
  } catch (error) {
    console.error('Error handling signal:', error);
    showStatus('Error establishing connection', true);
  }
});

socket.on('user-disconnected', (userId) => {
  showStatus(`User ${userId} disconnected`, true);
  if (peerConnection) {
    cleanupPeerConnection();
  }
});

socket.on('room-info', (info) => {
  participantCountDisplay.textContent = `${info.participantCount} participants`;
});

socket.on('connect_error', (error) => {
  showStatus(`Connection error: ${error.message}`, true);
});

// Media controls
function toggleAudio() {
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    const isMuted = !audioTracks[0].enabled;
    audioTracks[0].enabled = isMuted;
    muteAudioBtn.innerHTML = isMuted ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    muteAudioBtn.title = isMuted ? 'Mute audio' : 'Unmute audio';
  }
}

function toggleVideo() {
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length > 0) {
    const isDisabled = !videoTracks[0].enabled;
    videoTracks[0].enabled = isDisabled;
    muteVideoBtn.innerHTML = isDisabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    muteVideoBtn.title = isDisabled ? 'Disable video' : 'Enable video';
  }
}

async function toggleScreenShare() {
  try {
    if (!screenSharingActive) {
      if (isIOS()) {
        try {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          await handleScreenStream(screenStream);
        } catch (error) {
          console.log('Standard screen share failed, trying iOS workaround');
          return handleIOSScreenShare();
        }
      } else {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        await handleScreenStream(screenStream);
      }
    } else {
      await stopScreenShare();
    }
  } catch (error) {
    console.error('Error during screen sharing:', error);
    showStatus('Error sharing screen', true);
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function handleIOSScreenShare() {
  showStatus('Screen sharing is not supported on iOS devices. Please use a desktop browser for screen sharing.', false);
 setTimeout(() => {
    hideStatus();
  }, 5000);
}

async function handleScreenStream(screenStream) {
  const videoTrack = screenStream.getVideoTracks()[0];
  const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender) await sender.replaceTrack(videoTrack);

  const oldTracks = localStream.getVideoTracks();
  oldTracks.forEach(track => {
    localStream.removeTrack(track);
    track.stop();
  });

  localStream.addTrack(videoTrack);
  localVideo.srcObject = new MediaStream([videoTrack]);

  screenSharingActive = true;
  screenShareBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Sharing';

  videoTrack.onended = () => {
    if (screenSharingActive) toggleScreenShare();
  };
}

async function stopScreenShare() {
  const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
  const cameraTrack = cameraStream.getVideoTracks()[0];
  const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender) await sender.replaceTrack(cameraTrack);

  const oldTracks = localStream.getVideoTracks();
  oldTracks.forEach(track => {
    localStream.removeTrack(track);
    track.stop();
  });

  localStream.addTrack(cameraTrack);
  localVideo.srcObject = new MediaStream([cameraTrack]);

  screenSharingActive = false;
  screenShareBtn.innerHTML = '<i class="fas fa-desktop"></i> Share Screen';
}

function handleOrientationChange() {
  window.addEventListener('orientationchange', () => {
    // Force a reflow to maintain video dimensions
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      video.style.width = '100%';
      video.style.height = '100%';
    });
    
    // Optional: Add a small delay to ensure proper resizing
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
  });
}
// Chat functionality
function toggleChat() {
  chatContainer.classList.toggle('hidden');
}

function sendMessage() {
  const message = chatInput.value.trim();
  if (message && dataChannel && dataChannel.readyState === 'open') {
    const messageData = {
      text: message,
      sender: currentUser,
      timestamp: new Date().toISOString()
    };
    
    dataChannel.send(JSON.stringify(messageData));
    addMessageToChat(messageData, 'sent');
    chatInput.value = '';
  }
}

function addMessageToChat(message, type) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', type);
  
  const infoElement = document.createElement('div');
  infoElement.classList.add('message-info');
  infoElement.textContent = `${type === 'received' ? message.sender : 'You'} at ${new Date(message.timestamp).toLocaleTimeString()}`;
  
  const textElement = document.createElement('div');
  textElement.textContent = message.text;
  
  messageElement.appendChild(infoElement);
  messageElement.appendChild(textElement);
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Call quality monitoring
setInterval(async () => {
  if (!peerConnection || !isCallActive) return;

  try {
    const stats = await peerConnection.getStats(null);
    let rtt = null;
    let packetsLost = 0;
    let totalPackets = 1; // Avoid division by zero
    let jitter = 0;

    stats.forEach(report => {
      if (report.type === "remote-inbound-rtp" && report.kind === "video") {
        if (report.roundTripTime) {
          rtt = report.roundTripTime * 1000; // convert to ms
        }
        if (report.packetsLost !== undefined && report.packetsReceived !== undefined) {
          packetsLost = report.packetsLost;
          totalPackets = report.packetsReceived + packetsLost;
        }
        if (report.jitter) {
          jitter = report.jitter * 1000; // convert to ms
        }
      }
    });

    const packetLossPercentage = (packetsLost / totalPackets) * 100;
    updateCallQualityUI(rtt, packetLossPercentage, jitter);
  } catch (error) {
    console.error('Error getting stats:', error);
  }
}, 2000);

function updateCallQualityUI(rtt, packetLoss, jitter) {
  const icon = qualityIndicator.querySelector('.icon');
  const text = qualityIndicator.querySelector('.text');
  
  if (rtt === null) {
    icon.textContent = '📶';
    text.textContent = 'Connecting...';
    qualityIndicator.title = 'Establishing connection';
    return;
  }
  
  let quality;
  if (rtt < 150 && packetLoss < 2 && jitter < 30) {
    quality = 'excellent';
    icon.textContent = '📶🟢';
    text.textContent = 'Excellent';
  } else if (rtt < 300 && packetLoss < 5 && jitter < 50) {
    quality = 'good';
    icon.textContent = '📶🟡';
    text.textContent = 'Good';
  } else {
    quality = 'poor';
    icon.textContent = '📶🔴';
    text.textContent = 'Poor';
  }
  
  qualityIndicator.title = `Quality: ${quality}\nRTT: ${rtt ? rtt.toFixed(0)+'ms' : 'N/A'}\nPacket loss: ${packetLoss ? packetLoss.toFixed(1)+'%' : 'N/A'}\nJitter: ${jitter ? jitter.toFixed(0)+'ms' : 'N/A'}`;
}

// Connection management
function showStatus(message, showReconnect = false) {
  connectionStatus.classList.remove('hidden');
  connectionStatus.querySelector('.status-message').textContent = message;
  reconnectButton.classList.toggle('hidden', !showReconnect);
}

function hideStatus() {
  connectionStatus.classList.add('hidden');
}

function reconnect() {
  showStatus('Reconnecting...');
  cleanupPeerConnection();
  connectToRoom();
}

function endCall() {
  if (confirm('Are you sure you want to end the call?')) {
    cleanup();
    window.location.href = '/';
  }
}

function cleanupBeforeUnload() {
  if (isCallActive) {
    cleanup();
  }
}

function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  cleanupPeerConnection();
  
  if (socket) {
    socket.emit('leave', room);
    socket.disconnect();
  }
  
  isCallActive = false;
}

function cleanupPeerConnection() {
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }
  
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
  }
  
  dataChannel = null;
}
