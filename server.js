const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const fs         = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { maxHttpBufferSize: 5e6 });

// ─────────────────────────────────────────────────────────────
// Highscore-Persistenz: MongoDB Atlas (primär) + JSON-Datei (Fallback)
// ─────────────────────────────────────────────────────────────
const HIGHSCORE_FILE = path.join(__dirname, 'highscores.json');
let _hsCollection    = null;

// Verbindung zu MongoDB Atlas aufbauen (falls MONGODB_URI gesetzt)
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.log('[Highscore] Kein MONGODB_URI – nutze JSON-Datei.'); return; }
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    _hsCollection = client.db('spielefest').collection('highscores');
    console.log('[Highscore] MongoDB Atlas verbunden');
  } catch (e) {
    console.error('[Highscore] MongoDB-Fehler:', e.message, '– Fallback auf Datei');
  }
})();

// Top-10 lesen
async function _readHighscores() {
  if (_hsCollection) {
    return await _hsCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ score: -1 }).limit(10).toArray();
  }
  try {
    const data = JSON.parse(fs.readFileSync(HIGHSCORE_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// Eintrag hinzufügen → gibt aktualisierte Top-10 zurück
async function _addScore(entry) {
  if (_hsCollection) {
    await _hsCollection.insertOne({ ...entry });
    // Älteste Einträge außerhalb der Top-10 löschen
    const all = await _hsCollection.find({}).sort({ score: -1 }).toArray();
    if (all.length > 10) {
      const overflow = all.slice(10).map(d => d._id);
      await _hsCollection.deleteMany({ _id: { $in: overflow } });
    }
    return await _hsCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ score: -1 }).limit(10).toArray();
  }
  // Datei-Fallback
  try {
    const raw  = fs.readFileSync(HIGHSCORE_FILE, 'utf8');
    const arr  = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    arr.push(entry);
    arr.sort((a, b) => b.score - a.score);
    arr.splice(10);
    fs.writeFileSync(HIGHSCORE_FILE, JSON.stringify(arr, null, 2), 'utf8');
    return arr;
  } catch (e) {
    console.error('[Highscore] Speichern fehlgeschlagen:', e.message);
    return [];
  }
}

// ── HTTP Security-Headers ─────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self' https://unpkg.com; " +
    "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "connect-src 'self' wss: ws:; " +
    "img-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "frame-ancestors 'none';"
  );
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
const MAX_PLAYERS    = 30;
const BOOTH_COUNT    = 8;
const AFK_WARN_MS    = 4 * 60 * 1000;   // 4 Minuten ohne Aktivität → Warnung
const AFK_KICK_MS    = 5 * 60 * 1000;   // 5 Minuten ohne Aktivität → Abmelden
const BOOTH_GAME_MAP    = { 1: 'kickslap', 2: 'facepaint', 3: 'polls', 4: 'racealong', 5: 'speedmaths' };
const GAME_MIN_PLAYERS = { kickslap: 2, facepaint: 2, polls: 5, racealong: 2, speedmaths: 2 };

const players      = {};        // { [socketId]: PlayerData }
const playerBooth  = {};        // { [socketId]: boothId | null }
const boothPlayers = {};        // { [boothId]: Set<socketId> }
for (let i = 1; i <= BOOTH_COUNT; i++) boothPlayers[i] = new Set();

const activeGames  = {};        // { [boothId]: GameState }
const moveTimes    = {};        // { [socketId]: lastBroadcastMs } – Throttle für move-Events
const scoreTimes   = {};        // { [socketId]: lastSubmitMs }   – Rate-Limit fc:submitScore
const questionTimes= {};        // { [socketId]: lastQuestionMs } – Rate-Limit po:submitQuestion
const activityTimes= {};        // { [socketId]: lastActivityMs } – AFK-Erkennung
const afkWarnedSet = new Set(); // Sockets, denen bereits eine Warnung gesendet wurde

// ─── Haustiere ────────────────────────────────────────────────
// petOwners: { petId: socketId | null }
const petOwners = {
  wallace: null, bally: null, baby: null, simba: null, karl: null,
  wikinger: null, elli: null, bello: null, mathebuch: null, minime: null
};

// ─────────────────────────────────────────────────────────────
// Sicheres Emit an mehrere Socket-IDs (io.to(array) ist in manchen
// Socket.io-Versionen unzuverlässig — forEach ist immer korrekt)
function _emit(ids, event, data) {
  ids.forEach(id => { const s = io.sockets.sockets.get(id); if (s) s.emit(event, data); });
}

// ─────────────────────────────────────────────────────────────
function getBoothCounts() {
  const c = {};
  for (let i = 1; i <= BOOTH_COUNT; i++) {
    c[i] = boothPlayers[i].size;
    // Spieler in laufendem Spiel mitzählen (damit der Stand nicht leer wirkt)
    const ag = activeGames[i];
    if (ag && ag.active) {
      if (ag.type === 'kickslap') {
        c[i] += Object.values(ag.players).filter(p => !p.eliminated).length;
      } else if (Array.isArray(ag.players)) {
        c[i] += ag.players.length;
      }
    }
  }
  return c;
}
function removeFromBooth(sid) {
  const prev = playerBooth[sid];
  if (prev && boothPlayers[prev]) { boothPlayers[prev].delete(sid); return true; }
  return false;
}

// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit('serverFull'); socket.disconnect(true); return;
  }
  playerBooth[socket.id] = null;
  activityTimes[socket.id] = Date.now();
  console.log(`[+] ${socket.id}`);

  // Jedes eingehende Event aktualisiert den Aktivitäts-Timestamp (AFK-Reset)
  socket.use((_, next) => {
    activityTimes[socket.id] = Date.now();
    if (afkWarnedSet.has(socket.id)) afkWarnedSet.delete(socket.id);
    next();
  });

  // Explizites Anwesenheits-Ping (von der AFK-Warnung im Client)
  socket.on('afk:ping', () => { /* wird bereits durch socket.use behandelt */ });

  // ── join ────────────────────────────────────────────────
  socket.on('join', ({ name, faceData, skinColor, shirtColor, hairStyle, hairColor }) => {
    // faceData: max. 200 KB, muss ein Data-URL-Bild sein
    const MAX_FACE = 200_000;
    let safeFace = null;
    if (faceData && typeof faceData === 'string') {
      if (faceData.length > MAX_FACE) { socket.emit('serverError', 'faceData zu groß'); return; }
      if (!faceData.startsWith('data:image/') || !faceData.includes(';base64,')) {
        socket.emit('serverError', 'Ungültiges Bildformat'); return;
      }
      safeFace = faceData;
    }
    players[socket.id] = {
      id: socket.id,
      name: (name || 'Spieler').substring(0, 15),
      x: (Math.random() - 0.5) * 20, y: 0, z: (Math.random() - 0.5) * 20,
      rotY: 0, faceData: safeFace, skinColor: skinColor || null,
      shirtColor: shirtColor || null, petId: null,
      hairStyle: hairStyle || null, hairColor: hairColor || null
    };
    socket.emit('init', { selfId: socket.id, players, boothCounts: getBoothCounts(), petOwners });
    socket.broadcast.emit('playerJoined', players[socket.id]);
    console.log(`  "${players[socket.id].name}" beigetreten – ${Object.keys(players).length} Spieler`);
  });

  // ── move ────────────────────────────────────────────────
  socket.on('move', ({ x, y, z, rotY }) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = x; p.y = y; p.z = z; p.rotY = rotY;
    // Throttle: maximal 10× pro Sekunde (100 ms) an andere Clients broadcasten
    const now = Date.now();
    if ((moveTimes[socket.id] || 0) + 100 > now) return;
    moveTimes[socket.id] = now;
    socket.broadcast.emit('playerMoved', { id: socket.id, x, y, z, rotY });
  });

  // ── nearBooth ───────────────────────────────────────────
  socket.on('nearBooth', (boothId) => {
    if (!players[socket.id]) return;   // nur gejointe Spieler akzeptieren
    removeFromBooth(socket.id);
    const id = parseInt(boothId);
    if (id >= 1 && id <= BOOTH_COUNT) { boothPlayers[id].add(socket.id); playerBooth[socket.id] = id; }
    else playerBooth[socket.id] = null;
    io.emit('boothCounts', getBoothCounts());
  });

  // ── leftBooth ───────────────────────────────────────────
  socket.on('leftBooth', () => {
    removeFromBooth(socket.id); playerBooth[socket.id] = null;
    io.emit('boothCounts', getBoothCounts());
  });

  // ── startMinigame ────────────────────────────────────────
  socket.on('startMinigame', (boothId) => {
    const id  = parseInt(boothId);
    const gt  = BOOTH_GAME_MAP[id];
    const set = boothPlayers[id];

    if (!gt) {
      socket.emit('minigameError', { msg: 'An diesem Stand ist noch kein Spiel verfügbar.' });
      return;
    }
    if (activeGames[id]) {
      socket.emit('minigameError', { msg: 'An diesem Stand läuft bereits ein Spiel.' });
      return;
    }
    if (!set || set.size === 0) {
      socket.emit('minigameError', { msg: 'Niemand ist an diesem Stand.' });
      return;
    }

    const pIds = [...set];
    const ok = gt === 'kickslap'   ? _startKickSlap(id, pIds)
             : gt === 'facepaint'  ? _startFacepaint(id, pIds)
             : gt === 'polls'      ? _startPolls(id, pIds)
             : gt === 'racealong'  ? _startRacealong(id, pIds)
             : gt === 'speedmaths' ? _startSpeedmaths(id, pIds)
             : false;

    if (ok === false) {
      // Spielspezifische Mindestanzahl nicht erreicht
      const mins = { kickslap: 2, facepaint: 2, polls: 5, racealong: 2, speedmaths: 2 };
      const min  = mins[gt] || 2;
      socket.emit('minigameError', { msg: `Mindestens ${min} Spieler benötigt (aktuell: ${pIds.length}).` });
    } else {
      // Spiel erfolgreich gestartet → Booth-Zugehörigkeit aller Teilnehmer
      // sofort löschen. Die Proximity-Erkennung registriert sie nach dem
      // Spiel automatisch neu, falls sie noch am Stand stehen.
      pIds.forEach(pid => {
        boothPlayers[id].delete(pid);
        if (playerBooth[pid] === id) playerBooth[pid] = null;
      });
      io.emit('boothCounts', getBoothCounts());
    }
    console.log(`[Minigame] Stand ${id} (${gt}) – ${pIds.length} Spieler – gestartet: ${ok !== false}`);
  });

  // ════════════════════════════════════════════════════════
  // HAUSTIERE – Events
  // ════════════════════════════════════════════════════════
  socket.on('adoptPet', (petId) => {
    if (!petOwners.hasOwnProperty(petId)) return;
    if (petOwners[petId] !== null) {
      socket.emit('petError', 'Dieses Haustier hat bereits jemand anderen gewählt.');
      return;
    }
    const p = players[socket.id];
    if (!p) return;
    // Altes Haustier freigeben
    if (p.petId && petOwners[p.petId] === socket.id) petOwners[p.petId] = null;
    // Neues Haustier vergeben
    petOwners[petId] = socket.id;
    p.petId = petId;
    io.emit('petAdopted', { socketId: socket.id, petId, petOwners });
    console.log(`[Pet] "${p.name}" adoptiert ${petId}`);
  });

  socket.on('returnPet', () => {
    const p = players[socket.id];
    if (!p || !p.petId) return;
    const petId = p.petId;
    if (petOwners[petId] === socket.id) petOwners[petId] = null;
    p.petId = null;
    io.emit('petReturned', { socketId: socket.id, petId, petOwners });
    console.log(`[Pet] "${p.name}" gibt ${petId} zurück`);
  });

  // ════════════════════════════════════════════════════════
  // KICK & SLAP – Events
  // ════════════════════════════════════════════════════════
  socket.on('ks:move', ({ x, y }) => {
    const game = _ksGameOf(socket.id);
    if (!game || !game.active) return;
    const p = game.players[socket.id];
    if (!p || p.eliminated) return;
    if (Math.hypot(x - 5, y - 5) > 4.6) return;   // reject cheating positions

    // Avatar-Kollision: anderen Spielern nicht durch den Körper laufen
    const KS_R = 0.40;
    let cx = x, cy = y;
    for (const other of Object.values(game.players)) {
      if (other.id === socket.id || other.eliminated) continue;
      const dx = cx - other.x, dy = cy - other.y;
      const dist = Math.hypot(dx, dy);
      if (dist < KS_R * 2 && dist > 0.001) {
        const push = KS_R * 2 - dist;
        cx += (dx / dist) * push;
        cy += (dy / dist) * push;
      }
    }
    // Ringgrenze nach Kollisionskorrektur sicherstellen
    if (Math.hypot(cx - 5, cy - 5) > 4.4) {
      const a = Math.atan2(cy - 5, cx - 5);
      cx = 5 + Math.cos(a) * 4.4;
      cy = 5 + Math.sin(a) * 4.4;
    }

    p.x = cx; p.y = cy;
    // Falls Position korrigiert wurde: Sender ebenfalls informieren
    if (Math.abs(cx - x) > 0.01 || Math.abs(cy - y) > 0.01) {
      socket.emit('ks:moved', { id: socket.id, x: cx, y: cy });
    }
    socket.to(_ksAllIds(game)).emit('ks:moved', { id: socket.id, x: cx, y: cy });
  });

  socket.on('ks:attack', ({ type }) => {
    const now  = Date.now();
    const game = _ksGameOf(socket.id);
    if (!game || !game.active) return;
    const att = game.players[socket.id];
    if (!att || att.eliminated) return;
    if (now < att.lastAttack + 250 || now < att.stunUntil) return;
    att.lastAttack = now;

    const range = type === 'kick' ? 2.2 : 1.8;
    let target = null, minD = Infinity;
    for (const p of Object.values(game.players)) {
      if (p.id === socket.id || p.eliminated) continue;
      const d = Math.hypot(p.x - att.x, p.y - att.y);
      if (d < range && d < minD) { target = p; minD = d; }
    }

    const allIds = _ksAllIds(game);
    if (!target) { _emit(allIds, 'ks:miss', { id: socket.id, type }); return; }

    const dx = (target.x - att.x) || 0.01;
    const dy = (target.y - att.y) || 0.01;
    const len = Math.hypot(dx, dy);
    // Rückwurf = ¼ des Ringdurchmessers (Radius 4.2 → Ø 8.4 → ¼ = 2.1)
    target.x += (dx / len) * 2.1;
    target.y += (dy / len) * 2.1;
    target.stunUntil = now + 250;

    const eliminated = Math.hypot(target.x - 5, target.y - 5) > 4.4;
    if (eliminated) { target.eliminated = true; }

    _emit(allIds, 'ks:hit', {
      attackerId: att.id, targetId: target.id, type,
      targetX: target.x, targetY: target.y, eliminated
    });
    if (eliminated) _ksCheckWinner(game);
  });

  // ════════════════════════════════════════════════════════
  // FACEPAINT – Events
  // ════════════════════════════════════════════════════════
  socket.on('fp:stroke', (strokeData) => {
    const game = _fpGameOf(socket.id);
    if (!game || !game.active || socket.id !== game.painter) return;
    // Schema validieren: nur bekannte Felder mit korrekten Typen weiterleiten
    if (!strokeData || typeof strokeData !== 'object') return;
    const { x1, y1, x2, y2, color, r } = strokeData;
    const inCanvas = v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 512;
    if (!inCanvas(x1) || !inCanvas(y1) || !inCanvas(x2) || !inCanvas(y2)) return;
    if (typeof r !== 'number' || !isFinite(r) || r < 0.5 || r > 60) return;
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    const safe = { x1, y1, x2, y2, color, r };
    _fpAllIds(game).forEach(id => {
      if (id !== socket.id) { const s = io.sockets.sockets.get(id); if (s) s.emit('fp:stroke', safe); }
    });
  });

  socket.on('fp:finish', () => {
    const game = _fpGameOf(socket.id);
    if (!game || !game.active || socket.id !== game.painter) return;
    _fpEndRound(game);
  });

  socket.on('fp:faceComplete', ({ faceData }) => {
    const game = _fpGameOf(socket.id);
    if (!game || socket.id !== game.painter) return;
    const subjectId = game.subject;
    if (players[subjectId]) players[subjectId].faceData = faceData;
    _emit(_fpAllIds(game), 'fp:faceUpdate', { playerId: subjectId, faceData });
    // Alle Spieler (inkl. Maler) erhalten das neue Gesicht
    io.emit('playerFaceUpdate', { id: subjectId, faceData });
  });

  // ════════════════════════════════════════════════════════
  // POLLS – Events
  // ════════════════════════════════════════════════════════
  socket.on('po:submitQuestion', ({ text }) => {
    const game = _poGameOf(socket.id);
    if (!game || game.phase !== 'collecting') return;
    // Rate-Limiting: max. 1 Frage pro 5 Sekunden
    const nowTs = Date.now();
    if (questionTimes[socket.id] && nowTs - questionTimes[socket.id] < 5_000) return;
    questionTimes[socket.id] = nowTs;
    const t = (text || '').trim().substring(0, 120);
    if (!t) return;
    const idx = game.questions.findIndex(q => q.authorId === socket.id);
    if (idx >= 0) game.questions[idx].text = t;
    else game.questions.push({ authorId: socket.id, text: t });
    game.submitted.add(socket.id);
    socket.emit('po:questionAck');
    // Fortschritt an alle (wie viele haben schon abgeschickt)
    _emit(game.players, 'po:collectProgress', {
      submitted: game.submitted.size, total: game.players.length
    });
    // Alle fertig → sofort mit Abstimmung starten
    if (game.submitted.size >= game.players.length) {
      if (game._timer) { clearTimeout(game._timer); game._timer = null; }
      _poStartVoting(game);
    }
  });

  socket.on('po:vote', ({ targetId }) => {
    const game = _poGameOf(socket.id);
    if (!game || game.phase !== 'voting') return;
    if (!game.players.includes(targetId)) return;
    game.votes[game.currentQ] = game.votes[game.currentQ] || {};
    game.votes[game.currentQ][socket.id] = targetId;
    // Nur dem Voter sagen, wen er gewählt hat (andere sehen es nicht)
    socket.emit('po:voteAck', { targetId });
    // Allen nur die Anzahl mitteilen — kein Name
    const votedCount = Object.keys(game.votes[game.currentQ]).length;
    _emit(game.players, 'po:voteProgress', { voted: votedCount, total: game.players.length });
    // Alle haben abgestimmt → sofort Ergebnis zeigen
    if (votedCount >= game.players.length) {
      if (game._timer) { clearTimeout(game._timer); game._timer = null; }
      _poProcessRound(game);
    }
  });

  // ════════════════════════════════════════════════════════
  // RACEALONG – Events
  // ════════════════════════════════════════════════════════
  socket.on('ra:moved', ({ x, y, dir }) => {
    const game = _raGameOf(socket.id);
    if (!game || !game.active) return;
    // Koordinaten validieren: Spielfeld 0-600 / 0-500, dir = endliche Zahl (Radiant)
    if (typeof x !== 'number' || !isFinite(x) || x < -50 || x > 650) return;
    if (typeof y !== 'number' || !isFinite(y) || y < -50 || y > 550) return;
    if (typeof dir !== 'number' || !isFinite(dir)) return;
    _raAllIds(game).forEach(id => {
      if (id !== socket.id) {
        const s = io.sockets.sockets.get(id);
        if (s) s.emit('ra:moved', { id: socket.id, x, y, dir });
      }
    });
  });

  socket.on('ra:finish', () => {
    const game = _raGameOf(socket.id);
    if (!game || !game.active) return;
    if (game.finished.has(socket.id)) return;
    game.finished.add(socket.id);
    const rank = game.finished.size;
    const rankings = [...game.finished].map((id, i) => ({
      id, rank: i + 1, name: players[id]?.name || '?'
    }));
    _emit(_raAllIds(game), 'ra:ranked', { id: socket.id, rank, rankings });
    // Alle im Ziel → Spiel beenden
    if (game.finished.size >= game.players.length) {
      _raEnd(game, rankings);
    }
  });

  // ════════════════════════════════════════════════════════
  // SPEEDMATHS – Events
  // ════════════════════════════════════════════════════════
  socket.on('sm:answer', ({ value }) => {
    const game = _smGameOf(socket.id);
    if (!game || game.phase !== 'question') return;
    if (game.answered.has(socket.id)) return;   // bereits korrekt geantwortet
    if (value !== game.currentAnswer) {
      socket.emit('sm:wrong');
      return;
    }
    // Richtige Antwort
    game.answered.add(socket.id);
    const timeTaken = (Date.now() - game.questionStart) / 1000;
    const points    = Math.max(1, Math.ceil(game.timeMs / 1000 - timeTaken));
    game.scores[socket.id] = (game.scores[socket.id] || 0) + points;
    socket.emit('sm:correct', { playerId: socket.id, points });
    _emit(game.players.filter(id => id !== socket.id), 'sm:correct',
      { playerId: socket.id, points });
    // Alle richtig → Runde sofort beenden
    if (game.answered.size >= game.players.length) {
      if (game._timer) { clearTimeout(game._timer); game._timer = null; }
      _smEndRound(game);
    }
  });

  // ════════════════════════════════════════════════════════
  // MINIGAME VERLASSEN – universeller Handler
  // ════════════════════════════════════════════════════════
  socket.on('leaveMinigame', () => {
    const sid = socket.id;
    for (const [bid, game] of Object.entries(activeGames)) {
      if (!game.active) continue;
      const boothId = parseInt(bid);
      const gt      = game.type;

      if (gt === 'kickslap' && game.players[sid]) {
        // Als eliminiert markieren und Gewinner prüfen
        game.players[sid].eliminated = true;
        _ksCheckWinner(game);
        break;
      }

      if (gt === 'facepaint' && _fpAllIds(game).includes(sid)) {
        // Facepaint kann ohne beide Hauptspieler nicht weiterlaufen
        _abortGame(boothId, 'Ein Spieler hat das Spiel verlassen.');
        break;
      }

      if ((gt === 'polls' || gt === 'racealong' || gt === 'speedmaths')
          && game.players.includes(sid)) {
        game.players = game.players.filter(id => id !== sid);
        const min = GAME_MIN_PLAYERS[gt] || 2;
        if (game.players.length < min) {
          _abortGame(boothId, 'Zu wenige Spieler — Spiel abgebrochen.');
        }
        break;
      }
    }
  });

  // ════════════════════════════════════════════════════════
  // FLAPPY CHOPPER – Highscore-Events (Stand 7)
  // ════════════════════════════════════════════════════════
  socket.on('fc:getHighscore', async () => {
    socket.emit('fc:highscore', await _readHighscores());
  });

  socket.on('fc:submitScore', async ({ name, score }) => {
    if (typeof score !== 'number' || score < 0 || score > 99999) return;
    // Rate-Limiting: max. 1 Einreichung pro 10 Sekunden
    const nowTs = Date.now();
    if (scoreTimes[socket.id] && nowTs - scoreTimes[socket.id] < 10_000) return;
    scoreTimes[socket.id] = nowTs;
    const p     = players[socket.id];
    const safeN = (name || p?.name || 'Spieler').substring(0, 15);
    const safeS = Math.floor(score);
    const entry = { name: safeN, score: safeS, date: new Date().toISOString().slice(0, 10) };
    const list  = await _addScore(entry);
    // Broadcast an alle → wer gerade am Flappy-Stand steht sieht die Liste sofort
    io.emit('fc:highscore', list);
    console.log(`[Highscore] ${safeN}: ${safeS} Punkte`);
  });

  // ── disconnect ───────────────────────────────────────────
  socket.on('disconnect', () => {
    // Booth-Zugehörigkeit IMMER aufräumen – auch wenn der Socket nie gejoint hat
    // (verhindert, dass Ghost-Sockets dauerhaft in boothPlayers stecken bleiben)
    removeFromBooth(socket.id);
    delete playerBooth[socket.id];
    delete moveTimes[socket.id];
    delete scoreTimes[socket.id];
    delete questionTimes[socket.id];
    delete activityTimes[socket.id];
    afkWarnedSet.delete(socket.id);

    const p = players[socket.id];
    if (p) {
      // Haustier freigeben
      if (p.petId && petOwners[p.petId] === socket.id) {
        petOwners[p.petId] = null;
        io.emit('petReturned', { socketId: socket.id, petId: p.petId, petOwners });
      }
      console.log(`[-] "${p.name}" weg`);
      delete players[socket.id];
      io.emit('playerLeft', socket.id);
      _cleanupOnDisconnect(socket.id);
    }
    // Booth-Zähler immer broadcasten – könnte ein Ghost-Eintrag entfernt worden sein
    io.emit('boothCounts', getBoothCounts());
  });
});

