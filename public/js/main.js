import * as THREE from 'three';
import { createScene, createRenderer, createCamera, setupLighting } from './world.js';
import { setupEnvironment } from './environment.js';
import { createAvatarMesh, createNameTag } from './avatar.js';
import { CameraController, LocalPlayer } from './player.js';
import { NetworkManager, _applyFaceToDisc } from './network.js';
import { setupLoginScreen, showGame } from './ui.js';
import { BoothManager, BOOTHS } from './booths.js';
import { KickSlapGame   } from './minigames/kickslap.js';
import { FacepaintGame  } from './minigames/facepaint.js';
import { PollsGame      } from './minigames/polls.js';
import { RacealongGame  } from './minigames/racealong.js';
import { SpeedmathsGame } from './minigames/speedmaths.js';
import { PetManager, PET_DEFS } from './pets.js';
import { FlappyChopperGame } from './minigames/flappychopper.js';
import { VirtualJoystick, ZoomButtons } from './joystick.js';

// ─────────────────────────────────────────────────────────────
// Three.js Setup
// ─────────────────────────────────────────────────────────────
const canvas   = document.getElementById('gameCanvas');
const scene    = createScene();
const renderer = createRenderer(canvas);
const camera   = createCamera();

setupLighting(scene);
setupEnvironment(scene);

const network     = new NetworkManager(scene);
const boothMgr    = new BoothManager(scene);

let localPlayer   = null;
let camCtrl       = null;
let localNameTag  = null;
let localFaceDisc = null;   // faceDisc des eigenen Avatars (für Facepaint-Update)

// Laufendes Minigame
let activeMinigame = null;

// Haustier-Manager
let petManager = null;
// Aktuell bekannte pet-Vergaben (wird bei petAdopted/petReturned aktualisiert)
let currentPetOwners = {};
// Eigenes Haustier
let myPetId = null;

// Spieler-Name (wird nach Login gesetzt, für Flappy-Chopper-Highscore gebraucht)
let myPlayerName = '';
// Eigene Shirt-, Haut- und Haarfarbe (für Minime-Pet und Avatar)
let myShirtColor = '#5b9bd5';
let mySkinColor  = '#ffce9e';
let myHairStyle  = 'none';
let myHairColor  = '#1a0a05';
// Flappy-Chopper-Highscores (gecached für Panel-Anzeige)
let currentFcHighscores = null;

// ─────────────────────────────────────────────────────────────
// Touch-Steuerung
// ─────────────────────────────────────────────────────────────
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const joyLeftEl  = document.getElementById('joyLeft');
const joyRightEl = document.getElementById('joyRight');
const zoomBtnsEl = document.getElementById('zoomBtns');

let joyLeft  = null;
let joyRight = null;
let zoomBtns = null;

/**
 * Joystick-Modus umschalten.
 * @param {'world'|'kickslap'|'hidden'} mode
 */
function _setJoyMode(mode) {
  if (mode === 'world') {
    joyLeftEl.style.zIndex  = '';
    joyRightEl.style.zIndex = '';
    joyLeftEl.classList.remove('joy-ks-mode', 'hidden');
    joyRightEl.classList.remove('joy-ks-mode', 'hidden');
    joyLeftEl.querySelector('.joy-label').textContent  = '';
    joyRightEl.querySelector('.joy-label').textContent = '';
    zoomBtnsEl.classList.remove('hidden');
  } else if (mode === 'kickslap') {
    joyLeftEl.style.zIndex  = '200';
    joyRightEl.style.zIndex = '200';
    joyLeftEl.classList.add('joy-ks-mode');
    joyRightEl.classList.add('joy-ks-mode');
    joyLeftEl.classList.remove('hidden');
    joyRightEl.classList.remove('hidden');
    joyLeftEl.querySelector('.joy-label').textContent  = '👊 SLAP';
    joyRightEl.querySelector('.joy-label').textContent = '🦵 KICK';
    zoomBtnsEl.classList.add('hidden');
    document.getElementById('btnCamCenter').classList.add('hidden');
  } else if (mode === 'moveonly') {
    // nur linker Joystick (Bewegung im Minigame), kein Kamera-Stick, kein Zoom
    joyLeftEl.style.zIndex  = '200';
    joyRightEl.style.zIndex = '';
    joyLeftEl.classList.remove('joy-ks-mode', 'hidden');
    joyRightEl.classList.add('hidden');
    joyLeftEl.querySelector('.joy-label').textContent  = '';
    joyRightEl.querySelector('.joy-label').textContent = '';
    zoomBtnsEl.classList.add('hidden');
    document.getElementById('btnCamCenter').classList.add('hidden');
  } else { // 'hidden'
    joyLeftEl.classList.add('hidden');
    joyRightEl.classList.add('hidden');
    zoomBtnsEl.classList.add('hidden');
    document.getElementById('btnCamCenter').classList.add('hidden');
  }
}

