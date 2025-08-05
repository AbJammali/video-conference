const socket = io();
const room = window.location.pathname.split('/').pop();
socket.emit('join', room);

const peerConnection = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
  localVideo.srcObject = stream;
  stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
});

peerConnection.ontrack = event => {
  remoteVideo.srcObject = event.streams[0];
};

peerConnection.onicecandidate = event => {
  if (event.candidate) {
    socket.emit('signal', { type: 'ice', candidate: event.candidate });
  }
};

socket.on('user-connected', async () => {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('signal', { type: 'offer', offer });
});

socket.on('signal', async data => {
  if (data.type === 'offer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('signal', { type: 'answer', answer });
  } else if (data.type === 'answer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } else if (data.type === 'ice') {
    try {
      await peerConnection.addIceCandidate(data.candidate);
    } catch (e) {
      console.error(e);
    }
  }
});
const qualityIndicator = document.getElementById('qualityIndicator');

// Monitor call stats every 2 seconds
setInterval(async () => {
  if (!peerConnection) return;

  const stats = await peerConnection.getStats(null);
  let rtt = null;

  stats.forEach(report => {
    if (report.type === "remote-inbound-rtp" && report.kind === "video") {
      if (report.roundTripTime) {
        rtt = report.roundTripTime * 1000; // convert to ms
      }
    }
  });

  if (rtt !== null) {
    updateCallQualityUI(rtt);
  }
}, 2000);

// Update icon based on RTT
function updateCallQualityUI(rtt) {
  if (rtt < 150) {
    qualityIndicator.textContent = '📶🟢';
    qualityIndicator.title = `Good (${rtt.toFixed(0)}ms RTT)`;
  } else if (rtt < 300) {
    qualityIndicator.textContent = '📶🟡';
    qualityIndicator.title = `Fair (${rtt.toFixed(0)}ms RTT)`;
  } else {
    qualityIndicator.textContent = '📶🔴';
    qualityIndicator.title = `Poor (${rtt.toFixed(0)}ms RTT)`;
  }
}

