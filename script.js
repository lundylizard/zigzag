(function () {

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rad = d => d * Math.PI / 180;
    const deg = r => r * 180 / Math.PI;
    const angDelta = (a, b) => ((b - a + 540) % 360) - 180;

    function overlapXZ(cx, cz, char, box) {
        return (
            Math.abs(cx - box.x) <= (char.halfW + box.w * 0.5) &&
            Math.abs(cz - box.z) <= (char.halfD + box.d * 0.5)
        );
    }

    let camMode = 'behind';

    const ABS = {
        charWidth: 1.0,
        charDepth: 1.0,
        charHeight: 2.0,
        sideMargin: 0.0,
        goalInset: 0.0
    };

    // trail stuff for top down view
    let trail = [];
    const TRAIL_MAX = 2000;
    const TRAIL_STEP = 0.1;

    function approachAngle(current, target, maxStep) {
        const d = angDelta(current, target);
        if (Math.abs(d) <= maxStep) return target;
        return current + Math.sign(d) * maxStep;
    }

    function normalizeDeg180(angle) {
        return ((angle % 360) + 540) % 360 - 180;
    }

    function makeProjector(W, H, cam) {
        const cy = (cam.yaw || 0) * Math.PI / 180;
        const cosy = Math.cos(cy), siny = Math.sin(cy);
        const f = 220;

        return function proj(X, Y, Z) {
            const dx = X - cam.x;
            const dy = Y - cam.y;
            const dz = Z - cam.z;

            const rx = dx * cosy + dz * siny;   // horizontal in camera space
            const rz = -dx * siny + dz * cosy;   // depth in camera space

            const scale = f / (rz > 1 ? rz : 1);
            const sx = W * 0.5 + rx * scale;
            const sy = H * 0.6 - dy * scale;
            return { x: sx, y: sy, ok: rz > 1 };
        };
    }

    const keys = { w: false, a: false, s: false, d: false, space: false };

    function setKey(key, keyDown) {
        if (key in keys) {
            keys[key] = keyDown;
            markKeys();
        }
    }

    function handleKey(event, down) {
        const c = event.code;
        let handled = false;

        switch (c) {
            case 'KeyW':
            case 'ArrowUp':
                setKey('w', down);
                handled = true;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                setKey('a', down);
                handled = true;
                break;
            case 'KeyS':
            case 'ArrowDown':
                setKey('s', down);
                handled = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                setKey('d', down);
                handled = true;
                break;
            case 'Space':
                setKey('space', down);
                handled = true;
                break;
        }

        if (!handled) {
            const k = (event.key || '').toLowerCase();
            if (k === ' ' || k === 'spacebar') {
                setKey('space', down);
                handled = true;
            }
        }

        if (handled) event.preventDefault();
    }

    window.addEventListener('keydown', e => handleKey(e, true));
    window.addEventListener('keyup', e => handleKey(e, false));

    // gamepad
    const GP = {
        index: null,
        lastButtons: {}
    };

    window.addEventListener('gamepadconnected', (e) => {
        GP.index = e.gamepad.index;
    });

    window.addEventListener('gamepaddisconnected', (e) => {
        if (GP.index === e.gamepad.index) GP.index = null;
    });

    function btnPressed(gamePad, i) {
        const p = !!gamePad.buttons[i]?.pressed, was = !!GP.lastButtons[i];
        GP.lastButtons[i] = p;
        return p && !was;
    }

    function readDpad(gamePad) {
        let up = false, down = false, left = false, right = false;

        if (gamePad.mapping === 'standard' && gamePad.buttons?.length >= 16) {
            up = !!gamePad.buttons[12]?.pressed;
            down = !!gamePad.buttons[13]?.pressed;
            left = !!gamePad.buttons[14]?.pressed;
            right = !!gamePad.buttons[15]?.pressed;
        }

        if (!(up || down || left || right) && gamePad.axes?.length) {
            const candidates = [];

            if (gamePad.axes.length > 9) candidates.push(9);

            for (let i = 0; i < gamePad.axes.length; i++) if (i !== 9) candidates.push(i);

            const states = [
                { v: -1.000, dirs: ['up'] },
                { v: -0.714, dirs: ['up', 'right'] },
                { v: -0.428, dirs: ['right'] },
                { v: -0.142, dirs: ['down', 'right'] },
                { v: 0.000, dirs: [] },
                { v: 0.142, dirs: ['down'] },
                { v: 0.428, dirs: ['down', 'left'] },
                { v: 0.714, dirs: ['left'] },
                { v: 1.000, dirs: ['up', 'left'] },
            ];

            const TOL = 0.18;

            for (const idx of candidates) {
                const hv = gamePad.axes[idx];
                if (typeof hv !== 'number') continue;
                let best = null, bestErr = Infinity;

                for (const s of states) {
                    const err = Math.abs(hv - s.v);
                    if (err < bestErr) {
                        best = s;
                        bestErr = err;
                    }
                }

                if (best && bestErr <= TOL) {
                    up = best.dirs.includes('up');
                    down = best.dirs.includes('down');
                    left = best.dirs.includes('left');
                    right = best.dirs.includes('right');
                    break;
                }
            }
        }
        return { up, down, left, right };
    }

    function updateGamepad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let selectedGamePad = null;

        if (GP.index != null) selectedGamePad = pads[GP.index];

        if (!selectedGamePad) for (const gamePad of pads) if (gamePad && gamePad.connected) {
            selectedGamePad = gamePad;
            GP.index = gamePad.index;
            break;
        }

        if (!selectedGamePad) return;

        const { up, down, left, right } = readDpad(selectedGamePad);
        setKey('w', up);
        setKey('s', down);
        setKey('a', left);
        setKey('d', right);

        const jump = selectedGamePad.buttons?.[0]?.pressed || selectedGamePad.buttons?.[1]?.pressed;
        setKey('space', !!jump);

        if (btnPressed(selectedGamePad, 9)) paused = !paused;
        if (btnPressed(selectedGamePad, 8)) reset();
    }

    const view = document.getElementById('view3d');
    const ctxView = view.getContext('2d');
    const fwdEl = document.getElementById('fwdV');
    const magEl = document.getElementById('magV');
    const yawEl = document.getElementById('yawVal');
    const isDiagEl = document.getElementById('isDiag');
    const inputDirEl = document.getElementById('inputDir');
    const turnRateLabel = document.getElementById('turnRateLabel');
    const stateChip = document.getElementById('stateChip');
    const distToGoalEl = document.getElementById('distToGoal');
    const elapsedEl = document.getElementById('elapsed');

    const keyUp = document.getElementById('keyUp');
    const keyDown = document.getElementById('keyDown');
    const keyLeft = document.getElementById('keyLeft');
    const keyRight = document.getElementById('keyRight');
    const keySpace = document.getElementById('keySpace');

    const goalInput = document.getElementById('goalInput');
    const baseSpeedInput = document.getElementById('baseSpeed');
    const diagBoostInput = document.getElementById('diagBoost');
    const turnGroundInput = document.getElementById('turnGround');
    const turnAirInput = document.getElementById('turnAir');
    const jumpSpeedInput = document.getElementById('jumpSpeed');
    const gravityInput = document.getElementById('gravity');

    const courseWidthInput = document.getElementById('courseWidth');
    const obsCountInput = document.getElementById('obsCount');
    const obsSizeMinInput = document.getElementById('obsSizeMin');
    const obsSizeMaxInput = document.getElementById('obsSizeMax');
    const obsHMinInput = document.getElementById('obsHMin');
    const obsHMaxInput = document.getElementById('obsHMax');
    const courseSeedInput = document.getElementById('courseSeed');
    const btnRegen = document.getElementById('btnRegen');

    const viewTop = document.getElementById('viewTop');
    const ctxTop = viewTop.getContext('2d');

    document.getElementById('btnReset').onclick = () => reset();
    document.getElementById('btnPause').onclick = () => { paused = !paused; };

    // ===== Charts =====
    class Spark {
        constructor(canvas, { label, yLabel, auto = true, yMin = -1, yMax = 1, color = '#ffffff', colorFn = null } = {}) {
            this.canvas = canvas;
            this.context = canvas?.getContext('2d');
            this.data = [];
            this.maxLength = 1000;
            this.auto = auto;
            this.yMin = yMin;
            this.yMax = yMax;
            this.color = color;
            this.colorFn = colorFn;
            this.label = label;
            this.yLabel = yLabel;
            this.t = 0;
            this.sampleEvery = 1 / 250;
            this.lastY = 0;
        }

        push(dt, value) {
            if (!this.context) return;
            this.t += dt;
            this.lastY = value;
            while (this.t >= this.sampleEvery) {
                this.t -= this.sampleEvery;
                this.data.push(value);
                if (this.data.length > this.maxLength) this.data.shift();
            }
        }

        clear() {
            this.data.length = 0;
        }

        ensureSize() {
            const c = this.canvas;
            if (!c) return;
            const dpr = window.devicePixelRatio || 1;
            const r = c.getBoundingClientRect();
            const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
            if (c.width !== w || c.height !== h) {
                c.width = w;
                c.height = h;
            }
        }

        draw() {
            const c = this.canvas, g = this.context;
            if (!c || !g) return;
            this.ensureSize();
            const W = c.width, H = c.height;
            g.clearRect(0, 0, W, H);
            g.globalAlpha = 1;
            g.lineWidth = 1;
            // midline
            g.strokeStyle = '#1f2937';
            g.beginPath();
            g.moveTo(0, H * 0.5);
            g.lineTo(W, H * 0.5);
            g.stroke();
            // grid lines
            g.strokeStyle = '#253245';
            for (let i = 0; i < 5; i++) {
                const y = i * (H / 4);
                g.beginPath();
                g.moveTo(0, y);
                g.lineTo(W, y);
                g.stroke();
            }

            let min = this.yMin, max = this.yMax;
            if (this.auto) {
                min = Infinity;
                max = -Infinity;
                for (const v of this.data) {
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
                if (!isFinite(min) || !isFinite(max)) {
                    min = -1;
                    max = 1;
                }
                if (max === min) max = min + 1;
                const r = max - min;
                min -= r * 0.1;
                max += r * 0.1;
            }

            const n = this.data.length;
            if (n < 2) return;
            g.lineWidth = 2;

            // segment coloring
            for (let i = 1; i < n; i++) {
                const v0 = this.data[i - 1], v1 = this.data[i];
                const x0 = (i - 1) / (this.maxLength - 1) * W;
                const x1 = i / (this.maxLength - 1) * W;
                const y0 = H - ((v0 - min) / (max - min)) * H;
                const y1 = H - ((v1 - min) / (max - min)) * H;
                g.strokeStyle = this.colorFn ? this.colorFn((v0 + v1) * 0.5) : this.color;
                g.beginPath();
                g.moveTo(x0, y0);
                g.lineTo(x1, y1);
                g.stroke();
            }

            g.fillStyle = '#9fb0d0';
            g.font = '12px system-ui, sans-serif';
            g.fillText(this.label || '', 8, 14);
            g.textAlign = 'right';
            g.fillText(`${this.lastY.toFixed(2)} ${this.yLabel || ''}`, W - 8, 14);
            g.textAlign = 'left';
        }
    }

    function makeSpark(id, opts) {
        const el = document.getElementById(id);
        if (!el) {
            console.warn('Missing canvas:', id);
            return null;
        }
        return new Spark(el, opts);
    }

    function clearCharts() {
        chartFwd?.clear();
        chartMag?.clear();
        chartYaw?.clear();
        chartETA?.clear();
    }

    // chart color functions
    function headingColor(angleDeg) {
        const a = Math.min(90, Math.abs(normalizeDeg180(angleDeg)));
        if (a <= 45) {
            const t = a / 45;
            const r = Math.round(lerp(0, 255, t));
            return `rgb(${r},255,0)`; // green -> yellow
        } else {
            const t = (a - 45) / 45;
            const g = Math.round(lerp(255, 0, t));
            return `rgb(255,${g},0)`; // yellow -> red
        }
    }

    function forwardColor(speed) {
        const eps = 1e-6;
        if (speed < params.baseSpeed - eps) return 'red';
        if (Math.abs(speed - params.baseSpeed) <= eps) return 'grey';
        return 'limegreen';
    }

    let bestEtaSoFar = Infinity;
    function etaColor(val) {
        if (!isFinite(val)) return '#888';
        if (val <= bestEtaSoFar - 0.05) {
            bestEtaSoFar = val;
            return 'limegreen';
        }
        if (val <= bestEtaSoFar + 0.2) return 'grey';
        return 'red';
    }

    const chartFwd = makeSpark('chartFwd', { label: 'Forward speed →', yLabel: 'u/s', auto: true, colorFn: forwardColor });
    const chartYaw = makeSpark('chartYaw', { label: 'Heading (deg)', yLabel: '°', auto: false, yMin: -90, yMax: 90, colorFn: headingColor });
    const chartETA = makeSpark('chartETA', { label: 'Projected finish (s)', yLabel: 's', auto: true, colorFn: etaColor });
    const chartMag = makeSpark('chartMag', { label: 'Horizontal |v|', yLabel: 'u/s', auto: true });

    // course
    let course = { width: 16 };
    let obstacles = [];
    let charDims = { halfW: ABS.charWidth * 0.5, halfD: ABS.charDepth * 0.5, height: ABS.charHeight };

    function clampPlayerToLaneWidth() {
        const halfWMax = Math.max(0.05, course.width * 0.5 - 0.001);
        charDims.halfW = Math.min(ABS.charWidth * 0.5, halfWMax);
    }

    function mulberry32(seed) {
        let t = 0;
        if (typeof seed === 'string') {
            for (let i = 0; i < seed.length; i++) t = (t * 1664525 + seed.charCodeAt(i) + 1013904223) >>> 0;
        } else {
            t = (seed >>> 0) || 1;
        }
        return function () {
            t += 0x6D2B79F5;
            let r = t;
            r = Math.imul(r ^ r >>> 15, r | 1);
            r ^= r + Math.imul(r ^ r >>> 7, r | 61);
            return ((r ^ r >>> 14) >>> 0) / 4294967296;
        };
    }

    let rng = mulberry32(0);
    const obstacleParams = {
        count: 20,
        sizeMin: 1.0,
        sizeMax: 3.0,
        hMin: 1.0,
        hMax: 2.5,
        seedStr: 'changeMe',
        startClear: 6,
        endClear: 2
    };

    let sim = { x: 0, z: 0, y: 0, vy: 0, yaw: 0, elapsed: 0, grounded: true, finished: false };
    let goal = 100;
    let params = { baseSpeed: 6, diagBoost: Math.SQRT2, turnGround: 900, turnAir: 120, gravity: -20, jumpSpeed: 9 };
    let lastSpace = false;
    let paused = false;
    let started = false;
    let etaFiltered = null;

    function readParams() {
        goal = +goalInput.value || 100;
        params.baseSpeed = +baseSpeedInput.value || 6;
        params.diagBoost = +diagBoostInput.value || Math.SQRT2;
        params.turnGround = +turnGroundInput.value || 900;
        params.turnAir = +turnAirInput.value || 120;
        params.jumpSpeed = +jumpSpeedInput.value || 9;
        params.gravity = +gravityInput.value || -20;

        if (courseWidthInput) course.width = clamp(+courseWidthInput.value || 16, 0.5, 200);

        if (obsCountInput) obstacleParams.count = clamp(+obsCountInput.value || 0, 0, 200);
        if (obsSizeMinInput) obstacleParams.sizeMin = Math.max(0.05, +obsSizeMinInput.value || 1.0);
        if (obsSizeMaxInput) obstacleParams.sizeMax = Math.max(obstacleParams.sizeMin, +obsSizeMaxInput.value || 3.0);
        if (obsHMinInput) obstacleParams.hMin = Math.max(0.05, +obsHMinInput.value || 1.0);
        if (obsHMaxInput) obstacleParams.hMax = Math.max(obstacleParams.hMin, +obsHMaxInput.value || 2.5);
        if (courseSeedInput) obstacleParams.seedStr = (courseSeedInput.value || 'crash-zzz') + `|goal:${goal}|w:${course.width}`;
        clampPlayerToLaneWidth();
    }

    function generateObstacles() {

        readParams();
        rng = mulberry32(obstacleParams.seedStr);
        obstacles = [];

        if (!obstacleParams.count || obstacleParams.count <= 0) return;

        const left = -course.width * 0.5 + ABS.sideMargin;
        const right = course.width * 0.5 - ABS.sideMargin;
        const maxSpan = Math.max(0.1, right - left);

        const tries = obstacleParams.count * 12;
        let placed = 0;

        for (let t = 0; t < tries && placed < obstacleParams.count; t++) {
            let w = lerp(obstacleParams.sizeMin, obstacleParams.sizeMax, rng());
            let d = lerp(obstacleParams.sizeMin, obstacleParams.sizeMax, rng());
            let h = lerp(obstacleParams.hMin, obstacleParams.hMax, rng());

            // ensure box fits between walls
            w = Math.min(w, maxSpan);
            if (w < 0.1) w = 0.1;
            if (d < 0.1) d = 0.1;
            if (h < 0.1) h = 0.1;

            const x = lerp(left + w * 0.5, right - w * 0.5, rng());
            const z = lerp(obstacleParams.startClear, goal - obstacleParams.endClear, rng());

            const box = { x, z, w, d, h };

            // avoid heavy overlap
            let ok = true;
            for (const b of obstacles) {
                const dx = Math.abs(b.x - box.x);
                const dz = Math.abs(b.z - box.z);
                if (dx < (b.w + box.w) * 0.5 * 0.9 && dz < (b.d + box.d) * 0.5 * 0.9) {
                    ok = false;
                    break;
                }
            }

            if (ok) {
                obstacles.push(box);
                placed++;
            }
        }
    }

    btnRegen?.addEventListener('click', () => {
        generateObstacles();
        clearCharts();
    });

    [courseWidthInput, obsCountInput, obsSizeMinInput, obsSizeMaxInput, obsHMinInput, obsHMaxInput, courseSeedInput, goalInput, baseSpeedInput, diagBoostInput, turnGroundInput, turnAirInput, jumpSpeedInput, gravityInput]
        .forEach(el => el?.addEventListener('change', () => {
            readParams();
            generateObstacles();
            clearCharts();
        }));

    function reset() {
        readParams();
        sim = { x: 0, z: 0, y: 0, vy: 0, yaw: 0, elapsed: 0, grounded: true, finished: false };
        lastSpace = false;
        etaFiltered = null;
        bestEtaSoFar = Infinity;
        started = false;
        generateObstacles();
        clearCharts();
        trail = [];
    }

    function markKeys() {
        keyUp?.classList.toggle('active', keys.w);
        keyDown?.classList.toggle('active', keys.s);
        keyLeft?.classList.toggle('active', keys.a);
        keyRight?.classList.toggle('active', keys.d);
        keySpace?.classList.toggle('active', keys.space);
    }

    let lastT = performance.now();
    function step() {
        const now = performance.now();
        let dt = (now - lastT) / 1000;
        if (dt > 0.05) dt = 0.05;
        lastT = now;
        updateGamepad();
        if (!paused && !sim.finished) update(dt);
        draw();
        document.getElementById('camModeChip').textContent = `Cam: ${camMode}`;
        requestAnimationFrame(step);
    }

    function inputVector() {
        if (camMode === 'behind') {
            const ix = (keys.d ? 1 : 0) + (keys.a ? -1 : 0);
            const iz = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
            return { x: ix, z: iz };
        } else {
            // when cam is sideways remap input so it matches crash 1 input
            const ix = (keys.s ? 1 : 0) + (keys.w ? -1 : 0);
            const iz = (keys.d ? 1 : 0) + (keys.a ? -1 : 0);
            return { x: ix, z: iz };
        }
    }

    function update(dt) {
        readParams();

        const iv0 = inputVector();
        const anyInput = iv0.x !== 0 || iv0.z !== 0 || keys.space;
        if (!started) {
            if (anyInput) started = true; else return;
        }

        sim.elapsed += dt;

        const iv = iv0;
        const isInput = (iv.x !== 0 || iv.z !== 0);
        const isDiagonal = (iv.z !== 0 && iv.x !== 0);

        let targetYaw = sim.yaw;
        if (isInput) targetYaw = deg(Math.atan2(iv.x, iv.z));

        let speed = 0;
        if (isInput) speed = params.baseSpeed * (isDiagonal ? params.diagBoost : 1);

        // turn rate depends on grounded, again to simulate crash 1 movement behaviour
        const turnRate = sim.grounded ? params.turnGround : params.turnAir;
        turnRateLabel.textContent = `${turnRate.toFixed(0)}°/s`;
        sim.yaw = approachAngle(sim.yaw, targetYaw, turnRate * dt);

        // head bonked or we are standing on obstacle
        const vx = Math.sin(rad(sim.yaw)) * speed;
        const vz = Math.cos(rad(sim.yaw)) * speed;

        let nx = sim.x + vx * dt;
        let nz = sim.z + vz * dt;

        // clamp to course side walls
        const halfW = course.width * 0.5;
        nx = clamp(nx, -halfW + charDims.halfW, halfW - charDims.halfW);

        const prevY = sim.y;

        if (sim.grounded && !lastSpace && keys.space) {
            sim.vy = params.jumpSpeed;
            sim.grounded = false;
        }

        lastSpace = keys.space;

        if (!sim.grounded) {
            sim.vy += params.gravity * dt;
            let nextY = sim.y + sim.vy * dt;
            let resolved = false;

            if (sim.vy < 0 && prevY >= 0 && nextY <= 0) {
                sim.y = 0;
                sim.vy = 0;
                sim.grounded = true;
                resolved = true;
            }

            if (!resolved && sim.vy < 0) {
                for (const b of obstacles) {
                    // falling through the top plane of b?
                    if (prevY >= b.h && nextY <= b.h) {
                        if (overlapXZ(nx, nz, charDims, b)) {
                            sim.y = b.h;
                            sim.vy = 0;
                            sim.grounded = true;
                            resolved = true;
                            break;
                        }
                    }
                }
            }

            // bonk head
            if (!resolved && sim.vy > 0) {
                const topNow = prevY + charDims.height;
                const topNext = nextY + charDims.height;
                for (const b of obstacles) {
                    // crossing the underside of the box volume?
                    if (topNow <= b.h && topNext >= b.h) {
                        if (overlapXZ(nx, nz, charDims, b)) {
                            // place player right below the top plane
                            sim.y = b.h - charDims.height;
                            sim.vy = 0;
                            resolved = true;
                            break;
                        }
                    }
                }
            }

            if (!resolved) {
                sim.y = nextY; // free flight
            }

        } else {
            let supported = false;
            if (Math.abs(sim.y - 0) < 1e-6) {
                supported = true;
            } else {
                for (const b of obstacles) {
                    if (Math.abs(sim.y - b.h) < 1e-3 && overlapXZ(nx, nz, charDims, b)) {
                        supported = true;
                        break;
                    }
                }
            }
            if (!supported) {
                sim.grounded = false;
                if (sim.vy >= 0) sim.vy = 0; // start falling next tick
            }
        }

        for (const b of obstacles) {
            const standingOnThis = sim.grounded && Math.abs(sim.y - b.h) < 1e-3 && overlapXZ(nx, nz, charDims, b);
            if (standingOnThis) continue;

            const belowTop = sim.y < b.h;
            if (belowTop && overlapXZ(nx, nz, charDims, b)) {
                const px = (b.w * 0.5 + charDims.halfW) - Math.abs(nx - b.x);
                const pz = (b.d * 0.5 + charDims.halfD) - Math.abs(nz - b.z);
                if (px < pz) {
                    nx += (nx < b.x ? -px : px);
                } else {
                    nz += (nz < b.z ? -pz : pz);
                }
            }
        }

        sim.x = nx;
        sim.z = nz;

        // trail recording
        if (started && !paused) {
            const last = trail[trail.length - 1];
            if (!last) {
                trail.push({ x: sim.x, z: sim.z });
            } else {
                const dx = sim.x - last.x, dz = sim.z - last.z;
                if (Math.hypot(dx, dz) >= TRAIL_STEP) {
                    trail.push({ x: sim.x, z: sim.z });
                    if (trail.length > TRAIL_MAX) trail.shift();
                }
            }
        }

        if (sim.z >= goal) {
            sim.z = goal;
            sim.finished = true;
        }

        const forwardSpeed = Math.cos(rad(sim.yaw)) * speed; // speed toward +z (goal)
        const magSpeed = Math.hypot(vx, vz);
        fwdEl.textContent = forwardSpeed.toFixed(2);
        magEl.textContent = magSpeed.toFixed(2);
        yawEl.textContent = `${normalizeDeg180(sim.yaw).toFixed(1)}°`;
        isDiagEl.textContent = isDiagonal ? 'Yes' : 'No';
        inputDirEl.textContent = isInput ? `${targetYaw.toFixed(0)}°` : '—';
        stateChip.textContent = sim.grounded ? 'Grounded' : 'Airborne';
        stateChip.style.color = sim.grounded ? 'var(--muted)' : 'var(--good)';
        distToGoalEl.textContent = (goal - sim.z).toFixed(2);
        elapsedEl.textContent = sim.elapsed.toFixed(2);

        chartFwd?.push(dt, forwardSpeed);
        chartMag?.push(dt, magSpeed);
        chartYaw?.push(dt, normalizeDeg180(sim.yaw));

        const remaining = Math.max(0, goal - sim.z);
        let etaInst = Infinity;
        if (forwardSpeed > 0.001) etaInst = sim.elapsed + (remaining / forwardSpeed);
        let etaPace = Infinity;
        if (sim.z > 0.001) etaPace = sim.elapsed * (goal / sim.z);
        const w = clamp(1 - remaining / goal, 0, 1);
        const etaBlend = (isFinite(etaInst) && isFinite(etaPace)) ? (etaPace * (1 - w) + etaInst * w) : (isFinite(etaInst) ? etaInst : etaPace);
        const alpha = 0.25;
        if (isFinite(etaBlend)) etaFiltered = (etaFiltered == null) ? etaBlend : etaFiltered * (1 - alpha) + etaBlend * alpha;
        if (etaFiltered != null && isFinite(etaFiltered)) chartETA?.push(dt, etaFiltered);
    }

    function drawTop() {
        if (!viewTop) return;

        // dpr shit
        const dpr = window.devicePixelRatio || 1;
        const rect = viewTop.getBoundingClientRect();
        const W = viewTop.width = Math.round(rect.width * dpr);
        const H = viewTop.height = Math.round((rect.height || 280) * dpr);
        const g = ctxTop;

        // background
        g.fillStyle = '#000000';
        g.fillRect(0, 0, W, H);

        // World → screen mapping (pad a bit)
        const PADX = 12 * dpr, PADY = 10 * dpr;
        const minX = -course.width * 0.5, maxX = course.width * 0.5;
        const minZ = 0, maxZ = goal;

        const sx = (x) => PADX + (x - minX) * (W - PADX * 2) / (maxX - minX || 1);
        const sz = (z) => H - PADY - (z - minZ) * (H - PADY * 2) / (maxZ - minZ || 1); // forward (z+) goes up

        // course lines
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(sx(minX), sz(minZ), sx(maxX) - sx(minX), sz(maxZ) - sz(minZ));

        // start and goal lines
        g.strokeStyle = '#38465f';
        g.beginPath();
        g.moveTo(sx(minX), sz(minZ));
        g.lineTo(sx(maxX), sz(minZ));
        g.moveTo(sx(minX), sz(maxZ));
        g.lineTo(sx(maxX), sz(maxZ));
        g.stroke();

        // obstacles
        g.fillStyle = '#E69F00';
        for (const b of obstacles) {
            const x0 = sx(b.x - b.w * 0.5), x1 = sx(b.x + b.w * 0.5);
            const z0 = sz(b.z - b.d * 0.5), z1 = sz(b.z + b.d * 0.5);
            const rx = Math.min(x0, x1), ry = Math.min(z0, z1);
            const rw = Math.abs(x1 - x0), rh = Math.abs(z1 - z0);
            g.fillRect(rx, ry, rw, rh);
        }

        // trail behind player
        if (trail.length > 1) {
            g.strokeStyle = 'rgba(255,255,255,0.85)';
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(sx(trail[0].x), sz(trail[0].z));
            for (let i = 1; i < trail.length; i++) {
                g.lineTo(sx(trail[i].x), sz(trail[i].z));
            }
            g.stroke();
        }

        // player
        const px0 = sx(sim.x - charDims.halfW), px1 = sx(sim.x + charDims.halfW);
        const pz0 = sz(sim.z - charDims.halfD), pz1 = sz(sim.z + charDims.halfD);
        g.strokeStyle = '#0072B2';
        g.lineWidth = 3;
        g.strokeRect(Math.min(px0, px1), Math.min(pz0, pz1), Math.abs(px1 - px0), Math.abs(pz1 - pz0));

        // facing line
        const dirX = Math.sin(rad(sim.yaw)), dirZ = Math.cos(rad(sim.yaw));
        const tipX = sx(sim.x + dirX * 1.5);
        const tipZ = sz(sim.z + dirZ * 1.5);
        const cenX = sx(sim.x);
        const cenZ = sz(sim.z);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cenX, cenZ);
        g.lineTo(tipX, tipZ);
        g.stroke();
    }

    function resizeCanvasToDisplaySize(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    function drawBox(g, proj, cx, cy, cz, w, h, d, yawDeg, stroke = '#ffffff') {
        const cosY = Math.cos(rad(yawDeg)), sinY = Math.sin(rad(yawDeg));
        const hw = w * 0.5, hd = d * 0.5;

        const loc = [
            { x: -hw, y: 0, z: -hd }, { x: hw, y: 0, z: -hd }, { x: hw, y: 0, z: hd }, { x: -hw, y: 0, z: hd },
            { x: -hw, y: h, z: -hd }, { x: hw, y: h, z: -hd }, { x: hw, y: h, z: hd }, { x: -hw, y: h, z: hd }
        ].map(c => {
            const rx = c.x * cosY - c.z * sinY;
            const rz = c.x * sinY + c.z * cosY;
            return proj(cx + rx, cy + c.y, cz + rz);
        });

        function edge(i, j) {
            const a = loc[i], b = loc[j];
            if (a.ok && b.ok) {
                g.beginPath();
                g.moveTo(a.x, a.y);
                g.lineTo(b.x, b.y);
                g.stroke();
            }
        }

        g.strokeStyle = stroke;
        g.lineWidth = 2;
        edge(0, 1);
        edge(1, 2);
        edge(2, 3);
        edge(3, 0);
        edge(4, 5);
        edge(5, 6);
        edge(6, 7);
        edge(7, 4);
        edge(0, 4);
        edge(1, 5);
        edge(2, 6);
        edge(3, 7);
    }

    function draw() {
        resizeCanvasToDisplaySize(view);
        const g = ctxView, W = view.width, H = view.height;
        g.clearRect(0, 0, W, H);

        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(1, '#000000');
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);

        let cam;
        if (camMode === 'behind') {
            cam = {
                x: sim.x,
                y: 6 + sim.y + 6,
                z: sim.z - 18,
                yaw: 0
            };
        } else {
            // side view
            const sideDist = 18; // tweak 14–24 to taste
            cam = {
                x: sim.x + sideDist,
                y: 6 + sim.y,
                z: sim.z,
                yaw: 90
            };
        }

        const proj = makeProjector(W, H, cam);

        // ground grid
        g.strokeStyle = '#263043';
        g.lineWidth = 1;
        const step = 2;
        for (let z = Math.floor(cam.z / step) * step; z < cam.z + 80; z += step) {
            const p1 = proj(-course.width * 0.5, 0, z), p2 = proj(course.width * 0.5, 0, z);
            if (p1.ok && p2.ok) {
                g.beginPath();
                g.moveTo(p1.x, p1.y);
                g.lineTo(p2.x, p2.y);
                g.stroke();
            }
        }

        // side rails
        for (let x of [-course.width * 0.5, course.width * 0.5]) {
            const p1 = proj(x, 0, cam.z + 2), p2 = proj(x, 0, cam.z + 80);
            if (p1.ok && p2.ok) {
                g.beginPath();
                g.moveTo(p1.x, p1.y);
                g.lineTo(p2.x, p2.y);
                g.stroke();
            }
        }

        for (const b of obstacles) {
            drawBox(g, proj, b.x, 0, b.z, b.w, b.h, b.d, 0, '#E69F00');
        }

        (function drawPlayer() {
            // player cube-thing
            const halfW = charDims.halfW, halfD = charDims.halfD, height = charDims.height;
            const cosY = Math.cos(rad(sim.yaw)), sinY = Math.sin(rad(sim.yaw));

            const corners = [
                { x: -halfW, y: 0, z: -halfD },
                { x: halfW, y: 0, z: -halfD },
                { x: halfW, y: 0, z: halfD },
                { x: -halfW, y: 0, z: halfD },
                { x: -halfW, y: height, z: -halfD },
                { x: halfW, y: height, z: -halfD },
                { x: halfW, y: height, z: halfD },
                { x: -halfW, y: height, z: halfD }
            ].map(c => {
                const rx = c.x * cosY - c.z * sinY;
                const rz = c.x * sinY + c.z * cosY;
                return proj(sim.x + rx, sim.y + c.y, sim.z + rz);
            });

            function edge(i, j) {
                const a = corners[i], b = corners[j];
                if (a.ok && b.ok) {
                    g.beginPath();
                    g.moveTo(a.x, a.y);
                    g.lineTo(b.x, b.y);
                    g.stroke();
                }
            }

            g.strokeStyle = '#0072B2'; g.lineWidth = 2;
            edge(0, 1);
            edge(1, 2);
            edge(2, 3);
            edge(3, 0);
            edge(4, 5);
            edge(5, 6);
            edge(6, 7);
            edge(7, 4);
            edge(0, 4);
            edge(1, 5);
            edge(2, 6);
            edge(3, 7);

            // facing line
            const start = proj(sim.x, sim.y + height * 0.5, sim.z);
            const dirX = Math.sin(rad(sim.yaw)), dirZ = Math.cos(rad(sim.yaw));
            const end = proj(sim.x + dirX * 3, sim.y + height * 0.5, sim.z + dirZ * 3);
            if (start.ok && end.ok) {
                g.strokeStyle = '#ffffff';
                g.lineWidth = 2;
                g.beginPath();
                g.moveTo(start.x, start.y);
                g.lineTo(end.x, end.y);
                g.stroke();
            }
        })();

        // goal gate
        const gateZ = goal;
        const leftGateX = -course.width * 0.5 + ABS.goalInset;
        const rightGateX = course.width * 0.5 - ABS.goalInset;

        for (let side of [leftGateX, rightGateX]) {
            const base = proj(side, 0, gateZ);
            const top = proj(side, 5, gateZ);
            if (base.ok && top.ok) {
                g.strokeStyle = '#CC79A7';
                g.lineWidth = 3;
                g.beginPath();
                g.moveTo(base.x, base.y);
                g.lineTo(top.x, top.y);
                g.stroke();
            }
        }

        const l = proj(leftGateX, 5, gateZ), r = proj(rightGateX, 5, gateZ);
        if (l.ok && r.ok) {
            g.beginPath();
            g.moveTo(l.x, l.y);
            g.lineTo(r.x, r.y);
            g.stroke();
        }

        if (!started && !sim.finished) {
            g.fillStyle = 'rgba(0,0,0,0.5)';
            g.fillRect(0, 0, W, H);
            g.fillStyle = '#8affb2';
            g.font = '20px system-ui';
            g.textAlign = 'center';
            g.fillText('Move to start', W / 2, H / 2);
            g.textAlign = 'left';
        }

        if (sim.finished) {
            g.fillStyle = 'rgba(0,0,0,0.5)';
            g.fillRect(0, 0, W, H);
            g.fillStyle = '#8affb2';
            g.font = '24px system-ui';
            g.textAlign = 'center';
            g.fillText(`Finished! Time: ${sim.elapsed.toFixed(2)} s`, W / 2, H / 2);
            g.textAlign = 'left';
        }

        chartFwd?.draw();
        chartYaw?.draw();
        chartETA?.draw();
        chartMag?.draw();
        drawTop();
    }

    window.addEventListener('keydown', e => {
        if (e.key === 'r' || e.key === 'R') reset();
        if (e.key === 'p' || e.key === 'P') paused = !paused;
        if (e.key === 'q' || e.key === 'Q') sim.yaw -= 45;
        if (e.key === 'e' || e.key === 'E') sim.yaw += 45;
        if (e.key === 'c' || e.key === 'C') {
            camMode = (camMode === 'behind') ? 'side' : 'behind';
        }
    });

    reset();
    markKeys();
    step();
})();