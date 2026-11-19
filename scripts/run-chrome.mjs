// Chrome engine entry: node run-chrome.mjs /abs/path/task.json
import { run } from './runner.mjs';
import { openDoc } from './chrome.mjs';
const taskFile = process.argv[2];
if (!taskFile || !taskFile.endsWith('.json')) { console.error('usage: node run-chrome.mjs /abs/path/task.json'); process.exit(2); }
try {
  await run({ taskFile, openDoc });
  process.exit(0);
} catch (e) {
  console.log('FATAL', e.message);
  process.exit(1);
}
