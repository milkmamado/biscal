import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// 캐시 버전 관리 - 버전 변경 시 localStorage 클리어
const CACHE_VERSION = "v2.3.0";
const storedVersion = localStorage.getItem("app_cache_version");

if (storedVersion !== CACHE_VERSION) {
  console.log(`🧹 캐시 클리어: ${storedVersion} -> ${CACHE_VERSION}`);
  // 인증 관련 키는 유지하고 나머지만 클리어
  const authKeys = ['sb-tgeirzouddzxiuxztdys-auth-token'];
  const keysToKeep: Record<string, string> = {};
  
  authKeys.forEach(key => {
    const value = localStorage.getItem(key);
    if (value) keysToKeep[key] = value;
  });
  
  localStorage.clear();
  
  Object.entries(keysToKeep).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });
  
  localStorage.setItem("app_cache_version", CACHE_VERSION);
}

createRoot(document.getElementById("root")!).render(<App />);