// ─────────────────────────────────────────────────────────────
// AFK-Prüfung (alle 20 Sekunden)
// ─────────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, lastActive] of Object.entries(activityTimes)) {
    const idle = now - lastActive;
    const s    = io.sockets.sockets.get(id);
    if (!s) { delete activityTimes[id]; afkWarnedSet.delete(id); continue; }
    if (idle >= AFK_KICK_MS) {
      console.log(`[AFK] "${players[id]?.name || id}" abgemeldet (${Math.round(idle / 1000)}s inaktiv)`);
      s.emit('afk:kick');
      s.disconnect(true);
    } else if (idle >= AFK_WARN_MS && !afkWarnedSet.has(id)) {
      afkWarnedSet.add(id);
      s.emit('afk:warn', Math.ceil((AFK_KICK_MS - idle) / 1000));
    }
  }
}, 20_000);

// ═══════════════════════════════════════════════════════════════
// KICK & SLAP – Logik
// ═══════════════════════════════════════════════════════════════
function _startKickSlap(boothId, playerIds) {
  const active     = playerIds.slice(0, 10);
  const spectators = playerIds.slice(10);
  if (active.length < 2) return false;

  const game = { type: 'kickslap', boothId, active: true, players: {}, spectators };
  active.forEach((id, i) => {
    const a = (i / active.length) * Math.PI * 2;
    game.players[id] = { id, x: 5 + Math.cos(a) * 2.5, y: 5 + Math.sin(a) * 2.5,
      eliminated: false, lastAttack: 0, stunUntil: 0 };
  });
  activeGames[boothId] = game;

  const pData = playerIds.map(id => ({
    id, name: players[id]?.name || '?',
    faceData:   players[id]?.faceData    || null,
    skinColor:  players[id]?.skinColor   || '#ffce9e',
    shirtColor: players[id]?.shirtColor  || '#5b9bd5',
    x: game.players[id]?.x, y: game.players[id]?.y,
    isSpectator: spectators.includes(id)
  }));

  _emit(playerIds, 'minigameStarted', {
    boothId, gameType: 'kickslap', players: pData,
    ringCenter: { x: 5, y: 5 }, ringRadius: 4.2
  });

  let cd = 3;
  _emit(playerIds, 'ks:countdown', cd);
  const tick = setInterval(() => {
    cd--;
    if (cd > 0) _emit(playerIds, 'ks:countdown', cd);
    else { clearInterval(tick); _emit(playerIds, 'ks:go', null); }
  }, 1000);
  return true;
}

