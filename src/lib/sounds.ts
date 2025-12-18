// 거래 알림 효과음

const audioContext = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

// 귀여운 진입 알림음 (상승 멜로디)
export function playEntrySound() {
  if (!audioContext) return;
  
  // AudioContext가 suspended 상태면 resume
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 3음 상승 멜로디 (도-미-솔)
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  
  notes.forEach((freq, i) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.value = freq;
    
    const startTime = now + i * 0.12;
    const duration = 0.15;
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  });
}

// 익절 알림음 (승리 팡파레)
export function playTpSound() {
  if (!audioContext) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 짧은 승리 멜로디
  const notes = [783.99, 987.77, 1174.66]; // G5, B5, D6
  
  notes.forEach((freq, i) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'triangle';
    oscillator.frequency.value = freq;
    
    const startTime = now + i * 0.1;
    const duration = 0.2;
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  });
}

// 손절 알림음 (하강 톤)
export function playSlSound() {
  if (!audioContext) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 하강 2음
  const notes = [392.00, 293.66]; // G4, D4
  
  notes.forEach((freq, i) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = freq;
    
    const startTime = now + i * 0.15;
    const duration = 0.2;
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  });
}
