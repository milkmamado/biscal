import { useState, useEffect, useCallback } from 'react';

export const useWakeLock = (enabled: boolean) => {
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported('wakeLock' in navigator);
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!isSupported) return;
    
    try {
      const lock = await navigator.wakeLock.request('screen');
      setWakeLock(lock);
      console.log('[WakeLock] 화면 절전 방지 활성화');
      
      lock.addEventListener('release', () => {
        console.log('[WakeLock] 해제됨');
        setWakeLock(null);
      });
    } catch (err) {
      console.log('[WakeLock] 요청 실패:', err);
    }
  }, [isSupported]);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLock) {
      await wakeLock.release();
      setWakeLock(null);
      console.log('[WakeLock] 수동 해제');
    }
  }, [wakeLock]);

  // 자동매매 활성화 시 Wake Lock 요청
  useEffect(() => {
    if (enabled && isSupported) {
      requestWakeLock();
    } else if (!enabled && wakeLock) {
      releaseWakeLock();
    }
  }, [enabled, isSupported]);

  // 탭이 다시 visible 될 때 Wake Lock 재요청
  useEffect(() => {
    if (!enabled || !isSupported) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLock) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, isSupported, wakeLock, requestWakeLock]);

  return {
    isActive: !!wakeLock,
    isSupported,
  };
};