function _ksAllIds(game) { return [...Object.keys(game.players), ...game.spectators]; }
function _ksGameOf(sid) {
  for (const g of Object.values(activeGames))
    if (g.type === 'kickslap' && g.players[sid]) return g;
  return null;
}
function _ksCheckWinner(game) {
  const alive = Object.values(game.players).filter(p => !p.eliminated);
  if (alive.length > 1) return;
  game.active = false;
  const winner = alive[0] || null;
  // Kurze Verzögerung: Ausscheidungs-Animation soll sichtbar sein, bevor der Sieg-Screen erscheint
  setTimeout(() => {
    _emit(_ksAllIds(game), 'ks:end', {
      winnerId: winner?.id || null,
      rankings: Object.values(game.players)
        .sort((a, b) => (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0))
        .map(p => ({ id: p.id, name: players[p.id]?.name || '?' }))
    });
    setTimeout(() => { delete activeGames[game.boothId]; }, 10000);
  }, 800);
}

// ═══════════════════════════════════════════════════════════════
// FACEPAINT – Logik
// ═══════════════════════════════════════════════════════════════
function _startFacepaint(boothId, playerIds) {
  if (playerIds.length < 2) return false;
  const [p1, p2]   = playerIds;
  const spectators = playerIds.slice(2);

  const game = { type: 'facepaint', boothId, active: true,
    p1, p2, painter: p1, subject: p2, round: 1, spectators, _timer: null };
  activeGames[boothId] = game;

  _emit(playerIds, 'minigameStarted', {
    boothId, gameType: 'facepaint', p1, p2,
    p1Name: players[p1]?.name || '?', p2Name: players[p2]?.name || '?',
    p1Face: players[p1]?.faceData || null, p2Face: players[p2]?.faceData || null,
    spectators
  });
  _fpStartRound(game);
  return true;
}

