// SNAPSHOT THE ARRANGEMENT BACK OUT OF LIVE.
//
// Once notes have been edited by hand in Live, Live is the source of truth
// and arrange.mjs is a history. This pulls every arrangement clip's notes
// back over the socket into song.live.json so the tweaked version is in the
// repo, diffable, and re-pushable — instead of living only in a .als.
//
//   node snapshot-from-live.mjs        -> song.live.json (+ a diff vs arrange.mjs)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { SONG } from './arrange.mjs';

function send(type, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: 9877 });
    let buf = '';
    sock.setTimeout(30000, () => { sock.destroy(); reject(new Error(`${type}: timeout`)); });
    sock.on('connect', () => sock.write(JSON.stringify({ type, params })));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      try { const r = JSON.parse(buf); sock.end(); r.status === 'error' ? reject(new Error(r.message)) : resolve(r.result ?? r); } catch {}
    });
    sock.on('error', reject);
  });
}

const key = (e) => `${e.pitch}@${(+e.start).toFixed(3)}`;

const info = await send('get_session_info');
const out = {};
let changed = 0;
for (let ti = 0; ti < info.track_count; ti++) {
  const t = await send('get_track_info', { track_index: ti });
  const clips = (await send('get_arrangement_clips', { track_index: ti })).clips ?? [];
  const song = clips.find((c) => /Service Starts Now/.test(c.name));
  if (!song) continue;
  const r = await send('get_arrangement_clip_notes', { track_index: ti, clip_index: clips.indexOf(song) });
  const notes = (r.notes ?? []).map((e) => ({ pitch: e.pitch, start: e.start_time, dur: e.duration, vel: Math.round(e.velocity) }));
  out[t.name] = { track: ti, clip: song.name, notes };

  // diff against what arrange.mjs would have produced
  const part = song.name.replace('Service Starts Now — ', '');
  const ref = SONG[part]?.notes ?? [];
  const refKeys = new Map(ref.map((e) => [key(e), e]));
  const liveKeys = new Map(notes.map((e) => [key(e), e]));
  const added = notes.filter((e) => !refKeys.has(key(e)));
  const removed = ref.filter((e) => !liveKeys.has(key(e)));
  const moved = notes.filter((e) => refKeys.has(key(e)) && (Math.abs(refKeys.get(key(e)).dur - e.dur) > 1e-3 || Math.abs(refKeys.get(key(e)).vel - e.vel) > 0));
  const n = added.length + removed.length + moved.length;
  changed += n;
  console.log(`${t.name.padEnd(26)} ${String(notes.length).padStart(5)} notes   +${added.length} −${removed.length} ~${moved.length}`);
}
const file = path.join(path.dirname(new URL(import.meta.url).pathname), 'song.live.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`\nwrote ${path.basename(file)} — ${changed} note(s) differ from arrange.mjs (Live's dedup of stacked drum hits accounts for 24 of the drum '−')`);
