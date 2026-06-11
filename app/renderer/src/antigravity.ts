/**
 * antigravity.js - Organic fluid particle system (Light Theme)
 */
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'antigravity-canvas';
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

    const ctx = canvas.getContext('2d', { alpha: false });
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    let mouseX = -1000;
    let mouseY = -1000;
    let lastMouseX = -1000;
    let lastMouseY = -1000;
    let mouseDisturbance = 0;
    let isAntigravityActive = false;
    let animationFrameId = null;

    // Google brand colors
    const colors = ['#4285F4', '#EA4335', '#FBBC05', '#34A853'];

    let particles = [];

    // Pseudo-noise function for organic chaos
    function getNoise(x, y, time) {
        return Math.sin(x * 0.003 + time * 0.5) * Math.cos(y * 0.003 + time * 0.4) +
            Math.sin(y * 0.004 - time * 0.3) * Math.cos(x * 0.005 + time * 0.6);
    }

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.baseX = this.x;
            this.baseY = this.y;
            this.vx = 0;
            this.vy = 0;
            // Particles are 1 to 2.5 pixels in radius
            this.size = Math.random() * 1.5 + 1;
            this.color = colors[Math.floor(Math.random() * colors.length)];
            // Unique offsets for organic wandering
            this.wanderOffsetX = Math.random() * 100;
            this.wanderOffsetY = Math.random() * 100;

            this.opacity = 0.15; // default subtle state
        }

        update(time) {
            // Organic wandering around the base point
            let targetX = this.baseX + Math.sin(time * 0.5 + this.wanderOffsetX) * 30;
            let targetY = this.baseY + Math.cos(time * 0.4 + this.wanderOffsetY) * 30;

            const dx = this.x - mouseX; // From mouse to particle
            const dy = this.y - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Interaction area radius increased significantly (~550px)
            const maxDist = 550;
            let targetOpacity = 0.15; // default low opacity

            // If inside the influence region
            if (dist < maxDist) {
                const normalizedDist = dist / maxDist;

                // Opacity increases significantly when affected
                // It fades out smoothly towards the edges
                targetOpacity = 0.15 + Math.pow(1 - normalizedDist, 1.2) * 0.85;

                // Calculate base pushing force
                let force = Math.pow(1 - normalizedDist, 1.8);

                // Add wave propagation based on mouse movement speed (mouseDisturbance)
                // The ripple moves outwards, making particles swell based on their distance
                const ripple = Math.sin(normalizedDist * 8 - time * 4) * mouseDisturbance * 0.5;
                force += ripple * Math.pow(1 - normalizedDist, 0.5); // ripple is stronger closer

                if (dist > 1) {
                    let dirX = dx / dist;
                    let dirY = dy / dist;

                    // Use noise to organically break perfect symmetry
                    // It creates irregular, fluid-like vectors instead of straight outward rays
                    const noiseX = getNoise(this.x, this.y, time) * 1.5;
                    const noiseY = getNoise(this.y, this.x, time) * 1.5;

                    const pushForceMultiplier = 1.5;

                    this.vx += (dirX + noiseX) * force * pushForceMultiplier;
                    this.vy += (dirY + noiseY) * force * pushForceMultiplier;
                }
            }

            // Spring return force towards target location (soft stabilization)
            const returnForce = 0.012;
            this.vx += (targetX - this.x) * returnForce;
            this.vy += (targetY - this.y) * returnForce;

            // Fluid friction / damping
            // A higher damping (0.88) allows particles to drift before stopping
            this.vx *= 0.88;
            this.vy *= 0.88;

            this.x += this.vx;
            this.y += this.vy;

            // Smooth opacity transition for a glowing fade effect
            this.opacity += (targetOpacity - this.opacity) * 0.08;
        }
    }

    function initParticles() {
        particles = [];
        // Tanecik yoğunluğu artırıldı (bölen 600)
        const count = Math.floor((width * height) / 600);
        for (let i = 0; i < count; i++) {
            particles.push(new Particle());
        }
    }

    window.addEventListener('mousemove', (e) => {
        if (!isAntigravityActive) return;

        // Calculate mouse movement speed
        const speed = Math.sqrt(Math.pow(e.clientX - lastMouseX, 2) + Math.pow(e.clientY - lastMouseY, 2));

        // Accumulate disturbance from speed (capped at 2.0)
        if (lastMouseX !== -1000) {
            mouseDisturbance = Math.min(2.0, mouseDisturbance + speed * 0.015);
        }

        mouseX = e.clientX;
        mouseY = e.clientY;
        lastMouseX = mouseX;
        lastMouseY = mouseY;
    });

    window.addEventListener('mouseout', () => {
        mouseX = -1000;
        mouseY = -1000;
        lastMouseX = -1000;
        lastMouseY = -1000;
    });

    window.addEventListener('resize', () => {
        if (!isAntigravityActive) return;
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        initParticles();
    });

    function draw() {
        if (!isAntigravityActive) return;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        const time = performance.now() * 0.001;

        // Smoothly decay the mouse wave disturbance
        mouseDisturbance *= 0.94;

        // Group particles by color and opacity to minimize ctx state changes (massive performance boost)
        const groups = {};

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.update(time);

            // Bucket opacity into steps of 0.05 to batch draw them efficiently
            let opBucket = Math.max(0.05, Math.min(1.0, Math.round(p.opacity * 20) / 20));
            const binKey = p.color + '|' + opBucket;

            if (!groups[binKey]) {
                groups[binKey] = { color: p.color, opacity: opBucket, list: [] };
            }
            groups[binKey].list.push(p);
        }

        for (const key in groups) {
            const group = groups[key];
            ctx.fillStyle = group.color;
            ctx.globalAlpha = group.opacity;
            ctx.beginPath();

            for (let i = 0; i < group.list.length; i++) {
                const p = group.list[i];
                ctx.moveTo(p.x + p.size, p.y);
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            }
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        animationFrameId = requestAnimationFrame(draw);
    }

    function checkTheme() {
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'antigravity') {
            if (!isAntigravityActive) {
                isAntigravityActive = true;
                canvas.style.opacity = '1';
                if (particles.length === 0 || canvas.width !== window.innerWidth) {
                    width = canvas.width = window.innerWidth;
                    height = canvas.height = window.innerHeight;
                    initParticles();
                }
                mouseX = -1000;
                mouseY = -1000;
                draw();
            }
        } else {
            if (isAntigravityActive) {
                isAntigravityActive = false;
                canvas.style.opacity = '0';
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            }
        }
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') {
                checkTheme();
            }
        });
    });

    observer.observe(document.documentElement, { attributes: true });

    // İlk denetim
    setTimeout(checkTheme, 50);
});
