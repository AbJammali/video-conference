const socket = io();
let peerConnection;
let localStream;
let screenStream = null;
let room = window.location.pathname.split('/').pop() || 'default-room';
let currentUser = sessionStorage.getItem('userName') || `user-${Math.floor(Math.random() * 10000)}`;
let isCallActive = false;
let screenSharingActive = false;
let dataChannel;
let currentContentTrackId = null;
let incomingVideoTracks = {};
let trackHistoryMap = {};


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
const chatNotification = document.getElementById('chatNotification');
const expectingScreenShareFrom = new Map();
const endCallModal = document.getElementById('endCallModal');
const confirmEndCallBtn = document.getElementById('confirmEndCall');
const cancelEndCallBtn = document.getElementById('cancelEndCall');


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
  screenShareBtn.addEventListener('click', () => {
    const withAudio = document.getElementById('shareAudioCheckbox').checked;
    toggleScreenShare(withAudio);
  });
  endCallBtn.addEventListener('click', endCall);
  // Audio slider event
  document.getElementById('shareAudioCheckbox').addEventListener('change', toggleScreenShareAudio);

    // Chat controls
  toggleChatBtn.addEventListener('click', toggleChat);
  sendMessageBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  
  const chatCloseBtn = document.getElementById('chatCloseBtn');
  if (chatCloseBtn) {
    chatCloseBtn.addEventListener('click', () => {
      chatContainer.classList.remove('open');
      document.querySelector('.container').classList.remove('chat-open');
    });
  }
  // Fullscreen controls for content sharing
  const localScreenFullscreenBtn = document.getElementById('localScreenFullscreen');
  const remoteScreenFullscreenBtn = document.getElementById('remoteScreenFullscreen');
  const localScreenShare = document.getElementById('localScreenShare');
  const remoteScreenShare = document.getElementById('remoteScreenShare');

  if (localScreenFullscreenBtn && localScreenShare) {
    localScreenFullscreenBtn.addEventListener('click', () => {
      toggleFullscreen(localScreenShare, localScreenFullscreenBtn);
    });
  }
  if (remoteScreenFullscreenBtn && remoteScreenShare) {
    remoteScreenFullscreenBtn.addEventListener('click', () => {
      toggleFullscreen(remoteScreenShare, remoteScreenFullscreenBtn);
    });
  }
  // iOS fullscreen fix: re-attach screen stream after exiting fullscreen
  if (localScreenShare) {
    localScreenShare.addEventListener('webkitendfullscreen', () => {
      if (screenStream) {
        localScreenShare.srcObject = screenStream;
        localScreenShare.play().catch(() => {});
      }
    });
  }
  
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
    
    // Set the stream ID to include the username
    localStream.id = `${currentUser}-${Date.now()}`;
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
  
   // Log when browser thinks renegotiation is needed
  peerConnection.onnegotiationneeded = () => {
    console.log('[PeerConnection] onnegotiationneeded fired');
  };
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

async function renegotiate(reason) {
  console.log(`[Renegotiation] Triggered: ${reason}`);
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log(`[Renegotiation] Local description set, sending offer`);
    socket.emit('signal', {
      type: 'offer',
      offer,
      room,
      user: currentUser
    });
    
  } catch (err) {
    console.error(`[Renegotiation] Error during renegotiation: ${err}`);
  }
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
  console.log(`[handleTrackEvent] kind=${event.track.kind}, id=${event.track.id}`);

  if (event.track.kind === 'video') {
    // For one-to-one calls, use the only key in expectingScreenShareFrom
    let senderUser = null;
    if (expectingScreenShareFrom.size === 1) {
      senderUser = Array.from(expectingScreenShareFrom.keys())[0];
    }
    // For multi-user, you need a mapping from stream/track to user (not shown here)

    const expectedId = senderUser ? expectingScreenShareFrom.get(senderUser) : null;
    console.log('[Mapping] Current expectingScreenShareFrom:', Array.from(expectingScreenShareFrom.entries()));
    console.log(`[Mapping] senderUser=${senderUser}, expectedId=${expectedId}, trackId=${event.track.id}`);

    if (expectedId) {
      console.log(`[Video Attach] Routing to remoteScreenShare for user=${senderUser}, contentId=${expectedId}`);
      document.getElementById('remoteScreenShare').srcObject = event.streams[0] || new MediaStream([event.track]);
      expectingScreenShareFrom.delete(senderUser);
      console.log('[Mapping] After routing, expectingScreenShareFrom:', Array.from(expectingScreenShareFrom.entries()));
      document.querySelector('.remote-screen').style.display = 'block';
    } else {
      console.log(`[Video Attach] Routing to remoteVideo`);
      remoteVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
      document.querySelector('.remote-screen').style.display = 'none';
    }
  } else if (event.track.kind === 'audio') {
    // Attach audio track to remoteVideo stream
    let stream = remoteVideo.srcObject || new MediaStream();
    stream.addTrack(event.track);
    remoteVideo.srcObject = stream;
    console.log(`[Audio Attach] Added audio track id=${event.track.id} to remoteVideo`);
  }
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
  channel.onopen = () => {
    // Send your name when the data channel opens
    channel.send(JSON.stringify({ type: 'name', name: currentUser }));
  };
  channel.onclose = () => console.log('Data channel closed');
  channel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'name') {
      // Update remote name display
      const remoteNameDisplay = document.querySelector('.remote-name');
      if (remoteNameDisplay) {
        remoteNameDisplay.textContent = data.name;
      }
    } else if (data.text) {
      addMessageToChat(data, 'received');
    }
  };
}

