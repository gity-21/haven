const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, 'app/renderer/js/chat.js');
const destDir = path.join(__dirname, 'app/renderer/js/chat');

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

const lines = fs.readFileSync(srcFile, 'utf8').split('\n');

function writePart(filename, startLine, endLine) {
    // startLine and endLine are 1-indexed
    const content = lines.slice(startLine - 1, endLine).join('\n');
    fs.writeFileSync(path.join(destDir, filename), content, 'utf8');
    console.log(`Wrote ${filename} (Lines ${startLine}-${endLine})`);
}

// 1. core.js (State, Config, DOM Elements, Ringtone)
// Lines 1 to 153
writePart('core.js', 1, 153);

// 2. crypto.js (E2EE)
// Lines 155 to 286
writePart('crypto.js', 154, 286);

// 3. socket.js (Socket.io event listeners)
// Lines 288 to 974
writePart('socket.js', 287, 974);

// 4. ui.js (DOM manipulation, appendMessage, utils)
// Lines 975 to 1526
// Also includes 2580 to 2760 (Toast, escapeHtml, renderUsersModal)
const uiPart1 = lines.slice(974, 1526).join('\n');
const uiPart2 = lines.slice(2579, 2760).join('\n');
fs.writeFileSync(path.join(destDir, 'ui.js'), uiPart1 + '\n' + uiPart2, 'utf8');
console.log(`Wrote ui.js (Lines 975-1526 + 2580-2760)`);

// 5. webrtc.js (Voice/Video calls, Screen Share)
// Lines 2761 to 3831
writePart('webrtc.js', 2761, 3831);

// 6. media.js (Voice memos, Audio Player)
// Lines 3832 to 4171
// Also, we should probably put setupEventListeners inside main.js
writePart('media.js', 3832, lines.length);

// 7. main.js (Entry point: setupEventListeners and connectSocket invocation)
// Lines 1527 to 2579
writePart('main.js', 1527, 2579);

console.log("Done slicing chat.js");
