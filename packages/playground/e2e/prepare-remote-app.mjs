import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Generate Studio with the supported dev command once before uploading tests.
// The server is stopped here; applications run beside the remote browsers.
const child = spawn('pnpm', ['dev'], {
  cwd: fileURLToPath(new URL('./kitchen-sink', import.meta.url)),
  detached: true,
  env: { ...process.env, PORT: '4211' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Studio preparation server exited');
    try {
      const response = await fetch('http://127.0.0.1:4211/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Studio preparation server did not become ready');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    process.kill(-child.pid, 'SIGTERM');
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }, 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
  }
}
