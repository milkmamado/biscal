// 거래 알림 효과음 - 모던 & 세련된 버전

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

// 부드러운 차임 생성 헬퍼
function createChime(freq: number, startTime: number, duration: number, volume: number = 0.15) {
  if (!audioContext) return;
  
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  
  // 부드러운 사인파 + 로우패스 필터
  osc.type = 'sine';
  osc.frequency.value = freq;
  
  filter.type = 'lowpass';
  filter.frequency.value = 2000;
  filter.Q.value = 1;
  
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  
  // 부드러운 어택 & 디케이 (ADSR 엔벨로프)
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(volume * 0.3, startTime + duration * 0.4);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// 진입 알림음 - 부드러운 2음 노티피케이션 (Slack 스타일)
export function playEntrySound() {
  if (!audioContext || !isAudioEnabled) {
    console.log('[Sound] AudioContext not ready');
    return;
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 부드러운 2음 (낮은음 → 높은음)
  createChime(880, now, 0.25, 0.12);        // A5
  createChime(1108.73, now + 0.12, 0.3, 0.15); // C#6
  
  console.log('[Sound] Entry sound played');
}

// 익절 알림음 - 상쾌한 성공 차임 (iOS 결제 완료 스타일)
export function playTpSound() {
  if (!audioContext || !isAudioEnabled) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 깔끔한 3음 상승 아르페지오
  createChime(987.77, now, 0.2, 0.1);          // B5
  createChime(1318.51, now + 0.08, 0.25, 0.12); // E6
  createChime(1567.98, now + 0.16, 0.35, 0.14); // G6
  
  // 살짝 하모닉 추가 (풍성한 느낌)
  createChime(1975.53, now + 0.2, 0.4, 0.05);  // B6 (약하게)
  
  console.log('[Sound] TP sound played');
}

// 손절 알림음 - 부드러운 알림 (경고지만 불쾌하지 않게)
export function playSlSound() {
  if (!audioContext || !isAudioEnabled) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  
  // 낮은 2음 하강 (부드럽게)
  createChime(523.25, now, 0.2, 0.1);       // C5
  createChime(392.00, now + 0.12, 0.3, 0.08); // G4
  
  console.log('[Sound] SL sound played');
}

// 시그널 감지 알림음 - 미니멀한 팅 (선택적)
export function playSignalSound() {
  if (!audioContext || !isAudioEnabled) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  const now = audioContext.currentTime;
  createChime(1760, now, 0.15, 0.08); // A6 (부드럽게 한 번)
  
  console.log('[Sound] Signal sound played');
}

// 테스트용 비프음
export function playTestBeep() {
  initAudio();
  if (!audioContext) return;
  
  const now = audioContext.currentTime;
  createChime(880, now, 0.2, 0.15);
  
  console.log('[Sound] Test beep played');
}