// Netzwerk-Throttle
let lastSendTime  = 0;
const SEND_MS     = 50;
const SEND_DIST   = 0.04;
const lastSentPos = new THREE.Vector3(99999, 0, 99999);

// Aktuell naher Stand
let currentBoothId = null;

// ─────────────────────────────────────────────────────────────
// Stand-UI
// ─────────────────────────────────────────────────────────────
const boothPanel  = document.getElementById('boothPanel');
const bpName      = document.getElementById('bpName');
const bpBarFill   = document.getElementById('bpBarFill');
const bpPlayerTxt = document.getElementById('bpPlayerText');
const bpStartBtn  = document.getElementById('bpStartBtn');
const bpWaitTxt   = document.getElementById('bpWaitText');

function showBoothPanel(booth, count) {
  const min     = booth.minPlayers;
  const enough  = count >= min;
  const pct     = Math.min(100, (count / min) * 100);

  bpName.textContent      = booth.name;
  bpBarFill.style.width   = pct + '%';
  bpBarFill.style.background = enough ? '#4ade80' : '#38bdf8';
  bpPlayerTxt.textContent = `${count} / ${min} Spieler hier`;
  bpStartBtn.classList.toggle('hidden', !enough);
  bpWaitTxt.classList.toggle('hidden',  enough);

  boothPanel.classList.remove('hidden');
}

function hideBoothPanel() {
  boothPanel.classList.add('hidden');
}

// Start-Button
bpStartBtn.addEventListener('click', () => {
  if (!currentBoothId) return;
  console.log('[Minigame] Starte Minigame an Stand', currentBoothId);
  bpStartBtn.disabled = true;
  setTimeout(() => { bpStartBtn.disabled = false; }, 3000);
  network.sendStartMinigame(currentBoothId);
});

// Fehler-Feedback vom Server (z.B. zu wenig Spieler)
function showBoothError(msg) {
  const existing = document.getElementById('bpErrorMsg');
  if (existing) existing.remove();
  const err = document.createElement('p');
  err.id = 'bpErrorMsg';
  err.style.cssText = 'color:#ff6666;font:13px Arial;margin:4px 0 0;text-align:center;';
  err.textContent = '⚠ ' + msg;
  boothPanel.appendChild(err);
  setTimeout(() => err.remove(), 4000);
}

// ─────────────────────────────────────────────────────────────
// Flappy-Chopper-Panel (Stand 7)
// ─────────────────────────────────────────────────────────────
const flappyPanel = document.getElementById('flappyPanel');

function showFlappyPanel() {
  _renderFlappyPanel();
  flappyPanel.classList.remove('hidden');
}

function hideFlappyPanel() {
  flappyPanel.classList.add('hidden');
}

