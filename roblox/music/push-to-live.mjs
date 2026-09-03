// PUSH THE ARRANGEMENT INTO LIVE.
//
// Talks straight to the AbletonMCP Remote Script on localhost:9877 — the same
// JSON-over-TCP the MCP server uses — and lays the whole song into Arrangement
// view: one long clip per track, notes in chunks. Doing it through the MCP
// tools would be ~40 round trips; this is one run.
//
//   node push-to-live.mjs            # push song-v1 (from arrange.mjs)
//   node push-to-live.mjs --dry      # print what would be sent
//
// Track indices are LOOKED UP BY NAME, not assumed, because the set has been
// re-ordered more than once this session.
import net from 'node:net';
import { SONG, SONG_BEATS, SECTIONS, bar } from './arrange.mjs';

const DRY = process.argv.includes('--dry');
const CHUNK = 300;

// arrange.mjs part name -> the Live track name it belongs on
const TRACK_FOR = {
  'bass': 'base — bass',
  'comp (Rhodes)': 'base — comp (Rhodes)',
  'shaker (SIZZLE)': 'base — shaker (SIZZLE)',
  'drums+kitchen': 'groove — drums+kitchen',
  'lead': 'melody — lead',
  'clock (ride)': 'tension — clock (ride)',
  'riser': 'tension — riser',
};

function send(type, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: 9877 });
    let buf = '';
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error(`${type}: timeout`)); });
    sock.on('connect', () => sock.write(JSON.stringify({ type, params })));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      try {
        const r = JSON.parse(buf);
        sock.end();
        if (r.status === 'error') reject(new Error(`${type}: ${r.message}`));
        else resolve(r.result ?? r);
      } catch { /* incomplete, keep reading */ }
    });
    sock.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. map names -> indices
  const info = await send('get_session_info');
  const tracks = [];
  for (let i = 0; i < info.track_count; i++) {
    const t = await send('get_track_info', { track_index: i });
    tracks.push(t.name);
  }
  const index = {};
  for (const [part, want] of Object.entries(TRACK_FOR)) {
    const i = tracks.indexOf(want);
    if (i < 0) throw new Error(`no track named "${want}" in the set (have: ${tracks.join(' | ')})`);
    index[part] = i;
  }
  console.log('tracks:', Object.entries(index).map(([p, i]) => `${i}=${p}`).join('  '));

  // 2. one clip per track, the length of the song, then notes in chunks
  for (const [part, { notes }] of Object.entries(SONG)) {
    const ti = index[part];
    const payload = notes.map((e) => ({ pitch: e.pitch, start_time: e.start, duration: e.dur, velocity: e.vel, mute: false }));
    console.log(`${part.padEnd(16)} track ${ti}: ${payload.length} notes in ${Math.ceil(payload.length / CHUNK)} chunk(s)`);
    if (DRY) continue;

    await send('create_clip_in_arrangement', { track_index: ti, start_time: 0, length: SONG_BEATS });
    await sleep(150);
    // find it: the clip on this track that starts at 0 with our length
    const clips = (await send('get_arrangement_clips', { track_index: ti })).clips ?? [];
    const ci = clips.findIndex((c) => Math.abs(c.start_time) < 1e-6 && Math.abs(c.length - SONG_BEATS) < 1e-3);
    if (ci < 0) throw new Error(`could not find the new clip on track ${ti}: ${JSON.stringify(clips)}`);

    for (let i = 0; i < payload.length; i += CHUNK) {
      await send('add_notes_to_arrangement_clip', { track_index: ti, clip_index: ci, notes: payload.slice(i, i + CHUNK) });
      await sleep(120);
    }
    try { await send('set_arrangement_clip_name', { track_index: ti, clip_index: ci, name: `Service Starts Now — ${part}` }); } catch {}
  }

  // 3. locators at the section starts (names cannot be set via the API; rename by hand)
  if (!DRY) {
    for (const [b] of SECTIONS) {
      try { await send('create_cue_point', { time: bar(b) }); await sleep(80); } catch (e) { console.log('  (cue point failed:', e.message, ')'); break; }
    }
  }
  console.log(DRY ? 'dry run complete' : 'pushed. sections:');
  for (const [b, name] of SECTIONS) console.log(`  bar ${String(b).padStart(3)}  ${name}`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