// Signaling event handlers
socket.on('user-connected', async (userId) => {
  if (userId !== currentUser) {
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
    showStatus(`User ${userId} connected. Setting up call...`);
    setTimeout(hideStatus, 3000);
  }
});

socket.on('signal', async (data) => {
  if (data.user === currentUser) return;

  if (data.type === 'content-start') {
    console.log('[Signal Handler] Received content-start:', data);
    console.log(`[BFCP] ${data.user} started content share with contentId=${data.contentId}`);
    showStatus(`${data.user} started sharing their screen.`);
    setTimeout(hideStatus, 3000);

    // Floor control: If we are sharing, stop our own sharing and notify others
    if (screenSharingActive) {
      console.log('[Floor Control] Remote started sharing, stopping local share');
      await stopScreenShare(true); // skipRenegotiate = true
      // Notify others that we've stopped sharing
      socket.emit('signal', {
        type: 'content-stop',
        room,
        user: currentUser
      });
    }

    expectingScreenShareFrom.set(data.user, data.contentId);
    console.log('[Mapping] Set expectingScreenShareFrom:', Array.from(expectingScreenShareFrom.entries()));
    currentContentTrackId = data.contentId;
    document.querySelector('.remote-screen').style.display = 'block';
    return;
  }
  if (data.type === 'content-stop') {
    console.log(`[BFCP] ${data.user} stopped content share`);
    showStatus(`${data.user} stopped sharing their screen.`);
    setTimeout(hideStatus, 3000);
    expectingScreenShareFrom.delete(data.user);
    console.log('[Mapping] After delete expectingScreenShareFrom:', Array.from(expectingScreenShareFrom.entries()));
    currentContentTrackId = null;
    document.getElementById('remoteScreenShare').srcObject = null;
    document.querySelector('.remote-screen').style.display = 'none';
    return;
  }

  try {
    if (data.type === 'offer') {
      console.log(`[Signal] Received offer from ${data.user}`);
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

    } else if (data.type === 'answer') {
      console.log(`[Signal] Received answer from ${data.user}`);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'ice') {
      console.log(`[Signal] Received ICE candidate from ${data.user}`);
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
  showStatus(`User ${userId} disconnected`, false);
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

socket.on('chat-history', (messages) => {
  if (Array.isArray(messages)) {
    messages.forEach(msg => addMessageToChat(msg, msg.sender === currentUser ? 'sent' : 'received'));
  }
});

socket.on('chat-message', (msgObj) => {
  addMessageToChat(msgObj, msgObj.sender === currentUser ? 'sent' : 'received');
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

async function toggleScreenShare(withAudio = false) {
  console.log(`[toggleScreenShare] screenSharingActive=${screenSharingActive}, withAudio=${withAudio}`);

  try {
    if (!screenSharingActive) {
      const contentId = crypto.randomUUID();
      showStatus('You started sharing your screen.');
      setTimeout(hideStatus, 3000);
      console.log(`[toggleScreenShare] Starting share with contentId=${contentId}`);

      let screenStream;
      if (isIOS()) {
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          socket.emit('signal', {
            type: 'content-start',
            room,
            user: currentUser,
            contentId
          });
          await handleScreenStream(screenStream, contentId);
        } catch (error) {
          console.log('Standard screen share failed, trying iOS workaround');
          return handleIOSScreenShare();
        }
      } else {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: !!withAudio });
        socket.emit('signal', {
          type: 'content-start',
          room,
          user: currentUser,
          contentId
        });
        await handleScreenStream(screenStream, contentId);
      }
    } else {
      showStatus('You stopped sharing your screen.');
      setTimeout(hideStatus, 3000);
      await stopScreenShare();
      console.log('[toggleScreenShare] Sending BFCP content-stop');
    }
  } catch (error) {
    console.error('Error during screen sharing:', error);
    showStatus('Error sharing screen', true);
  }
}

function toggleScreenShareAudio() {
  const withAudio = document.getElementById('shareAudioCheckbox').checked;
  console.log('Screen share audio toggled:', withAudio);
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

async function handleScreenStream(stream, contentId) {
  screenStream = stream; // Save reference globally
  console.log(`[handleScreenStream] Starting local content share with contentId=${contentId}`);
  stream.getTracks().forEach(track => {
    console.log(`  Local Screen Track: kind=${track.kind}, label=${track.label}, id=${track.id}`);
    peerConnection.addTrack(track, stream);
  });

  const localShareEl = document.getElementById('localScreenShare');
  localShareEl.srcObject = stream;
  console.log(`[Video Attach] id=localScreenShare now playing stream id=${stream.id}, tracks=${stream.getTracks().map(t => t.kind+":"+t.id).join(", ")}`);

  document.querySelector('.local-screen').style.display = 'block';

  stream.getVideoTracks()[0].onended = () => {
    console.log('[handleScreenStream] Screen share track ended from browser UI');
    if (screenSharingActive) toggleScreenShare();
  };

  screenSharingActive = true;
  screenShareBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Sharing';

  await renegotiate(`Content track added (contentId=${contentId})`);
}

async function stopScreenShare(skipRenegotiate = false) {
  console.log(`[stopScreenShare] Stopping local content share`);
  document.querySelector('.local-screen').style.display = 'none';
  document.getElementById('localScreenShare').srcObject = null;

  // Stop all screen tracks to close browser UI
  if (peerConnection) {
    peerConnection.getSenders()
      .filter(sender =>
        sender.track &&
        sender.track.kind === 'video' &&
        (sender.track.label.toLowerCase().includes('screen') ||
         sender.track.label.toLowerCase().includes('display'))
      )
      .forEach(sender => {
        console.log(`  Removing screen track sender: id=${sender.track.id}`);
        peerConnection.removeTrack(sender);
      });
  }

  // Stop the actual screen stream tracks to close browser UI
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  screenSharingActive = false;
  screenShareBtn.innerHTML = '<i class="fas fa-desktop"></i> Share Screen';

  // Always send content-stop when stopping sharing
  socket.emit('signal', {
    type: 'content-stop',
    room,
    user: currentUser
  });

  if (!skipRenegotiate) {
    await renegotiate('Content track removed');
  }
}

function handleOrientationChange() {
  function adjustLayout() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      video.style.width = '100%';
      video.style.height = '100%';
    });

    // Adjust container margin if chat is open and screen is narrow
    const container = document.querySelector('.container');
    const chatContainer = document.querySelector('.chat-container');
    if (window.innerWidth < 600) {
      container.classList.remove('chat-open');
      if (chatContainer.classList.contains('open')) {
        chatContainer.style.width = '100vw';
      } else {
        chatContainer.style.width = '';
      }
    } else {
      if (chatContainer.classList.contains('open')) {
        container.classList.add('chat-open');
        chatContainer.style.width = '320px';
      } else {
        container.classList.remove('chat-open');
        chatContainer.style.width = '';
      }
    }
  }

  window.addEventListener('orientationchange', () => {
    setTimeout(adjustLayout, 100);
  });
  window.addEventListener('resize', adjustLayout);

  // Initial adjustment
  adjustLayout();
}
// Utility function for fullscreen toggle
function toggleFullscreen(videoElement, button) {
  // iOS Safari fullscreen
  if (videoElement.webkitEnterFullscreen) {
    // Ensure the correct stream is attached
    if (screenStream && videoElement.srcObject !== screenStream) {
      videoElement.srcObject = screenStream;
    }
    videoElement.webkitEnterFullscreen();
    return;
  }

  // Standard fullscreen API
  if (!document.fullscreenElement) {
    if (videoElement.requestFullscreen) {
      videoElement.requestFullscreen();
    } else if (videoElement.webkitRequestFullscreen) {
      videoElement.webkitRequestFullscreen();
    } else if (videoElement.msRequestFullscreen) {
      videoElement.msRequestFullscreen();
    }
    button.innerHTML = '<i class="fas fa-compress"></i>';
    button.title = "Exit Fullscreen";
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
    button.innerHTML = '<i class="fas fa-expand"></i>';
    button.title = "Fullscreen";
  }
}

// Listen for fullscreen change to update button icon
document.addEventListener('fullscreenchange', () => {
  const localBtn = document.getElementById('localScreenFullscreen');
  const remoteBtn = document.getElementById('remoteScreenFullscreen');
  if (!document.fullscreenElement) {
    if (localBtn) {
      localBtn.innerHTML = '<i class="fas fa-expand"></i>';
      localBtn.title = "Fullscreen";
    }
    if (remoteBtn) {
      remoteBtn.innerHTML = '<i class="fas fa-expand"></i>';
      remoteBtn.title = "Fullscreen";
    }
  }
});
// Chat functionality
function toggleChat() {
  chatContainer.classList.toggle('open');
  document.querySelector('.container').classList.toggle('chat-open');
}

function sendMessage() {
  const message = chatInput.value.trim();
  if (message) {
    const messageData = {
      text: message,
      sender: currentUser,
      timestamp: new Date().toISOString()
    };
    socket.emit('chat-message', messageData);
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

  // Show notification if chat is not open and it's a received message
  if (type === 'received' && !chatContainer.classList.contains('open')) {
    chatNotification.style.display = 'inline-block';
  }
}

// Hide indicator when chat is opened
toggleChatBtn.addEventListener('click', () => {
  chatNotification.style.display = 'none';
});

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


endCallBtn.addEventListener('click', () => {
  endCallModal.classList.remove('hidden');
});

confirmEndCallBtn.addEventListener('click', () => {
  endCallModal.classList.add('hidden');
  cleanup();
  window.location.href = '/';
});

cancelEndCallBtn.addEventListener('click', () => {
  endCallModal.classList.add('hidden');
});

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