function _renderFlappyPanel() {
  flappyPanel.innerHTML = '';
  flappyPanel.style.cssText = [
    'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);',
    'background:rgba(4,14,32,0.97);border:2px solid #1abc9c;border-radius:14px;',
    'padding:16px 22px;z-index:50;min-width:300px;max-width:96vw;',
    'box-shadow:0 4px 32px rgba(26,188,156,.35);'
  ].join('');

  // Titel
  const title = document.createElement('div');
  title.style.cssText = 'color:#1affd0;font:bold 20px Arial;text-align:center;margin-bottom:12px;';
  title.textContent = '🚁 Flappy Chopper';
  flappyPanel.appendChild(title);

  // Schaltflächen-Zeile
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-bottom:10px;';

  const startBtn = document.createElement('button');
  startBtn.textContent = '▶ Spielen';
  startBtn.style.cssText = [
    'padding:10px 22px;font:bold 15px Arial;cursor:pointer;border-radius:8px;',
    'border:none;background:#1abc9c;color:#fff;'
  ].join('');
  startBtn.addEventListener('click', () => {
    hideFlappyPanel();
    _pauseWorld();
    if (camCtrl) camCtrl.setEnabled(false);
    _setJoyMode('hidden');

    const game = new FlappyChopperGame(network.selfId, myPlayerName, network.socket);
    activeMinigame = game;

    let removeLeaveBtn = null;
    const origStop = game.stop.bind(game);
    game.stop = () => {
      if (removeLeaveBtn) { removeLeaveBtn(); removeLeaveBtn = null; }
      origStop();
      activeMinigame = null;
      if (camCtrl) camCtrl.setEnabled(true);
      _setJoyMode('world');
      _resumeWorld();
      // Panel wieder zeigen, wenn der Spieler noch am Stand steht
      if (currentBoothId === 7) showFlappyPanel();
    };

    game.start();

    // Verlassen-Button (FC ist single-player, kein Server-Emit nötig)
    removeLeaveBtn = _injectLeaveBtn(() => {
      game.stop();
    });
  });
  btnRow.appendChild(startBtn);

  const hsBtn = document.createElement('button');
  hsBtn.textContent = '🏆 Highscore';
  hsBtn.style.cssText = [
    'padding:10px 16px;font:bold 15px Arial;cursor:pointer;border-radius:8px;',
    'border:2px solid #1abc9c;background:transparent;color:#1abc9c;'
  ].join('');
  hsBtn.addEventListener('click', () => {
    network.socket.emit('fc:getHighscore');
  });
  btnRow.appendChild(hsBtn);
  flappyPanel.appendChild(btnRow);

  // Highscore-Liste (wird nachgeladen / aktualisiert)
  const hsList = document.createElement('div');
  hsList.id = 'fcHsList';
  if (currentFcHighscores) _fillHsList(hsList, currentFcHighscores);
  flappyPanel.appendChild(hsList);
}

function _fillHsList(container, scores) {
  container.innerHTML = '';
  if (!scores || scores.length === 0) return;
  const medal = ['🥇', '🥈', '🥉'];
  const header = document.createElement('div');
  header.style.cssText = 'color:#7799ee;font:bold 13px Arial;text-align:center;margin-bottom:4px;';
  header.textContent = '🏆 Bestenliste';
  container.appendChild(header);
  scores.slice(0, 5).forEach((e, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;' +
      'color:#ccccdd;font:13px Arial;padding:1px 6px;';
    const lbl = document.createElement('span');
    lbl.textContent = `${medal[i] || (i + 1) + '.'} ${e.name}`;
    const pts = document.createElement('span');
    pts.style.cssText = 'color:#aaffcc;font-weight:bold;';
    pts.textContent = String(e.score);
    row.append(lbl, pts);
    container.appendChild(row);
  });
}

// ─────────────────────────────────────────────────────────────
// Coming-Soon-Panel (Stand 8)
// ─────────────────────────────────────────────────────────────
const comingSoonPanel = document.getElementById('comingSoonPanel');

function showComingSoonPanel() {
  comingSoonPanel.innerHTML = '';
  comingSoonPanel.style.cssText = [
    'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);',
    'background:rgba(10,4,20,0.97);border:2px solid #d63090;border-radius:14px;',
    'padding:18px 32px;z-index:50;text-align:center;',
    'box-shadow:0 4px 32px rgba(214,48,144,.35);'
  ].join('');

  const emoji = document.createElement('div');
  emoji.style.cssText = 'font-size:36px;margin-bottom:6px;';
  emoji.textContent = '🔜';
  comingSoonPanel.appendChild(emoji);

  const title = document.createElement('div');
  title.style.cssText = 'color:#ff55cc;font:bold 22px Arial;margin-bottom:4px;';
  title.textContent = 'Coming Soon';
  comingSoonPanel.appendChild(title);

  const sub = document.createElement('div');
  sub.style.cssText = 'color:#aa7799;font:14px Arial;';
  sub.textContent = 'Dieses Minigame ist noch in Arbeit.';
  comingSoonPanel.appendChild(sub);

  comingSoonPanel.classList.remove('hidden');
}

