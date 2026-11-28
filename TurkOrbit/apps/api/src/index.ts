import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { purgeExpired } from './modules/auth/repository.js';
import { createRuntime } from './runtime.js';

const config = loadConfig();
const rt = createRuntime(config);
const { app, market } = await buildApp(rt);

// Süresi geçmiş anahtar ve eski oturum kayıtlarını saatlik temizle.
const purgeTimer = setInterval(() => {
  purgeExpired(rt.db).catch((err) => app.log.error({ err }, 'temizlik görevi başarısız'));
}, 60 * 60 * 1000);
purgeTimer.unref();

// Aşama 11: açık artırma dönemlerini oluştur ve süresi dolanları sonuçlandır (10 sn'de bir; birden çok süreçte güvenli).
market.startScheduler(10_000);

async function shutdown(signal: string) {
  app.log.info({ signal }, 'kapatılıyor');
  clearInterval(purgeTimer);
  market.stopScheduler();
  await app.close();
  await rt.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
app.log.info(`Türk Orbit API ${config.env} modunda http://${config.host}:${config.port}/api/v1 adresinde çalışıyor`);
