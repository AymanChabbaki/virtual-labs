"use client";
// اتصال Socket.io واحد للتطبيق: إشعارات لحظية + جلسات التحكم عن بُعد
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, getToken } from "./api";
import { useAuth } from "./auth";

const Ctx = createContext<{ socket: Socket | null; connected: boolean }>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const ref = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) return;
    const s = io(API_URL, { auth: (cb) => cb({ token: getToken() }), transports: ["websocket", "polling"], reconnectionDelayMax: 5000 });
    ref.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    setSocket(s);
    return () => {
      s.close();
      ref.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ socket, connected }}>{children}</Ctx.Provider>;
}

export const useSocket = () => useContext(Ctx);

/** يرسل حدثاً وينتظر ack */
export const emitAck = <T = any,>(s: Socket, ev: string, msg: unknown) => new Promise<T>((res) => s.emit(ev, msg, res));