function _fpAllIds(game) { return [game.p1, game.p2, ...game.spectators].filter(Boolean); }
function _fpGameOf(sid) {
  for (const g of Object.values(activeGames))
    if (g.type === 'facepaint' && _fpAllIds(g).includes(sid)) return g;
  return null;
}
function _fpStartRound(game) {
  const allIds = _fpAllIds(game);
  _emit(allIds, 'fp:roundStart', {
    round: game.round, painter: game.painter, subject: game.subject,
    painterName:      players[game.painter]?.name      || '?',
    subjectName:      players[game.subject]?.name      || '?',
    subjectFace:      players[game.subject]?.faceData  || null,
    subjectSkinColor: players[game.subject]?.skinColor || '#ffce9e',
    timeMs: 30000
  });
  if (game._timer) clearTimeout(game._timer);
  game._timer = setTimeout(() => {
    if (!activeGames[game.boothId]) return;
    _fpEndRound(game);
  }, 30000);
}

// Runde beenden – vom Timer ODER vom Maler per fp:finish aufrufbar
function _fpEndRound(game) {
  if (game._timer) { clearTimeout(game._timer); game._timer = null; }
  const allIds = _fpAllIds(game);
  _emit(allIds, 'fp:roundEnd', { round: game.round });
  if (game.round === 1) {
    // Tausch erst nach 3 Sekunden – so hat der Maler Zeit, fp:faceComplete zu schicken,
    // bevor game.painter auf den neuen Maler umgestellt wird.
    setTimeout(() => {
      if (!activeGames[game.boothId]) return;
      game.round   = 2;
      [game.painter, game.subject] = [game.subject, game.painter];
      _fpStartRound(game);
    }, 3000);
  } else {
    game.active = false;
    _emit(allIds, 'fp:done', null);
    setTimeout(() => { delete activeGames[game.boothId]; }, 10000);
  }
}