function hideComingSoonPanel() {
  comingSoonPanel.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────
// Pet-Panel (Stand 6)
// ─────────────────────────────────────────────────────────────
const petPanel = document.getElementById('petPanel');

function showPetPanel() {
  _renderPetPanel();
  petPanel.classList.remove('hidden');
}

function hidePetPanel() {
  petPanel.classList.add('hidden');
}

function _renderPetPanel() {
  petPanel.innerHTML = '';
  petPanel.style.cssText = [
    'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);',
    'background:rgba(10,10,30,0.96);border:1px solid #4a4aff;border-radius:14px;',
    'padding:14px 18px;z-index:50;min-width:320px;max-width:96vw;',
    'box-shadow:0 4px 32px rgba(80,80,255,.25);'
  ].join('');

  // Titel
  const title = document.createElement('div');
  title.style.cssText = 'color:#fff;font:bold 18px Arial;text-align:center;margin-bottom:10px;';
  title.textContent = '🐾 Adopt a Pet';
  petPanel.appendChild(title);

  // "Mein Haustier" Zeile
  if (myPetId) {
    const def  = PET_DEFS.find(p => p.id === myPetId);
    const row  = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
      'background:#1a1a3a;border-radius:8px;padding:6px 10px;margin-bottom:10px;';
    const lbl  = document.createElement('span');
    lbl.style.cssText = 'color:#ffff88;font:bold 14px Arial;';
    lbl.textContent   = `${def?.emoji || '🐾'} Dein Haustier: ${def?.name || myPetId}`;
    const retBtn      = document.createElement('button');
    retBtn.textContent = '↩ Zurückgeben';
    retBtn.style.cssText = 'padding:4px 10px;cursor:pointer;border-radius:6px;' +
      'border:1px solid #ff6666;background:#2a0000;color:#ff9999;font:13px Arial;';
    retBtn.addEventListener('click', () => network.sendReturnPet());
    row.append(lbl, retBtn);
    petPanel.appendChild(row);
  }

  // Pet-Grid
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:6px;';

  PET_DEFS.forEach(def => {
    const ownerId = currentPetOwners[def.id];
    const taken   = ownerId !== null && ownerId !== undefined;
    const isMe    = ownerId === (network?.selfId);

    const cell = document.createElement('div');
    cell.style.cssText = [
      'display:flex;flex-direction:column;align-items:center;gap:3px;',
      'padding:6px 4px;border-radius:8px;cursor:pointer;',
      `background:${isMe ? '#1a2a5a' : taken ? '#1a1a1a' : '#111133'};`,
      `border:1px solid ${isMe ? '#4a4aff' : taken ? '#333' : '#2a2a60'};`,
      `opacity:${taken && !isMe ? '0.5' : '1'};`,
      `pointer-events:${taken && !isMe ? 'none' : 'auto'};`
    ].join('');

    const emoji = document.createElement('div');
    emoji.style.cssText = 'font-size:22px;';
    emoji.textContent   = def.emoji;

    const name  = document.createElement('div');
    name.style.cssText  = `font:bold 11px Arial;color:${isMe ? '#aaaaff' : taken ? '#555' : '#ccc'};text-align:center;`;
    name.textContent    = def.name;

    const status = document.createElement('div');
    status.style.cssText = `font:10px Arial;color:${isMe ? '#4aff88' : taken ? '#ff6666' : '#4aff88'};`;
    status.textContent   = isMe ? '✓ Meins' : taken ? 'Vergeben' : 'Frei';

    cell.append(emoji, name, status);

    if (!taken) {
      cell.addEventListener('click', () => network.sendAdoptPet(def.id));
      cell.addEventListener('mouseenter', () => { cell.style.background = '#1a2a3a'; });
      cell.addEventListener('mouseleave', () => { cell.style.background = '#111133'; });
    }

    grid.appendChild(cell);
  });

  petPanel.appendChild(grid);
}

// ─────────────────────────────────────────────────────────────
// Verlassen-Button (wird während eines Minigames eingeblendet)
// ─────────────────────────────────────────────────────────────
function _injectLeaveBtn(onLeave) {
  // Doppelte Buttons verhindern
  const existing = document.getElementById('leaveMinigameBtn');
  if (existing) existing.remove();

  const btn = document.createElement('button');
  btn.id = 'leaveMinigameBtn';
  btn.textContent = '✕ Verlassen';
  btn.style.cssText = [
    'position:fixed;top:16px;right:16px;z-index:9999;',
    'padding:8px 16px;font:bold 14px Arial;cursor:pointer;',
    'border-radius:8px;border:2px solid #ff4466;',
    'background:rgba(25,0,8,0.92);color:#ff6688;',
    'box-shadow:0 2px 12px rgba(255,50,80,.40);',
    'transition:background .15s;'
  ].join('');
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(80,0,20,0.97)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(25,0,8,0.92)'; });
  btn.addEventListener('click', () => {
    btn.remove();
    onLeave();
  });
  document.body.appendChild(btn);

  // Gibt eine Entfernen-Funktion zurück
  return () => { const b = document.getElementById('leaveMinigameBtn'); if (b) b.remove(); };
}

function _showAbortedMsg(msg) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
    'background:rgba(20,4,8,0.97);border:2px solid #ff4466;border-radius:12px;',
    'padding:18px 30px;z-index:10000;color:#ff8899;',
    'font:bold 16px Arial;text-align:center;',
    'box-shadow:0 4px 24px rgba(255,50,80,.45);'
  ].join('');
  el.textContent = '⚠ ' + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────
