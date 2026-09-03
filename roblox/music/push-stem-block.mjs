// PUSH THE STEM BLOCK: the plain 8-bar loop, all parts at once, after the song.
//
// The game's four stems are rendered from ONE 8-bar window in which every part
// plays its plain loop. The arrangement has no such window — the clock and
// the riser never coincide in it — so this lays one down at bar 113, clear of
// the song's ring-out, purely for rendering. Render as Loop, bars 113-120.
//
//   node push-stem-block.mjs
import net from 'node:net';
import { STEMS } from './compose.mjs';

const START_BAR = 113;
const start = (START_BAR - 1) * 4; // beats
const LEN = 32;

const TRACK_FOR = {
  'base — bass': STEMS.base[0].notes,
  'base — comp (Rhodes)': STEMS.base[1].notes,
  'base — shaker (SIZZLE)': STEMS.base[2].notes,
  'groove — drums+kitchen': STEMS.groove[0].notes,
  'melody — lead': STEMS.melody[0].notes,
  'tension — clock (ride)': STEMS.tension[0].notes,
  'tension — riser': STEMS.tension[1].notes,
};

function send(type, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: 9877 });
    let buf = '';
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error(`${type}: timeout`)); });
    sock.on('connect', () => sock.write(JSON.stringify({ type, params })));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      try { const r = JSON.parse(buf); sock.end(); r.status === 'error' ? reject(new Error(`${type}: ${r.message}`)) : resolve(r.result ?? r); } catch {}
    });
    sock.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const info = await send('get_session_info');
const names = [];
for (let i = 0; i < info.track_count; i++) names.push((await send('get_track_info', { track_index: i })).name);

for (const [name, notes] of Object.entries(TRACK_FOR)) {
  const ti = names.indexOf(name);
  if (ti < 0) throw new Error(`no track "${name}" (have: ${names.join(' | ')})`);
  await send('create_clip_in_arrangement', { track_index: ti, start_time: start, length: LEN });
  await sleep(150);
  const clips = (await send('get_arrangement_clips', { track_index: ti })).clips ?? [];
  const ci = clips.findIndex((c) => Math.abs(c.start_time - start) < 1e-6);
  if (ci < 0) throw new Error(`clip not found on ${name}`);
  const payload = notes.map((e) => ({ pitch: e.pitch, start_time: e.start, duration: e.dur, velocity: e.vel, mute: false }));
  for (let i = 0; i < payload.length; i += 300) {
    await send('add_notes_to_arrangement_clip', { track_index: ti, clip_index: ci, notes: payload.slice(i, i + 300) });
    await sleep(100);
  }
  try { await send('set_arrangement_clip_name', { track_index: ti, clip_index: ci, name: `STEM BLOCK — ${name.split('— ')[1]}` }); } catch {}
  console.log(`${name.padEnd(26)} track ${ti}  ${payload.length} notes at bar ${START_BAR}`);
}
try { await send('create_cue_point', { time: start }); } catch {}
console.log(`\nstem block at bars ${START_BAR}-${START_BAR + 7}. Render as Loop, start ${START_BAR}.1.1, length 8.0.0.`);