// ═══════════════════════════════════════════════════════════════
// POLLS – Logik
// ═══════════════════════════════════════════════════════════════
function _startPolls(boothId, playerIds) {
  if (playerIds.length < 5) return false;
  const game = {
    type: 'polls', boothId, active: true, players: playerIds,
    phase: 'collecting', questions: [], currentQ: -1,
    votes: {}, totalVotes: {}, submitted: new Set(), _timer: null
  };
  playerIds.forEach(id => { game.totalVotes[id] = 0; });
  activeGames[boothId] = game;

  _emit(playerIds, 'minigameStarted', {
    boothId, gameType: 'polls',
    players: playerIds.map(id => ({
      id, name: players[id]?.name || '?', faceData: players[id]?.faceData || null
    }))
  });
  _emit(playerIds, 'po:collect', { timeMs: 30000 });

  game._timer = setTimeout(() => {
    if (!activeGames[boothId]) return;
    _poStartVoting(game);
  }, 30000);
  return true;
}

function _poGameOf(sid) {
  for (const g of Object.values(activeGames))
    if (g.type === 'polls' && g.players.includes(sid)) return g;
  return null;
}
function _poStartVoting(game) {
  game.questions = game.questions.sort(() => Math.random() - 0.5);
  game.currentQ  = 0;
  game.phase     = 'voting';
  if (game.questions.length === 0) {
    _emit(game.players, 'po:final', _poBuildFinal(game));
    delete activeGames[game.boothId]; return;
  }
  _poAskNext(game);
}
function _poAskNext(game) {
  if (game.currentQ >= game.questions.length) {
    game.phase = 'done';
    _emit(game.players, 'po:final', _poBuildFinal(game));
    setTimeout(() => { delete activeGames[game.boothId]; }, 15000); return;
  }
  const q = game.questions[game.currentQ];
  game.votes[game.currentQ] = {};
  _emit(game.players, 'po:question', {
    idx: game.currentQ, total: game.questions.length,
    text: q.text, author: q.authorId, timeMs: 15000
  });
  if (game._timer) clearTimeout(game._timer);
  game._timer = setTimeout(() => {
    if (!activeGames[game.boothId]) return;
    _poProcessRound(game);
  }, 15000);
}

