document.addEventListener('DOMContentLoaded', () => {
  const joinButton = document.getElementById('joinButton');
  const createButton = document.getElementById('createButton');
  const userNameInput = document.getElementById('userName');
  const roomIdInput = document.getElementById('roomId');

  joinButton.addEventListener('click', () => {
    const userName = userNameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    
    if (!userName) {
      alert('Please enter your name');
      return;
    }
    
    if (!roomId) {
      alert('Please enter a room ID');
      return;
    }
    
    // Store the user name in session storage
    sessionStorage.setItem('userName', userName);
    window.location.href = `/${roomId}`;
  });

  createButton.addEventListener('click', () => {
    const userName = userNameInput.value.trim();
    
    if (!userName) {
      alert('Please enter your name');
      return;
    }
    
    // Store the user name in session storage
    sessionStorage.setItem('userName', userName);
    window.location.href = '/new';
  });
});
