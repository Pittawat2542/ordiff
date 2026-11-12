import { execFile } from 'node:child_process';

const children = new Set();
export function runFile(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      children.delete(child);
      if (error) reject(error); else resolve({ stdout, stderr });
    });
    children.add(child);
  });
}
export function stopProcesses() {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
}
