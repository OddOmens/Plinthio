import { spawn } from 'child_process';

// Runs a short-lived probe (ffprobe) and collects what it prints. Resolves { code, stdout }
// once it exits, or null if it couldn't start, errored, or ran past timeoutMs (it's killed
// then). Never rejects, so callers can fall back to their own "unknown" value.
export function runProbe(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let proc;
    const timer = setTimeout(() => {
      try { proc?.kill('SIGKILL'); } catch (e) { /* already gone */ }
      done(null);
    }, timeoutMs);

    try {
      proc = spawn(cmd, args);
    } catch (e) {
      return done(null);
    }

    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', () => { /* ignore */ });
    proc.on('error', () => done(null));
    proc.on('close', (code) => done({ code, stdout }));
  });
}
