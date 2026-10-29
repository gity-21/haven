/**
 * kinetic-grid.ts — Kinetic Grid Background Effect
 *
 * "Space" / Klasik teması aktif olduğunda canvas üzerine etkileşimli
 * kinetik ızgara animasyonu çizer. Mouse yaklaşınca ızgara bükülür,
 * tıklanınca dalga yayılır.
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'kinetic-grid-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 0.8s ease-in-out';
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d')!;

    // ── Constants ────────────────────────────────────────────────────────────
    const CELL_SIZE = 55;
    const INFLUENCE_RADIUS = 260;
    const MAX_WARP = 24;
    const DOT_SPACING = 28;
    const LERP_SPEED = 0.08;
    const LINE_BASE = { r: 255, g: 255, b: 255, a: 0.13 };
    const NODE_BASE_RADIUS = 1.8;
    const NODE_ACTIVE_RADIUS = 3.2;

    interface Point { x: number; y: number; }
    interface Ripple { x: number; y: number; radius: number; opacity: number; born: number; }

    // ── State ────────────────────────────────────────────────────────────────
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const mouse: Point = { x: -9999, y: -9999 };
    const targetMouse: Point = { x: -9999, y: -9999 };
    const ripples: Ripple[] = [];
    let rafId = 0;
    let isActive = false;

    // ── Helpers ──────────────────────────────────────────────────────────────
    function lerpN(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    function lerpColor(
        base: { r: number; g: number; b: number; a: number },
        active: { r: number; g: number; b: number; a: number },
        t: number
    ): string {
        const r = Math.round(lerpN(base.r, active.r, t));
        const g = Math.round(lerpN(base.g, active.g, t));
        const b = Math.round(lerpN(base.b, active.b, t));
        const a = lerpN(base.a, active.a, t);
        return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }

    function getWarpedPoint(
        gx: number, gy: number,
        col: number, row: number,
        cols: number, rows: number
    ): { pt: Point; proximity: number } {
        const edgeMargin = 1.5;
        const colPin = Math.min(col / edgeMargin, (cols - 1 - col) / edgeMargin, 1);
        const rowPin = Math.min(row / edgeMargin, (rows - 1 - row) / edgeMargin, 1);
        const pinFactor = colPin * colPin * rowPin * rowPin;

        const dx = gx - mouse.x;
        const dy = gy - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const proximity = Math.max(0, 1 - dist / INFLUENCE_RADIUS) * pinFactor;

        // Ripple displacement
        let rx = 0, ry = 0;
        for (const r of ripples) {
            const rdx = gx - r.x;
            const rdy = gy - r.y;
            const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
            const waveWidth = 55;
            const diff = rdist - r.radius;
            if (Math.abs(diff) < waveWidth) {
                const strength = (1 - Math.abs(diff) / waveWidth) * r.opacity * 18 * pinFactor;
                const angle = Math.atan2(rdy, rdx);
                const sign = diff < 0 ? -1 : 1;
                rx += Math.cos(angle) * strength * sign * -1;
                ry += Math.sin(angle) * strength * sign * -1;
            }
        }

        // Cursor warp
        if (dist < INFLUENCE_RADIUS && dist > 0 && pinFactor > 0) {
            const t = dist / INFLUENCE_RADIUS;
            const eased = t < 0.01 ? 0 : (1 - t) * (1 - t) * Math.min(1, dist / 60);
            const warpAmt = eased * MAX_WARP * pinFactor;
            const angle = Math.atan2(dy, dx);
            return {
                pt: {
                    x: gx - Math.cos(angle) * warpAmt + rx,
                    y: gy - Math.sin(angle) * warpAmt + ry
                },
                proximity
            };
        }

        return { pt: { x: gx + rx, y: gy + ry }, proximity };
    }

    // ── Draw ─────────────────────────────────────────────────────────────────
    function draw(now: number): void {
        const lineActive = { r: 255, g: 255, b: 255, a: 0.95 };
        const nodeActive = { r: 255, g: 255, b: 255, a: 1.0 };
        const glowColor = '255,255,255';
        const rippleColor = '255,255,255';

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, width, height);

        // Static dot texture
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let x = DOT_SPACING / 2; x < width; x += DOT_SPACING) {
            for (let y = DOT_SPACING / 2; y < height; y += DOT_SPACING) {
                ctx.beginPath();
                ctx.arc(x, y, 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Update ripples
        for (let i = ripples.length - 1; i >= 0; i--) {
            const r = ripples[i];
            const age = (now - r.born) / 1000;
            r.radius = Math.max(0, age * 400);
            r.opacity = Math.max(0, 1 - age * 1.2);
            if (r.opacity <= 0) ripples.splice(i, 1);
        }

        // Build warped grid
        const cols = Math.max(2, Math.ceil(width / CELL_SIZE)) + 1;
        const rows = Math.max(2, Math.ceil(height / CELL_SIZE)) + 1;
        const cellW = width / (cols - 1);
        const cellH = height / (rows - 1);

        const pts: Point[][] = [];
        const prox: number[][] = [];

        for (let row = 0; row < rows; row++) {
            pts[row] = [];
            prox[row] = [];
            for (let col = 0; col < cols; col++) {
                const { pt, proximity } = getWarpedPoint(col * cellW, row * cellH, col, row, cols, rows);
                pts[row][col] = pt;
                prox[row][col] = proximity;
            }
        }

        // Grid lines
        const drawSeg = (p1: Point, p2: Point, pr1: number, pr2: number) => {
            const avg = (pr1 + pr2) / 2;
            const t = avg * avg * (3 - 2 * avg); // smoothstep
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = lerpColor(LINE_BASE, lineActive, t);
            ctx.lineWidth = lerpN(0.8, 1.5, t);
            ctx.stroke();
        };

        ctx.lineCap = 'butt';

        for (let row = 0; row < rows; row++)
            for (let col = 0; col < cols - 1; col++)
                drawSeg(pts[row][col], pts[row][col + 1], prox[row][col], prox[row][col + 1]);

        for (let col = 0; col < cols; col++)
            for (let row = 0; row < rows - 1; row++)
                drawSeg(pts[row][col], pts[row + 1][col], prox[row][col], prox[row + 1][col]);

        // Intersection nodes
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const p = pts[row][col];
                const pr = prox[row][col];
                const t = pr * pr * (3 - 2 * pr);
                const r = lerpN(NODE_BASE_RADIUS, NODE_ACTIVE_RADIUS, t);

                if (t > 0.3) {
                    const glowR = r + lerpN(0, 6, (t - 0.3) / 0.7);
                    const grd = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, glowR);
                    grd.addColorStop(0, `rgba(${glowColor},${(t * 0.3).toFixed(3)})`);
                    grd.addColorStop(1, `rgba(${glowColor},0)`);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
                    ctx.fillStyle = grd;
                    ctx.fill();
                }

                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fillStyle = lerpColor({ r: 255, g: 255, b: 255, a: 0.2 }, nodeActive, t);
                ctx.fill();
            }
        }

        // Ripple rings
        for (const r of ripples) {
            const safeRadius = Math.max(0, r.radius);
            ctx.beginPath();
            ctx.arc(r.x, r.y, safeRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${rippleColor},${(r.opacity * 0.28).toFixed(3)})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    // ── Animation loop ────────────────────────────────────────────────────────
    function frame(now: number): void {
        rafId = 0;
        if (!isActive || document.hidden) return;

        mouse.x = lerpN(mouse.x, targetMouse.x, LERP_SPEED);
        mouse.y = lerpN(mouse.y, targetMouse.y, LERP_SPEED);

        draw(now);
        rafId = requestAnimationFrame(frame);
    }

    function wake(): void {
        if (!rafId && isActive && !document.hidden) rafId = requestAnimationFrame(frame);
    }

    // ── Events ────────────────────────────────────────────────────────────────
    const onMouseMove = (e: MouseEvent) => {
        if (!isActive) return;
        targetMouse.x = e.clientX;
        targetMouse.y = e.clientY;
    };

    const onClick = (e: MouseEvent) => {
        if (!isActive) return;
        ripples.push({ x: e.clientX, y: e.clientY, radius: 0, opacity: 1, born: performance.now() });
        wake();
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('click', onClick, { passive: true });

    window.addEventListener('resize', () => {
        if (!isActive) return;
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isActive) wake();
    });

    // ── Theme check ───────────────────────────────────────────────────────────
    function checkTheme(): void {
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'space') {
            if (!isActive) {
                isActive = true;
                width = canvas.width = window.innerWidth;
                height = canvas.height = window.innerHeight;
                canvas.style.opacity = '1';
                wake();
            }
        } else {
            if (isActive) {
                isActive = false;
                canvas.style.opacity = '0';
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            }
        }
    }

    const observer = new MutationObserver((mutations: MutationRecord[]) => {
        mutations.forEach((m: MutationRecord) => {
            if (m.attributeName === 'data-theme') checkTheme();
        });
    });

    observer.observe(document.documentElement, { attributes: true });
    setTimeout(checkTheme, 50);
});

