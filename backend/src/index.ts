// نقطة الدخول: Express + Socket.io + أجهزة + مجدوِل
import http from "http";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { createApp } from "./app";
import { prisma } from "./db";
import { attachGateway } from "./remote/gateway";
import { initDevices, shutdownDevices } from "./remote/deviceManager";
import { schedulerTick } from "./remote/sessions";
import { finalizeExpiredAttempts } from "./quiz/service";

async function main() {
  fs.mkdirSync(path.join(config.storageDir, "reports"), { recursive: true });
  await prisma.$connect();
  const server = http.createServer(createApp());
  attachGateway(server);
  await initDevices();

  // المجدوِل: يفعّل الحجوزات وينهي الجلسات المنتهية ويغلق محاولات الكويز المنتهية مهلتها
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await schedulerTick();
      await finalizeExpiredAttempts();
    } catch (e) {
      console.error("[scheduler]", e);
    } finally {
      busy = false;
    }
  }, 1000);

  server.listen(config.port, () => console.log(`API + WebSocket on http://localhost:${config.port}`));

  const stop = async () => {
    clearInterval(timer);
    server.close();
    await shutdownDevices();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
