document.addEventListener('DOMContentLoaded', () => {
  const joinButton = document.getElementById('joinButton');
  const createButton = document.getElementById('createButton');
  const userNameInput = document.getElementById('userName');
  const roomIdInput = document.getElementById('roomId');
  const deviceTestContainer = document.getElementById('deviceTestContainer');
  const closeDeviceTestBtn = document.getElementById('closeDeviceTestBtn');
  const confirmJoinBtn = document.getElementById('confirmJoinBtn');
  const joinForm = document.getElementById('joinForm');

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
  if (joinForm.checkValidity()) {
    toggleDeviceTest(true);
    enumerateDevices();
  } else {
    joinForm.reportValidity();
  }
});

    createButton.addEventListener('click', () => {
  if (userNameInput.value.trim()) {
    sessionStorage.setItem('userName', userNameInput.value.trim());
    toggleDeviceTest(true);
    enumerateDevices();
  } else {
    userNameInput.reportValidity();
  }
});

  closeDeviceTestBtn.addEventListener('click', () => {
    deviceTestContainer.classList.add('hidden');
    if (previewStream) previewStream.getTracks().forEach(track => track.stop());
  });

  confirmJoinBtn.addEventListener('click', () => {
    const userName = userNameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    if (!userName) {

      return;
    }
    sessionStorage.setItem('userName', userName);
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('cameraId', cameraSelect.value);
    sessionStorage.setItem('micId', micSelect.value);
    sessionStorage.setItem('speakerId', speakerSelect.value);
    if (roomId) {
    // Join existing room
    sessionStorage.setItem('roomId', roomId);
    window.location.href = `/${roomId}`;
  } else {
    // Create new room
    window.location.href = '/new';
  }
});

});

let previewStream;
const cameraSelect = document.getElementById('cameraSelect');
const micSelect = document.getElementById('micSelect');
const speakerSelect = document.getElementById('speakerSelect');
const cameraPreview = document.getElementById('cameraPreview');
const micLevel = document.getElementById('micLevel');
const testMicBtn = document.getElementById('testMicBtn');
const testSpeakerBtn = document.getElementById('testSpeakerBtn');

async function enumerateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  cameraSelect.innerHTML = '';
  micSelect.innerHTML = '';
  speakerSelect.innerHTML = '';

  let videoCount = 1, audioInCount = 1, audioOutCount = 1;
  const seenIds = new Set();

  devices.forEach(device => {
    if (seenIds.has(device.deviceId)) return;
    seenIds.add(device.deviceId);

    const option = document.createElement('option');
    option.value = device.deviceId;

    if (device.kind === 'videoinput') {
      option.text = device.label || `Camera ${videoCount++}`;
      cameraSelect.appendChild(option);
    }
    if (device.kind === 'audioinput') {
      option.text = device.label || `Microphone ${audioInCount++}`;
      micSelect.appendChild(option);
    }
    if (device.kind === 'audiooutput') {
      option.text = device.label || `Speaker ${audioOutCount++}`;
      speakerSelect.appendChild(option);
    }
  });
}

async function startPreview() {
  if (previewStream) {
    previewStream.getTracks().forEach(track => track.stop());
  }
  const constraints = {
    video: { deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined },
    audio: { deviceId: micSelect.value ? { exact: micSelect.value } : undefined }
  };
  previewStream = await navigator.mediaDevices.getUserMedia(constraints);
  cameraPreview.srcObject = previewStream;
}

cameraSelect.addEventListener('change', () => {
  if (previewStream) {
    // restart preview with new device only if preview is enabled
    previewStream.getTracks().forEach(track => track.stop());
    navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: cameraSelect.value } }
    }).then(stream => {
      previewStream = stream;
      cameraPreview.srcObject = stream;
    });
  }
});
const toggleCameraPreviewBtn = document.getElementById('toggleCameraPreviewBtn');

let previewEnabled = false;

toggleCameraPreviewBtn.addEventListener('click', async () => {
  const topLeft = document.querySelector('.half.top-left');
  const bottomRight = document.querySelector('.half.bottom-right');
  if (!previewEnabled) {
    // --- Enable preview ---
    try {
      const constraints = {
        video: { deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined }
      };
      previewStream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraPreview.srcObject = previewStream;

      // Remove backgrounds
      if (topLeft) topLeft.style.backgroundImage = 'none';
      if (bottomRight) bottomRight.style.backgroundImage = 'none';

      toggleCameraPreviewBtn.innerHTML = '<i class="fa fa-eye-slash"></i>';
      previewEnabled = true;
    } catch (err) {
      console.error('Error starting camera preview:', err);
      alert('Unable to access camera');
    }
  } else {
    // --- Disable preview ---
    if (previewStream) {
      previewStream.getTracks().forEach(track => track.stop());
      previewStream = null;
    }
    cameraPreview.srcObject = null;

    // Restore backgrounds
    if (topLeft) topLeft.style.backgroundImage = "url('/image/logo-silver.png')";
    if (bottomRight) bottomRight.style.backgroundImage = "url('/image/logo-gold.png')";

    toggleCameraPreviewBtn.innerHTML = '<i class="fa fa-eye"></i>';
    previewEnabled = false;
  }
});