// Ergebnis der aktuellen Frage verarbeiten und broadcasten
// (wird vom Timer ODER wenn alle abgestimmt haben aufgerufen)
function _poProcessRound(game) {
  if (!activeGames[game.boothId]) return;
  const q = game.questions[game.currentQ];
  const tally = {};
  game.players.forEach(id => { tally[id] = 0; });
  Object.values(game.votes[game.currentQ] || {}).forEach(tid => { tally[tid] = (tally[tid] || 0) + 1; });
  Object.entries(tally).forEach(([id, n]) => { game.totalVotes[id] += n; });
  const results = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([id, votes]) => ({ id, votes, name: players[id]?.name || '?' }));
  // voteMap bewusst nicht gesendet – Abstimmungsgeheimnis wahren
  _emit(game.players, 'po:roundResult', {
    idx: game.currentQ, total: game.questions.length,
    text: q.text, results
  });
  game.currentQ++;
  game._timer = setTimeout(() => { if (activeGames[game.boothId]) _poAskNext(game); }, 6000);
}
function _poBuildFinal(game) {
  return {
    rankings: Object.entries(game.totalVotes)
      .sort((a, b) => b[1] - a[1])
      .map(([id, votes]) => ({ id, votes, name: players[id]?.name || '?' }))
  };
}

// ── Alle Spieler-IDs eines laufenden Spiels (typ-unabhängig) ──
function _gameAllIds(game) {
  if (game.type === 'kickslap')   return _ksAllIds(game);
  if (game.type === 'facepaint')  return _fpAllIds(game);
  if (game.type === 'polls')      return [...game.players];
  if (game.type === 'racealong')  return [...game.players];
  if (game.type === 'speedmaths') return [...game.players];
  return [];
}

// ── Spiel sofort abbrechen & alle informieren ─────────────────
function _abortGame(boothId, reason) {
  const game = activeGames[boothId];
  if (!game) return;
  if (game._timer) { clearTimeout(game._timer); game._timer = null; }
  game.active = false;
  _emit(_gameAllIds(game), 'minigameAborted', { reason: reason || 'Das Spiel wurde abgebrochen.' });
  setTimeout(() => { delete activeGames[boothId]; }, 5000);
}

