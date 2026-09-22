// مرجع مشترك لـ Socket.io حتى تتمكن الخدمات (إشعارات، جدولة) من البث دون استيراد دائري
import type { Server } from "socket.io";

let io: Server | null = null;
export const setIO = (s: Server) => {
  io = s;
};
export const getIO = () => io;
export const emitToUser = (userId: string, event: string, payload: unknown) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToSession = (bookingId: string, event: string, payload: unknown) => io?.to(`session:${bookingId}`).emit(event, payload);