setupLoginScreen(({ name, faceData, skinColor, shirtColor, hairStyle, hairColor }) => {
  myPlayerName  = name || 'Spieler';
  myShirtColor  = shirtColor || '#5b9bd5';
  mySkinColor   = skinColor  || '#ffce9e';
  myHairStyle   = hairStyle  || 'none';
  myHairColor   = hairColor  || '#1a0a05';

  // Avatar
  const parts  = createAvatarMesh(faceData, shirtColor, skinColor, myHairStyle, myHairColor);
  localFaceDisc = parts.faceDisc;
  localNameTag = createNameTag(name);
  localNameTag.position.y = 3.55;
  parts.group.add(localNameTag);
  scene.add(parts.group);

  // Kamera + Spieler
  camCtrl     = new CameraController(camera);
  localPlayer = new LocalPlayer(parts);

  // Netzwerk
  network.connect({ name, faceData, skinColor, shirtColor, hairStyle: myHairStyle, hairColor: myHairColor }, ({ spawnX, spawnZ }) => {
    localPlayer.setPosition(spawnX, 0, spawnZ);
  });

  // Booth-Zaehler von anderen Spielern empfangen
  network.onBoothCounts = (counts) => {
    boothMgr.updateCounts(counts);
    // Panel aktualisieren falls gerade am Stand –
    // Stand 6 (Pets), 7 (Flappy), 8 (Coming Soon) haben eigene Panels → überspringen
    if (currentBoothId && currentBoothId < 6) {
      const booth = BOOTHS.find(b => b.id === currentBoothId);
      if (booth) showBoothPanel(booth, counts[currentBoothId] || 0);
    }
  };

  // Eigenes Gesicht wurde durch Facepaint geändert → lokalen Avatar sofort updaten
  network.onPlayerFaceUpdate = (faceData) => {
    _applyFaceToDisc(localFaceDisc, faceData);
  };

  // Haustier-Manager initialisieren
  petManager = new PetManager(scene);

  network.onPetAdopted = (socketId, petId, owners) => {
    currentPetOwners = owners;
    // Startposition und Shirt-Farbe des Besitzers ermitteln
    let spawnPos   = null;
    let shirtColor = '#5b9bd5';
    let skinColor  = '#ffce9e';
    if (socketId === network.selfId) {
      spawnPos   = localPlayer?.position?.clone();
      myPetId    = petId;
      shirtColor = myShirtColor;
      skinColor  = mySkinColor;
    } else {
      const remote = network.remotePlayers.get(socketId);
      spawnPos   = remote?.group?.position?.clone();
      shirtColor = remote?.shirtColor || '#5b9bd5';
      skinColor  = remote?.skinColor  || '#ffce9e';
    }
    petManager.spawn(socketId, petId, spawnPos, shirtColor, skinColor);
    // Pet-Panel aktualisieren wenn offen
    if (currentBoothId === 6) _renderPetPanel();
  };

  network.onPetReturned = (socketId, petId, owners) => {
    currentPetOwners = owners;
    petManager.despawn(socketId);
    if (socketId === network.selfId) myPetId = null;
    if (currentBoothId === 6) _renderPetPanel();
  };

  // Flappy Chopper – Highscore empfangen
  network.socket.on('fc:highscore', (scores) => {
    currentFcHighscores = scores;
    // Panel sofort aktualisieren wenn gerade Stand 7 offen ist
    if (currentBoothId === 7) {
      const hsList = document.getElementById('fcHsList');
      if (hsList) _fillHsList(hsList, scores);
    }
  });

  // Fehler beim Starten (zu wenig Spieler o.ä.)
  network.onMinigameError = (msg) => {
    bpStartBtn.disabled = false;
    showBoothError(msg);
  };

  // Server bricht Spiel ab (Spieler verlassen / Disconnect)
  network.socket.on('minigameAborted', ({ reason }) => {
    if (activeMinigame) {
      activeMinigame.stop();   // stop() räumt bereits alles auf
    }
    _showAbortedMsg(reason || 'Das Spiel wurde abgebrochen.');
  });

  // Minigame gestartet → passendes Spiel-Objekt erzeugen
  network.onMinigameStarted = (data) => {
    // Laufendes Spiel sauber beenden
    if (activeMinigame) { activeMinigame.stop(); activeMinigame = null; }

    // 3D-Welt pausieren (verhindert GPU-Überlastung durch doppelte Render-Loops)
    _pauseWorld();
    if (camCtrl) camCtrl.setEnabled(false);

    // Joystick-Modus anpassen
    if (data.gameType === 'kickslap') {
      _setJoyMode('kickslap');
    } else if (data.gameType === 'racealong') {
      _setJoyMode('moveonly');   // linker Joystick für Fahrsteuerung
    } else {
      _setJoyMode('hidden');
    }

    const socket = network.socket;
    const selfId = network.selfId;

    let game = null;
    switch (data.gameType) {
      // Joysticks werden übergeben: linker Stick = Bewegen+SLAP-Tap, rechter = KICK-Tap
      case 'kickslap':   game = new KickSlapGame(selfId, data, socket, joyLeft, joyRight);  break;
      case 'racealong':  game = new RacealongGame(selfId, data, socket, joyLeft);            break;
      case 'facepaint':  game = new FacepaintGame(selfId, data, socket);                     break;
      case 'polls':      game = new PollsGame(selfId, data, socket);                         break;
      case 'speedmaths': game = new SpeedmathsGame(selfId, data, socket);                    break;
      default:
        console.warn('Unbekanntes Minigame:', data.gameType);
        _setJoyMode('world');
        _resumeWorld();
        if (camCtrl) camCtrl.setEnabled(true);
        return;
    }

    activeMinigame = game;

    // 3D-Welt + Verlassen-Button aufräumen wenn Spiel endet
    let removeLeaveBtn = null;
    const origStop = game.stop.bind(game);
    game.stop = () => {
      if (removeLeaveBtn) { removeLeaveBtn(); removeLeaveBtn = null; }
      origStop();
      activeMinigame = null;
      if (camCtrl) camCtrl.setEnabled(true);
      _setJoyMode('world');
      _resumeWorld();
    };

    game.start();

    // Verlassen-Button einblenden
    removeLeaveBtn = _injectLeaveBtn(() => {
      network.socket.emit('leaveMinigame');
      game.stop();
    });
  };

  showGame();

  // ── Touch-Steuerung aktivieren (immer, nicht nur auf Touch-Geräten) ──
  joyLeft  = new VirtualJoystick(joyLeftEl);
  joyRight = new VirtualJoystick(joyRightEl);
  zoomBtns = new ZoomButtons(
    document.getElementById('btnZoomIn'),
    document.getElementById('btnZoomOut')
  );

  // Joysticks + Zoom + CamCenter immer anzeigen (auch auf Touchscreen-Laptops)
  document.body.classList.add('touch-mode');
  joyLeftEl.classList.remove('hidden');
  joyRightEl.classList.remove('hidden');
  zoomBtnsEl.classList.remove('hidden');
  document.getElementById('btnCamCenter').classList.remove('hidden');

  // Auf echten Touch-Geräten: Tastatur-Hinweise ausblenden
  if (isTouchDevice) {
    document.getElementById('hudRight')?.classList.add('hidden');
    document.getElementById('desktopHint')?.classList.add('hidden');
    document.getElementById('touchHint')?.classList.remove('hidden');
  }

  // ── Kamera-Zentrieren-Button ────────────────────────────────
  const btnCamCenter = document.getElementById('btnCamCenter');
  btnCamCenter.addEventListener('click', () => {
    if (!camCtrl) return;
    camCtrl.followMode = !camCtrl.followMode;
    btnCamCenter.classList.toggle('active', camCtrl.followMode);
  });
  btnCamCenter.addEventListener('touchstart', e => {
    e.preventDefault();
    if (!camCtrl) return;
    camCtrl.followMode = !camCtrl.followMode;
    btnCamCenter.classList.toggle('active', camCtrl.followMode);
  }, { passive: false });

  // Wenn der Spieler die Kamera manuell dreht, deaktiviert sich Follow-Modus
  // (wird aus CameraController zurück gemeldet)
  if (camCtrl) {
    camCtrl.onManualControl = () => {
      btnCamCenter.classList.remove('active');
    };
  }

  // ── Vollbild-Button ─────────────────────────────────────────
  const btnFullscreen = document.getElementById('btnFullscreen');

  // iOS erkennen (Safari unterstützt requestFullscreen nicht)
  const _isIOS        = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const _isStandalone = !!window.navigator.standalone;   // true wenn als PWA geöffnet

  // Auf iOS im Standalone-Modus ist Vollbild bereits aktiv → Button verstecken
  if (_isStandalone) {
    btnFullscreen.classList.add('hidden');
  } else {
    btnFullscreen.classList.remove('hidden');
  }

  function _requestFS() {
    const el = document.documentElement;
    if      (el.requestFullscreen)           el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen)     el.webkitRequestFullscreen();
  }
  function _exitFS() {
    if      (document.exitFullscreen)        document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen)  document.webkitExitFullscreen();
  }
  function _lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock)
        screen.orientation.lock('landscape').catch(() => {});
    } catch (_) {}
  }
  function _isFS() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function _onFSChange() {
    if (_isFS()) {
      btnFullscreen.classList.add('fs-active');
      btnFullscreen.title = 'Vollbild beenden';
      _lockLandscape();
    } else {
      btnFullscreen.classList.remove('fs-active');
      btnFullscreen.title = 'Vollbild (Querformat)';
    }
  }
  document.addEventListener('fullscreenchange',       _onFSChange);
  document.addEventListener('webkitfullscreenchange', _onFSChange);

  // Anleitung für iOS: "Zum Home-Bildschirm hinzufügen"
  function _showIOSHint() {
    document.getElementById('iosHint')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'iosHint';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.72);',
      'display:flex;align-items:flex-end;justify-content:center;',
      'z-index:9999;padding:0 16px 40px;'
    ].join('');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#1e293b;border:1px solid rgba(255,255,255,0.15);',
      'border-radius:20px;padding:22px 24px 18px;width:100%;max-width:340px;',
      'text-align:center;color:#f1f5f9;font-family:system-ui,sans-serif;',
      'box-shadow:0 -4px 40px rgba(0,0,0,0.5);'
    ].join('');

    box.innerHTML = `
      <div style="font-size:30px;margin-bottom:10px;">📱</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:10px;">
        Vollbild auf iPhone / iPad
      </div>
      <div style="font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:18px;">
        Safari unterstützt kein direktes Vollbild.<br>
        Tippe unten auf
        <strong style="color:#38bdf8;">Teilen&nbsp;&#x2191;&#x25A1;</strong>
        und dann auf<br>
        <strong style="color:#38bdf8;">„Zum Home-Bildschirm"</strong>.<br>
        Das Spiel startet dann im Querformat-Vollbild.
      </div>
      <button id="iosHintClose" style="
        width:100%;padding:11px;border-radius:12px;border:none;
        background:rgba(56,189,248,0.22);color:#7dd3fc;
        font-size:15px;font-weight:700;cursor:pointer;
      ">Verstanden</button>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('iosHintClose').addEventListener('click', () => overlay.remove());
  }

  btnFullscreen.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (_isIOS) {
      _showIOSHint();
    } else {
      _isFS() ? _exitFS() : _requestFS();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Render-Loop
// ─────────────────────────────────────────────────────────────
let _rafId    = null;
let _lastAnimTs = 0;

function _pauseWorld() {
  // Three.js-Canvas verstecken und RAF-Loop pausieren
  canvas.style.display = 'none';
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
}

function _resumeWorld() {
  canvas.style.display = '';
  if (!_rafId) {
    // Booth-Zugehörigkeit zurücksetzen – Proximity-Check wertet sie
    // im nächsten Frame sauber neu aus
    currentBoothId = null;
    network.sendLeftBooth();
    animate();
  }
}

function animate(ts = 0) {
  _rafId = requestAnimationFrame(animate);
  const dt = Math.min((ts - _lastAnimTs) / 1000, 0.05);
  _lastAnimTs = ts;

  // Haustiere animieren
  if (petManager && localPlayer) {
    petManager.update(dt, network.selfId, localPlayer.mesh, network.remotePlayers);
  }

  if (localPlayer && camCtrl) {
    // Remote-Spieler zuerst auf aktuelle Positionen bringen (für Kollisions-Check)
    network.updateRemotePlayers(camera);

    // Name-Tags zur Kamera
    if (localNameTag) localNameTag.lookAt(camera.position);

    // Booth-Billboards
    boothMgr.updateBillboards(camera);

    // Positionen aller Remote-Spieler als Kollisions-Hindernisse
    const _obstacles = [];
    network.remotePlayers.forEach(p => { if (p.group) _obstacles.push(p.group.position); });

    localPlayer.update(camCtrl, _obstacles, joyLeft, dt);
    camCtrl.update(localPlayer.position, joyRight, zoomBtns, localPlayer.mesh.rotation.y);

    // ── Naehe zu Staenden pruefen ─────────────────────────
    const nearBooth = boothMgr.checkProximity(localPlayer.position);
    const nearId    = nearBooth ? nearBooth.id : null;

    if (nearId !== currentBoothId) {
      currentBoothId = nearId;
      if (nearId) {
        network.sendNearBooth(nearId);
        if (nearId === 6) {
          hideBoothPanel();
          hideFlappyPanel();
          hideComingSoonPanel();
          showPetPanel();
        } else if (nearId === 7) {
          hideBoothPanel();
          hidePetPanel();
          hideComingSoonPanel();
          showFlappyPanel();
        } else if (nearId === 8) {
          hideBoothPanel();
          hidePetPanel();
          hideFlappyPanel();
          showComingSoonPanel();
        } else {
          hidePetPanel();
          hideFlappyPanel();
          hideComingSoonPanel();
          const count = boothMgr.counts[nearId] || 0;
          showBoothPanel(nearBooth, count);
        }
      } else {
        network.sendLeftBooth();
        hideBoothPanel();
        hidePetPanel();
        hideFlappyPanel();
        hideComingSoonPanel();
      }
    }

    // ── Netzwerk: Position senden (gedrosselt) ─────────────
    const now = Date.now();
    const pos = localPlayer.position;
    if (now - lastSendTime > SEND_MS && pos.distanceTo(lastSentPos) > SEND_DIST) {
      network.sendMove(pos.x, pos.y, pos.z, localPlayer.mesh.rotation.y);
      lastSentPos.copy(pos);
      lastSendTime = now;
    }
  }

  renderer.render(scene, camera);
}

animate();
