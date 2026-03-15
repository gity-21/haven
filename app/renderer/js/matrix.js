/**
 * matrix.js - Matrix Digital Rain Effect
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'matrix-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '0'; // Arkada kalması için
    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 0.8s ease-in-out';
    document.body.prepend(canvas); // En arkaya ekleyelim

    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const characters = '日ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const fontSize = 16;
    let columns = width / fontSize;
    const drops = [];

    for (let x = 0; x < columns; x++) {
        drops[x] = 1;
    }

    let matrixInterval = null;
    let isMatrixActive = false;

    function draw() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#0F0';
        ctx.font = fontSize + 'px monospace';

        for (let i = 0; i < drops.length; i++) {
            const text = characters[Math.floor(Math.random() * characters.length)];
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);

            if (drops[i] * fontSize > height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }
    }

    window.addEventListener('resize', () => {
        if (!isMatrixActive) return;
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        columns = width / fontSize;
        drops.length = 0;
        for (let x = 0; x < columns; x++) {
            drops[x] = 1;
        }
    });

    function checkTheme() {
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'hacker') {
            if (!isMatrixActive) {
                isMatrixActive = true;
                canvas.style.opacity = '0.35'; // Biraz şeffaf, yazıları kapatmasın
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, width, height);
                matrixInterval = setInterval(draw, 33);
            }
        } else {
            if (isMatrixActive) {
                isMatrixActive = false;
                canvas.style.opacity = '0';
                clearInterval(matrixInterval);
                matrixInterval = null;
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

    // İlk yüklemede kontrol et
    setTimeout(checkTheme, 50);
});
