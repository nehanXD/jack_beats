/* JackBeats — sequencer logic and Strudel integration */
// Instruments and mapping to Strudel sample names
const INSTRUMENTS = [
  { key: 'kick',     label: 'Kick',      sample: 'bd',  colorClass: 'row-kick' },
  { key: 'snare',    label: 'Snare',     sample: 'sd',  colorClass: 'row-snare' },
  { key: 'hihat',    label: 'Hi-Hat',    sample: 'hh',  colorClass: 'row-hihat' },
  { key: 'openhat',  label: 'Open Hat',  sample: 'oh',  colorClass: 'row-hihat' },
  { key: 'clap',     label: 'Clap',      sample: 'cp',  colorClass: 'row-clap' },
  { key: 'rim',      label: 'Rim',       sample: 'realclaps', colorClass: 'row-perc' },
  { key: 'tom',      label: 'Tom',       sample: 'mt',  colorClass: 'row-perc' },
  { key: 'ride',     label: 'Ride',      sample: 'cr',  colorClass: 'row-perc' },
  { key: 'shaker',   label: 'Shaker',    sample: 'hc',  colorClass: 'row-perc' },
  { key: 'cowbell',  label: 'Cowbell',   sample: 'cb',  colorClass: 'row-perc' },
];
const SAMPLE_OPTIONS = ['bd','sd','hh','oh','cp','cr','lt','mt','ht','cb','hc','realclaps','808'];
const STEPS = 16;
const STORAGE_KEY = 'jackbeats_v1_pattern';

// State
const state = {
  tempo: 100,
  playing: false,
  step: 0,
  record: false,
  // pattern: { instrumentKey: boolean[16] }
  pattern: {},
  // perTrack: { instrumentKey: { volume: 0..1, pan: -1..1 } }
  perTrack: {},
  mouseDown: false,
  paintValue: true, // drag-paint target value
};

// Initialize default state
INSTRUMENTS.forEach(inst => {
  state.pattern[inst.key] = Array(STEPS).fill(false);
  state.perTrack[inst.key] = { volume: 0.9, pan: 0, sample: inst.sample };
});

// DOM helpers
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// Elements
const gridEl = $('#grid');
const stepHeadersEl = $('#step-headers');
const tempoEl = $('#tempo');
const tempoValueEl = $('#tempoValue');
const playBtn = $('#playBtn');
const stopBtn = $('#stopBtn');
const recordBtn = $('#recordBtn');
const presetSel = $('#preset');
const saveBtn = $('#saveBtn');
const loadBtn = $('#loadBtn');
const clearBtn = $('#clearBtn');
const statusBadge = document.getElementById('strudelStatus');

// Build step headers (1..16 with beat markers)
function buildStepHeaders() {
  stepHeadersEl.innerHTML = '';
  for (let i = 0; i < STEPS; i++) {
    const div = document.createElement('div');
    div.className = 'step-header' + (i % 4 === 0 ? ' beat' : '');
    div.textContent = (i + 1).toString();
    stepHeadersEl.appendChild(div);
  }
}

