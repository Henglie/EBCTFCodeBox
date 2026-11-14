// Private launcher lease. Closing parent stdin also stops HTTP and its workers.
import path from 'node:path';
import { startMcpHttpService } from './http-server.mjs';
const argv = process.argv.slice(2);
const index = argv.indexOf('--root');
if (index >= 0) { process.chdir(path.resolve(argv[index + 1])); argv.splice(index, 2); }
let service = null, stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await service?.close();
  process.stdin.destroy();
}
process.stdin.on('data', () => {});
process.stdin.on('end', () => stop().catch(() => { process.exitCode = 1; }));
process.stdin.on('error', () => stop().catch(() => {}));
process.on('SIGTERM', () => stop().catch(() => { process.exitCode = 1; }));
process.on('SIGINT', () => stop().catch(() => { process.exitCode = 1; }));
process.stdin.resume();
try {
  service = await startMcpHttpService({ argv, cwd: process.cwd() });
  if (stopping) await service?.close();
  process.stdout.write(JSON.stringify({ ok: true, enabled: !!service, url: service?.url || '', tokenRequired: !!service?.config.token }) + '\n');
  if (!service) await stop();
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
  await stop(); process.exitCode = 1;
}