// ── Cleanup bei Disconnect ────────────────────────────────────
function _cleanupOnDisconnect(sid) {
  for (const [bid, game] of Object.entries(activeGames)) {
    if (!game.active) continue;
    const boothId = parseInt(bid);
    const gt      = game.type;

    if (gt === 'kickslap' && game.players[sid]) {
      game.players[sid].eliminated = true;
      _ksCheckWinner(game);

    } else if (gt === 'facepaint' && _fpAllIds(game).includes(sid)) {
      _abortGame(boothId, 'Ein Spieler hat die Welt verlassen.');

    } else if ((gt === 'polls' || gt === 'racealong' || gt === 'speedmaths')
               && game.players.includes(sid)) {
      game.players = game.players.filter(id => id !== sid);
      const min = GAME_MIN_PLAYERS[gt] || 2;
      if (game.players.length < min) {
        _abortGame(boothId, 'Ein Spieler hat die Welt verlassen — Spiel abgebrochen.');
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// RACEALONG – Logik
// ═══════════════════════════════════════════════════════════════
// Startpositionen: aufgefächert entlang der Startgeraden (y=80, x 220..380)
function _raStartPos(i, total) {
  const spread = Math.min(total - 1, 4) * 30;
  const startX  = 300 - spread / 2 + i * (total > 1 ? spread / (total - 1) : 0);
  return { x: startX, y: 80 };
}

function _startRacealong(boothId, playerIds) {
  if (playerIds.length < 2) return false;
  const game = {
    type: 'racealong', boothId, active: true,
    players: playerIds, finished: new Set(), _timer: null
  };
  activeGames[boothId] = game;

  const pData = playerIds.map((id, i) => {
    const pos = _raStartPos(i, playerIds.length);
    return {
      id, name: players[id]?.name || '?',
      faceData: players[id]?.faceData || null,
      skinColor: players[id]?.skinColor || '#ffce9e',
      startX: pos.x, startY: pos.y
    };
  });

  _emit(playerIds, 'minigameStarted', { boothId, gameType: 'racealong', players: pData });

  let cd = 3;
  _emit(playerIds, 'ra:countdown', cd);
  const tick = setInterval(() => {
    cd--;
    if (cd > 0) _emit(playerIds, 'ra:countdown', cd);
    else {
      clearInterval(tick);
      _emit(playerIds, 'ra:go', null);
      // Timeout: nach 120 s Spiel zwangsweise beenden
      game._timer = setTimeout(() => {
        if (activeGames[boothId]) {
          const rankings = playerIds
            .filter(id => !game.finished.has(id))
            .map(id => ({ id, name: players[id]?.name || '?' }));
          const finished = [...game.finished].map((id, i) => ({ id, rank: i + 1, name: players[id]?.name || '?' }));
          _raEnd(game, [...finished, ...rankings]);
        }
      }, 120000);
    }
  }, 1000);
  return true;
}

function _raAllIds(game) { return game.players; }
function _raGameOf(sid) {
  for (const g of Object.values(activeGames))
    if (g.type === 'racealong' && g.players.includes(sid)) return g;
  return null;
}
function _raEnd(game, rankings) {
  if (!activeGames[game.boothId]) return;
  game.active = false;
  if (game._timer) { clearTimeout(game._timer); game._timer = null; }
  _emit(game.players, 'ra:result', { rankings });
  setTimeout(() => {
    _emit(game.players, 'ra:done', null);
    setTimeout(() => { delete activeGames[game.boothId]; }, 5000);
  }, 5000);
}

// ═══════════════════════════════════════════════════════════════
// SPEEDMATHS – Logik
// ═══════════════════════════════════════════════════════════════
function _smGenQuestion() {
  const a  = Math.floor(Math.random() * 201) - 100;  // -100…100
  const b  = Math.floor(Math.random() * 201) - 100;
  const op = Math.random() < 0.5 ? '+' : '-';
  return { expr: `${a} ${op} ${b}`, answer: op === '+' ? a + b : a - b };
}

function _startSpeedmaths(boothId, playerIds) {
  if (playerIds.length < 2) return false;
  const game = {
    type: 'speedmaths', boothId, active: true,
    players: playerIds, round: 0, totalRounds: 5,
    scores: {}, answered: new Set(),
    currentAnswer: 0, questionStart: 0,
    phase: 'idle', timeMs: 15000, _timer: null
  };
  playerIds.forEach(id => { game.scores[id] = 0; });
  activeGames[boothId] = game;

  _emit(playerIds, 'minigameStarted', {
    boothId, gameType: 'speedmaths',
    players: playerIds.map(id => ({
      id, name: players[id]?.name || '?', faceData: players[id]?.faceData || null
    }))
  });

  // Erste Runde nach kurzem Delay starten
  setTimeout(() => { if (activeGames[boothId]) _smNextRound(game); }, 2000);
  return true;
}

function _smGameOf(sid) {
  for (const g of Object.values(activeGames))
    if (g.type === 'speedmaths' && g.players.includes(sid)) return g;
  return null;
}

function _smNextRound(game) {
  if (!activeGames[game.boothId]) return;
  game.round++;
  if (game.round > game.totalRounds) { _smFinal(game); return; }

  const q = _smGenQuestion();
  game.currentAnswer = q.answer;
  game.answered      = new Set();
  game.phase         = 'question';
  game.questionStart = Date.now();

  _emit(game.players, 'sm:question', {
    idx: game.round - 1, total: game.totalRounds,
    expr: q.expr, timeMs: game.timeMs
  });

  if (game._timer) clearTimeout(game._timer);
  game._timer = setTimeout(() => {
    if (activeGames[game.boothId]) _smEndRound(game);
  }, game.timeMs);
}

function _smEndRound(game) {
  if (!activeGames[game.boothId]) return;
  game.phase = 'result';
  _emit(game.players, 'sm:roundResult', {
    answer: game.currentAnswer,
    scores: game.scores
  });
  game._timer = setTimeout(() => {
    if (activeGames[game.boothId]) _smNextRound(game);
  }, 4000);
}

function _smFinal(game) {
  game.active = false;
  const rankings = Object.entries(game.scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score, name: players[id]?.name || '?' }));
  _emit(game.players, 'sm:final', { rankings });
  setTimeout(() => {
    _emit(game.players, 'sm:done', null);
    setTimeout(() => { delete activeGames[game.boothId]; }, 5000);
  }, 6000);
}

// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n  Spielefest auf http://localhost:${PORT}\n`));