// Build sequencer grid dynamically
function buildGrid() {
  gridEl.innerHTML = '';

  INSTRUMENTS.forEach(inst => {
    // Label cell with per-track controls
    const labelWrap = document.createElement('div');
    labelWrap.className = `${inst.colorClass}`;

    const label = document.createElement('div');
    label.className = 'row-label';
    label.innerHTML = `<span>${inst.label}</span>
      <button class="ml-auto btn-secondary btn-pad" type="button" data-pad="${inst.key}" title="Tap to audition/record">Pad</button>`;

    const controls = document.createElement('div');
    controls.className = 'track-controls px-3 pb-2';
    const options = SAMPLE_OPTIONS.map(tok => `<option value="${tok}">${tok}</option>`).join('');
    controls.innerHTML = `
      <label class="opacity-80">Sound
        <select data-inst="${inst.key}" data-type="sample">
          ${options}
        </select>
      </label>
      <label class="opacity-80">Vol
        <input type="range" min="0" max="1" step="0.01" value="${state.perTrack[inst.key].volume}" data-inst="${inst.key}" data-type="volume">
      </label>
      <label class="opacity-80">Pan
        <input type="range" min="-1" max="1" step="0.01" value="${state.perTrack[inst.key].pan}" data-inst="${inst.key}" data-type="pan">
      </label>
    `;

  labelWrap.appendChild(label);
    labelWrap.appendChild(controls);
    gridEl.appendChild(labelWrap);

    // 16 step cells
    for (let i = 0; i < STEPS; i++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.setAttribute('aria-label', `${inst.label} step ${i + 1}`);
      cell.dataset.inst = inst.key;
      cell.dataset.step = i.toString();
      if (state.pattern[inst.key][i]) cell.classList.add('active');

      // click to toggle
      cell.addEventListener('click', () => toggleCell(inst.key, i));

      // drag to paint
      cell.addEventListener('pointerdown', e => {
        state.mouseDown = true;
        state.paintValue = !state.pattern[inst.key][i];
        setCell(inst.key, i, state.paintValue);
        cell.setPointerCapture(e.pointerId);
      });
      cell.addEventListener('pointerenter', () => {
        if (state.mouseDown) setCell(inst.key, i, state.paintValue);
      });
      cell.addEventListener('pointerup', () => { state.mouseDown = false; });

      gridEl.appendChild(cell);
    }
  });

  // Input listeners for per-track controls
  gridEl.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const inst = t.dataset.inst;
    const type = t.dataset.type;
    if (!inst || !type) return;
    const val = parseFloat(t.value);
    if (type === 'volume') state.perTrack[inst].volume = val;
  if (type === 'pan') state.perTrack[inst].pan = val;
  refreshPlaybackIfPlaying();
  });

  // handle selects for sample choice
  gridEl.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    const inst = t.dataset.inst;
    const type = t.dataset.type;
    if (!inst || type !== 'sample') return;
    state.perTrack[inst].sample = t.value;
    refreshPlaybackIfPlaying();
  });

  // Set initial select values for samples
  $$('select[data-type="sample"]').forEach(sel => {
    const inst = sel.getAttribute('data-inst');
    if (inst) sel.value = state.perTrack[inst].sample;
  });
  // Pad buttons: audition or record to current step
  // Unified pad handler: left-click, right-click, and touch
  // Left-click only: use click event to trigger pads
  gridEl.addEventListener('click', async (e) => {
    // Resolve the clicked pad button even if the event target is a text node
    let btn = null;
    if (typeof e.composedPath === 'function') {
      const path = e.composedPath();
      for (const n of path) {
        if (n instanceof HTMLElement && n.matches && n.matches('button[data-pad]')) { btn = n; break; }
      }
    }
    if (!btn) {
      const tgt = e.target;
      if (tgt instanceof HTMLElement && typeof tgt.closest === 'function') {
        btn = tgt.closest('button[data-pad]');
      } else if (tgt && tgt.parentElement && typeof tgt.parentElement.closest === 'function') {
        btn = tgt.parentElement.closest('button[data-pad]');
      }
    }
    if (!btn) return;
    const inst = btn.getAttribute('data-pad');
    if (!inst) return;
    await audition(inst);
    if (state.record && state.playing) {
      const stepIdx = state.step >= 0 ? state.step : 0;
      setCell(inst, stepIdx, true);
    }
  });
}

function toggleCell(instKey, stepIdx) {
  const v = !state.pattern[instKey][stepIdx];
  setCell(instKey, stepIdx, v);
}
function setCell(instKey, stepIdx, value) {
  state.pattern[instKey][stepIdx] = value;
  const cell = gridEl.querySelector(`.cell[data-inst="${instKey}"][data-step="${stepIdx}"]`);
  if (cell) cell.classList.toggle('active', value);
  refreshPlaybackIfPlaying();
}

