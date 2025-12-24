import { useState, useEffect, useRef } from 'react';

export const useWakeLock = (enabled: boolean) => {
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    if (!isSupported) return;

    const requestWakeLock = async () => {
      try {
        if (wakeLockRef.current) return;
        
        const lock = await navigator.wakeLock.request('screen');
        wakeLockRef.current = lock;
        setIsActive(true);
        console.log('[WakeLock] 화면 절전 방지 활성화');

        lock.addEventListener('release', () => {
          wakeLockRef.current = null;
          setIsActive(false);
          console.log('[WakeLock] 해제됨');
        });
      } catch (err) {
        console.log('[WakeLock] 요청 실패:', err);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
          setIsActive(false);
          console.log('[WakeLock] 수동 해제');
        } catch (err) {
          console.log('[WakeLock] 해제 실패:', err);
        }
      }
    };

    if (enabled) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (enabled && document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [enabled, isSupported]);

  return { isActive, isSupported };
};
