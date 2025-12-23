import { useState, useEffect, useCallback, useRef } from 'react';

export const useWakeLock = (enabled: boolean) => {
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    setIsSupported('wakeLock' in navigator);
    
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!isSupported || !isMountedRef.current) return;
    
    try {
      const lock = await navigator.wakeLock.request('screen');
      
      if (!isMountedRef.current) {
        // 컴포넌트가 언마운트됨 - 바로 해제
        await lock.release();
        return;
      }
      
      setWakeLock(lock);
      console.log('[WakeLock] 화면 절전 방지 활성화');
      
      lock.addEventListener('release', () => {
        console.log('[WakeLock] 해제됨');
        if (isMountedRef.current) {
          setWakeLock(null);
        }
      });
    } catch (err) {
      console.log('[WakeLock] 요청 실패:', err);
    }
  }, [isSupported]);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLock) {
      try {
        await wakeLock.release();
        if (isMountedRef.current) {
          setWakeLock(null);
        }
        console.log('[WakeLock] 수동 해제');
      } catch (err) {
        console.log('[WakeLock] 해제 실패:', err);
      }
    }
  }, [wakeLock]);

  // 자동매매 활성화 시 Wake Lock 요청
  useEffect(() => {
    if (enabled && isSupported) {
      requestWakeLock();
    } else if (!enabled && wakeLock) {
      releaseWakeLock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isSupported]);

  // 언마운트 시 Wake Lock 해제
  useEffect(() => {
    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, [wakeLock]);

  // 탭이 다시 visible 될 때 Wake Lock 재요청
  useEffect(() => {
    if (!enabled || !isSupported) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLock && isMountedRef.current) {
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
