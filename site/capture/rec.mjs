// Record a clip of the page via CDP screencast, cropped to a page-coordinate box, encoded with ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function record(page, name, fn, box, { vw, vh } = {}) {
  const s = await page.context().newCDPSession(page);
  const frames = [];
  s.on('Page.screencastFrame', async (e) => {
    frames.push({ data: e.data, t: e.metadata.timestamp });
    s.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  });
  await s.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 4000, maxHeight: 3000, everyNthFrame: 1 });
  await fn();
  await s.send('Page.stopScreencast');
  await page.waitForTimeout(300);
  const dir = path.resolve(`frames-${name}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  let list = '';
  frames.forEach((fr, i) => {
    const f = path.join(dir, `${String(i).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(fr.data, 'base64'));
    const dur = i + 1 < frames.length ? Math.max(frames[i + 1].t - fr.t, 0.001) : 0.1;
    list += `file '${f}'\nduration ${dur.toFixed(4)}\n`;
  });
  const last = path.join(dir, `${String(frames.length - 1).padStart(5, '0')}.jpg`);
  list += `file '${last}'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  // Scale page coords to frame pixels.
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', last]).toString().trim();
  const [fw] = probe.split(',').map(Number);
  const k = fw / vw;
  const even = (n) => Math.floor(n / 2) * 2;
  const crop = `crop=${even(box.width * k)}:${even(box.height * k)}:${Math.round(box.x * k)}:${Math.round(box.y * k)}`;
  const out = path.resolve(`clip-${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', `${crop},fps=30,scale='min(1920,iw)':-2:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]);
  console.log(`clip ${name}: ${frames.length} frames, frame width ${fw}, ${crop} -> ${out}`);
  return out;
}
