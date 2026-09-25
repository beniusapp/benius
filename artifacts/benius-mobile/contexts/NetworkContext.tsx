import React, { createContext, useContext, useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';
const Context = createContext({ online: true });
export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web') {
      setOnline(navigator.onLine);
      const update = () => setOnline(navigator.onLine);
      window.addEventListener('online', update); window.addEventListener('offline', update);
      return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
    }
    return NetInfo.addEventListener(state => setOnline(state.isConnected !== false && state.isInternetReachable !== false));
  }, []);
  return <Context.Provider value={{ online }}>{children}</Context.Provider>;
}
export function useNetwork() { return useContext(Context); }