testMicBtn.addEventListener('click', async () => {
    const icon = testMicBtn.querySelector('i');
    if (icon.classList.contains('fa-stop')) return;
    icon.classList.remove('fa-play');
    icon.classList.add('fa-stop');
  let audioTrack;
  if (previewStream && previewStream.getAudioTracks().length) {
    audioTrack = previewStream.getAudioTracks()[0];
  } else {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micSelect.value ? { exact: micSelect.value } : undefined }
      });
      audioTrack = audioStream.getAudioTracks()[0];
    } catch (err) {
      alert('Unable to access microphone');
      icon.classList.remove('fa-stop');
      icon.classList.add('fa-play');
      return;
    }
  }

  if (audioTrack) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
    source.connect(analyser);
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const barsContainer = document.getElementById('micStrengthBars');
    const segments = barsContainer.querySelectorAll('.strength-segment');
    const segmentCount = segments.length;

    const gradients = [
      'linear-gradient(to right, #BF953F, #FCF6BA)',
      'linear-gradient(to right, #FCF6BA, #B38728, #FBF5B7)',
      'linear-gradient(to right, #FBF5B7, #AA771C)',
      'linear-gradient(to right, #AA771C, #BF953F)',
      'linear-gradient(to right, #BF953F, #FCF6BA, #B38728, #FBF5B7, #AA771C)'
    ];

    let animationId; // store frame id
    let running = true;

    function updateLevel() {
      if (!running) return; // stop loop when test ends
      analyser.getByteFrequencyData(dataArray);
      const level = Math.max(...dataArray);
      micLevel.textContent = `Mic Level: ${level}`;
      const activeSegments = Math.round((level / 255) * segmentCount);
      segments.forEach((seg, i) => {
        seg.style.background = i < activeSegments
          ? gradients[i % gradients.length]
          : '#eee';
      });
      animationId = requestAnimationFrame(updateLevel);
    }

    updateLevel();

    // stop after 3s
    setTimeout(() => {
      running = false; // stop loop
      cancelAnimationFrame(animationId);
      audioCtx.close();
      micLevel.textContent = ''; // clear text
      segments.forEach(seg => seg.style.background = '#eee');
      icon.classList.remove('fa-stop');
      icon.classList.add('fa-play');
    }, 3000);
  }
});

testSpeakerBtn.addEventListener('click', () => {
  const icon = testSpeakerBtn.querySelector('i');
  if (icon.classList.contains('fa-stop')) return;
  icon.classList.remove('fa-play');
  icon.classList.add('fa-stop');
  const audio = new Audio('/audio/test-tone.mp3');
  if ('sinkId' in audio && speakerSelect.value) {
    audio.setSinkId(speakerSelect.value).catch(() => {});
  }
  audio.play();
  audio.addEventListener('ended', () => {
    icon.classList.remove('fa-stop');
    icon.classList.add('fa-play');
  });
  audio.addEventListener('error', () => {
    icon.classList.remove('fa-stop');
    icon.classList.add('fa-play');
  });
});


function toggleDeviceTest(open) {
  const deviceTestContainer = document.getElementById('deviceTestContainer');
  const container = document.querySelector('.container');
  if (open) {
    deviceTestContainer.classList.remove('hidden');
    deviceTestContainer.classList.add('open');
    // Responsive adjustment
    if (window.innerWidth >= 600) {
      container.classList.add('device-test-open');
    } else {
      container.classList.remove('device-test-open');
    }
  } else {
    deviceTestContainer.classList.add('hidden');
    deviceTestContainer.classList.remove('open');
    container.classList.remove('device-test-open');
    deviceTestContainer.style.width = '';
  }
}

// Close device test panel
document.getElementById('closeDeviceTestBtn').addEventListener('click', () => {
  toggleDeviceTest(false);
  if (previewStream) previewStream.getTracks().forEach(track => track.stop());
});

// Responsive adjustment on resize/orientation
window.addEventListener('resize', () => {
  const deviceTestContainer = document.getElementById('deviceTestContainer');
  if (deviceTestContainer.classList.contains('open')) {
    toggleDeviceTest(true);
  }
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    const deviceTestContainer = document.getElementById('deviceTestContainer');
    if (deviceTestContainer.classList.contains('open')) {
      toggleDeviceTest(true);
    }
  }, 100);
});