// Presets
const PRESETS = {
  hiphop: {
  kick:    [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,1,0,0],
  snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
  hihat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  openhat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  clap:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
  rim:     [0,0,0,0, 0,1,0,0, 0,0,0,1, 0,0,1,0],
  tom:     [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  ride:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  shaker:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  cowbell: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  house: {
  kick:    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  snare:   [0,0,0,0, 1,0,1,0, 0,0,0,0, 1,0,1,0],
  hihat:   [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
  openhat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  clap:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
  rim:     [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  tom:     [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  ride:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  shaker:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  cowbell: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  trap: {
  kick:    [1,0,0,0, 0,0,1,0, 0,0,0,1, 0,0,1,0],
  snare:   [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1],
  hihat:   [1,1,0,1, 1,0,1,1, 0,1,1,0, 1,1,0,1],
  openhat: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
  clap:    [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0],
  rim:     [0,0,0,1, 0,0,0,0, 1,0,0,0, 0,0,0,1],
  tom:     [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],
  ride:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  shaker:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  cowbell: [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
  },
  funk: {
  kick:    [1,0,0,1, 0,1,0,0, 1,0,0,1, 0,0,1,0],
  snare:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  hihat:   [1,0,1,1, 0,1,0,1, 1,0,1,1, 0,1,0,1],
  openhat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  clap:    [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0],
  rim:     [0,0,1,0, 0,1,0,0, 0,0,1,0, 0,1,0,0],
  tom:     [0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0],
  ride:    [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
  shaker:  [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
  cowbell: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
  }
};

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  INSTRUMENTS.forEach(inst => {
    const pat = preset[inst.key] || Array(STEPS).fill(0);
    for (let i = 0; i < STEPS; i++) {
      setCell(inst.key, i, !!pat[i]);
    }
  });
}

presetSel.addEventListener('change', () => {
  if (presetSel.value !== 'custom') applyPreset(presetSel.value);
});

// Save/Load
function savePattern() {
  const data = {
    tempo: state.tempo,
    pattern: state.pattern,
    perTrack: state.perTrack,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function loadPattern() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    // Migrate legacy keys from older versions
    if (data.pattern && data.pattern.perc && !data.pattern.rim) {
      data.pattern.rim = data.pattern.perc;
    }
    if (data.perTrack && data.perTrack.perc && !data.perTrack.rim) {
      data.perTrack.rim = { ...data.perTrack.perc, sample: 'rim' };
    }
    state.tempo = Math.min(200, Math.max(40, data.tempo || 100));
    tempoEl.value = state.tempo.toString();
    tempoValueEl.textContent = state.tempo.toString();
    if (data.pattern) {
      INSTRUMENTS.forEach(inst => {
        const arr = (data.pattern[inst.key] || []).slice(0, STEPS);
        for (let i = 0; i < STEPS; i++) {
          setCell(inst.key, i, !!arr[i]);
        }
      });
    }
    if (data.perTrack) {
      INSTRUMENTS.forEach(inst => {
        state.perTrack[inst.key].volume = Math.min(1, Math.max(0, data.perTrack[inst.key]?.volume ?? 0.9));
        state.perTrack[inst.key].pan = Math.min(1, Math.max(-1, data.perTrack[inst.key]?.pan ?? 0));
        let samp = String(data.perTrack[inst.key]?.sample ?? inst.sample);
        // sanitize unknown tokens to a default
        if (!SAMPLE_OPTIONS.includes(samp)) samp = inst.sample;
        state.perTrack[inst.key].sample = samp;
      });
    }
    // update sliders
    $$("input[data-type='volume']").forEach(el => {
      const inst = el.getAttribute('data-inst');
      el.value = String(state.perTrack[inst].volume);
    });
    $$("input[data-type='pan']").forEach(el => {
      const inst = el.getAttribute('data-inst');
      el.value = String(state.perTrack[inst].pan);
    });
    $$("select[data-type='sample']").forEach(el => {
      const inst = el.getAttribute('data-inst');
      el.value = String(state.perTrack[inst].sample);
    });
    // If currently playing, rebuild with the loaded state
    if (state.playing) {
      refreshPlaybackIfPlaying();
    }
    return true;
  } catch {
    return false;
  }
}

saveBtn.addEventListener('click', () => { savePattern(); flashButton(saveBtn, 'Saved!'); });
loadBtn.addEventListener('click', () => { if (loadPattern()) flashButton(loadBtn, 'Loaded!'); });

function flashButton(btn, text) {
  const old = btn.textContent;
  btn.textContent = text || 'Saved!';
  setTimeout(() => (btn.textContent = old), 800);
}

// Tempo
function updateTempo(val) {
  state.tempo = Math.min(200, Math.max(40, Number(val) || 100));
  tempoValueEl.textContent = String(state.tempo);
  // update Strudel cps (cycles per second) -> cps = bpm / 120
  if (typeof setcps === 'function') setcps(state.tempo / 120);
  if (state.playing) {
    // restart playhead interval to reflect new tempo
    startPlayhead();
  }
}

tempoEl.addEventListener('input', e => updateTempo(e.target.value));

// Playback with Strudel
let strudelReady = false;
let playheadTimer = null;

function initAudio() {
  // returns a Promise that resolves when Strudel (and samples) are ready
  return new Promise((resolve) => {
    if (strudelReady) return resolve();
    if (typeof initStrudel === 'function') {
      try {
        // prebake loads the default dirt-samples so drum sounds like bd, sd, hh actually work
        const ret = initStrudel({
          prebake: () => {
            if (typeof samples === 'function') {
              return samples('github:tidalcycles/dirt-samples');
            }
          },
        });
        const afterInit = () => {
          if (typeof setcps === 'function') setcps(state.tempo / 120);
          strudelReady = true;
          setStatus('Samples loaded', 'emerald');
          resolve();
        };
        if (ret && typeof ret.then === 'function') {
          ret.then(afterInit).catch((err) => {
            console.warn('Strudel init issue:', err);
            afterInit(); // still mark ready, samples may load lazily
          });
        } else {
          afterInit();
        }
      } catch (err) {
        console.error('Strudel init error:', err);
        setStatus('Init error', 'red');
        resolve();
      }
    } else {
      setStatus('Strudel not found', 'red');
      resolve();
    }
  });
}

function setStatus(text, color) {
  if (!statusBadge) return;
  const dot = statusBadge.querySelector('span');
  const label = statusBadge.querySelectorAll('span')[1];
  if (label) label.textContent = text;
  if (dot) {
    const map = { emerald: '#10b981', amber: '#f59e0b', red: '#ef4444' };
    dot.style.backgroundColor = map[color] || '#f59e0b';
  }
}

function buildStrudelCode() {
  // Build a Strudel code string using evaluate() for reliable playback
  // Each instrument becomes: s("sampleTok").struct("1 0 1 0 ...").gain(vol).pan(panv)
  const lines = [];

  INSTRUMENTS.forEach(inst => {
    // Skip instruments with no active steps
    if (!state.pattern[inst.key].some(Boolean)) return;

    const sampleTok = state.perTrack[inst.key]?.sample || inst.sample;
    const vol = state.perTrack[inst.key].volume;
    const panv = state.perTrack[inst.key].pan;

    // Build the mini-notation struct pattern: "1 0 1 0 0 0 1 0 ..."
    const structPattern = state.pattern[inst.key]
      .map(v => (v ? '1' : '0'))
      .join(' ');

    // Each instrument as a Strudel expression
    lines.push(
      `s("${sampleTok}").struct("${structPattern}").gain(${vol.toFixed(2)}).pan(${panv.toFixed(2)})`
    );
  });

  if (lines.length === 0) return null;

  // Stack all instrument patterns together
  if (lines.length === 1) {
    return lines[0];
  }
  return `stack(\n  ${lines.join(',\n  ')}\n)`;
}

async function audition(instKey) {
  await initAudio();
  if (!strudelReady) return;

  const sampleTok = state.perTrack[instKey]?.sample || INSTRUMENTS.find(i => i.key === instKey)?.sample;
  const vol = state.perTrack[instKey]?.volume ?? 0.9;
  const panv = state.perTrack[instKey]?.pan ?? 0;

  // Use evaluate() to play a one-shot sound
  try {
    if (typeof evaluate === 'function') {
      await evaluate(`s("${sampleTok}").gain(${vol.toFixed(2)}).pan(${panv.toFixed(2)})`);
      // Stop the loop after a short time so it doesn't keep repeating
      setTimeout(() => { if (typeof hush === 'function') hush(); }, 300);
    }
  } catch (err) {
    console.warn('Audition failed:', err);
  }
}

async function startPlayback() {
  await initAudio();
  if (!strudelReady) return;
  state.playing = true;
  // Hush any previous patterns to avoid overlap
  if (typeof hush === 'function') hush();

  // Short delay to let hush take effect
  await new Promise(r => setTimeout(r, 50));

  // Build and evaluate the Strudel code
  const code = buildStrudelCode();
  if (code && typeof evaluate === 'function') {
    try {
      await evaluate(code);
    } catch (err) {
      console.warn('Playback evaluate failed:', err);
    }
  }

  // Visual playhead loop synced to tempo
  startPlayhead();
  // Persistent button pressed state
  if (playBtn) playBtn.setAttribute('aria-pressed', 'true');
  if (stopBtn) stopBtn.setAttribute('aria-pressed', 'false');
}

function stopPlayback() {
  state.playing = false;
  if (typeof hush === 'function') hush();
  stopPlayhead();
  clearPlayheadUI();
  // Persistent button pressed state
  if (playBtn) playBtn.setAttribute('aria-pressed', 'false');
  if (stopBtn) stopBtn.setAttribute('aria-pressed', 'true');
}

playBtn.addEventListener('click', startPlayback);
stopBtn.addEventListener('click', stopPlayback);
if (recordBtn) {
  recordBtn.addEventListener('click', () => {
    state.record = !state.record;
    recordBtn.setAttribute('aria-pressed', state.record ? 'true' : 'false');
  });
}
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    INSTRUMENTS.forEach(inst => {
      for (let i = 0; i < STEPS; i++) setCell(inst.key, i, false);
    });
  });
}

// Keyboard mapping: 1..0 map to first 10 instruments when recording
document.addEventListener('keydown', async (e) => {
  if (!state.record) return;
  const map = ['1','2','3','4','5','6','7','8','9','0'];
  const idx = map.indexOf(e.key);
  if (idx === -1) return;
  const inst = INSTRUMENTS[idx]?.key;
  if (!inst) return;
  e.preventDefault();
  await audition(inst);
  if (state.playing) {
    const stepIdx = state.step >= 0 ? state.step : 0;
    setCell(inst, stepIdx, true);
  }
});

// Playhead UI
function startPlayhead() {
  stopPlayhead();
  const intervalMs = (60_000 / state.tempo) / 4; // 16 steps per bar => 4 steps per beat
  state.step = -1;
  playheadTimer = setInterval(() => {
    const prev = state.step;
    state.step = (state.step + 1) % STEPS;
    updatePlayheadUI(prev, state.step);
  }, intervalMs);
}

function stopPlayhead() {
  if (playheadTimer) {
    clearInterval(playheadTimer);
    playheadTimer = null;
  }
}

function updatePlayheadUI(prev, current) {
  if (prev >= 0) {
    $$(`.cell[data-step='${prev}']`).forEach(el => el.classList.remove('playhead'));
  }
  $$(`.cell[data-step='${current}']`).forEach(el => el.classList.add('playhead'));
}
function clearPlayheadUI() {
  $$('.cell.playhead').forEach(el => el.classList.remove('playhead'));
}

// Debounce refresh to avoid rapid hush/play cycles
let refreshTimeout = null;
async function refreshPlaybackIfPlaying() {
  if (!state.playing) return;
  if (refreshTimeout) clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(async () => {
    await initAudio();
    if (typeof hush === 'function') hush();
    await new Promise(r => setTimeout(r, 30));
    const code = buildStrudelCode();
    if (code && typeof evaluate === 'function') {
      try {
        await evaluate(code);
      } catch (err) {
        console.warn('Refresh evaluate failed:', err);
      }
    }
  }, 150);
}

// Init
window.addEventListener('pointerup', () => { state.mouseDown = false; });

document.addEventListener('DOMContentLoaded', () => {
  buildStepHeaders();
  buildGrid();
  // Try load existing pattern
  loadPattern();
  updateTempo(tempoEl.value);
  // Do NOT call initAudio() here — calling it before user gesture
  // causes an AudioContext desync ('TOO LATE' errors = silence).
  // Audio will init on first Play/Pad click instead.
  setStatus('Click Play to start', 'amber');
  // Initial button states
  if (playBtn) playBtn.setAttribute('aria-pressed', 'false');
  if (stopBtn) stopBtn.setAttribute('aria-pressed', 'true');
});
