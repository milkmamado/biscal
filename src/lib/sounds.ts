// 거래 알림 효과음

let audioContext: AudioContext | null = null;
let isAudioEnabled = false;

// AudioContext 초기화 (사용자 상호작용 시 호출 필요)
export function initAudio() {
  if (audioContext) {
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    isAudioEnabled = true;
    return true;
  }
  
  try {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    isAudioEnabled = true;
    console.log('[Sound] AudioContext initialized');
    return true;
  } catch (e) {
    console.error('[Sound] AudioContext 초기화 실패:', e);
    return false;
  }
}

// 귀여운 진입 알림음 (상승 멜로디)
export function playEntrySound() {
  if (!audioContext || !isAudioEnabled) {
    console.log('[Sound] AudioContext not ready');
    return;
  }
  
  // AudioContext가 suspended 상태면 resume
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 3음 상승 멜로디 (도-미-솔)
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  
  notes.forEach((freq, i) => {
    const oscillator = audioContext!.createOscillator();
    const gainNode = audioContext!.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext!.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.value = freq;
    
    const startTime = now + i * 0.12;
    const duration = 0.15;
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.4, startTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  });
  
  console.log('[Sound] Entry sound played');
}

// 익절 알림음 (승리 팡파레)
export function playTpSound() {
  if (!audioContext || !isAudioEnabled) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 짧은 승리 멜로디
  const notes = [783.99, 987.77, 1174.66]; // G5, B5, D6
  
  notes.forEach((freq, i) => {
    const oscillator = audioContext!.createOscillator();
    const gainNode = audioContext!.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext!.destination);
    
    oscillator.type = 'triangle';
    oscillator.frequency.value = freq;
    
    const startTime = now + i * 0.1;
    const duration = 0.2;
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.35, startTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  });
  
  console.log('[Sound] TP sound played');
}

// 손절 알림음 (하강 톤)
export function playSlSound() {
  if (!audioContext || !isAudioEnabled) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 하강 2음
  const notes = [392.00, 293.66]; // G4, D4
  
  notes.forEach((freq, i) => {
    const oscillator = audioContext!.createOscillator();
    const gainNode = audioContext!.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext!.destination);
    
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = freq;
    
    const startTime = now + i * 0.15;
    const duration = 0.2;
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  });
  
  console.log('[Sound] SL sound played');
}

// 테스트용 비프음
export function playTestBeep() {
  initAudio();
  if (!audioContext) return;
  
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.type = 'sine';
  oscillator.frequency.value = 880;
  
  const now = audioContext.currentTime;
  gainNode.gain.setValueAtTime(0.3, now);
  gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
  
  oscillator.start(now);
  oscillator.stop(now + 0.1);
  
  console.log('[Sound] Test beep played');
}
