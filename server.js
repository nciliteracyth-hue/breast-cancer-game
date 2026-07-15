/**
 * Mission Pink: ภารกิจสืบหาความเสี่ยงมะเร็งเต้านม
 * Real-time multiplayer awareness board game.
 * Backend: Express + Socket.IO, fully in-memory (no database).
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 50;
const MAX_WINNERS = 5;
const PENALTY_MS = 3000;
const TOTAL_LEVELS = 5;
const ROOM_ID = "mission-pink-room";

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Game content — 5 mascots, one per level, increasing in difficulty.
// correctIndex / explanation are kept server-side only.
// ---------------------------------------------------------------------------
const LEVELS = [
  {
    id: 1,
    mascot: "Nutri-Nia",
    color: "green",
    hex: "#4ade80",
    difficulty: "ง่าย",
    topic: "ปัจจัยวิถีชีวิต",
    question: "ข้อใดคือปัจจัยด้านวิถีชีวิตที่เพิ่มความเสี่ยงมะเร็งเต้านมได้มากที่สุด?",
    options: [
      "การดื่มน้ำเปล่าให้เพียงพอทุกวัน",
      "โรคอ้วนและการดื่มแอลกอฮอล์เป็นประจำ",
      "การนอนหลับให้ครบ 8 ชั่วโมง",
      "การกินผักผลไม้เป็นประจำ"
    ],
    correctIndex: 1,
    explanation:
      "โรคอ้วน (โดยเฉพาะหลังหมดประจำเดือน) และการดื่มแอลกอฮอล์เป็นประจำ ทำให้ระดับฮอร์โมนเอสโตรเจนในร่างกายสูงขึ้น ซึ่งเป็นปัจจัยกระตุ้นความเสี่ยงมะเร็งเต้านมที่สำคัญ ควรควบคุมน้ำหนักและจำกัดปริมาณแอลกอฮอล์นะคะ!"
  },
  {
    id: 2,
    mascot: "Aware-Alex",
    color: "blue",
    hex: "#38bdf8",
    difficulty: "ปานกลาง",
    topic: "การเปลี่ยนแปลงของร่างกาย",
    question:
      "ก้อนที่เต้านมซึ่งคลำเจอก่อนมีประจำเดือน แล้วยุบหายไปหลังหมดประจำเดือน มักหมายถึงอะไร?",
    options: [
      "เป็นมะเร็งเต้านมแน่นอน ต้องผ่าตัดทันที",
      "การเปลี่ยนแปลงของเนื้อเยื่อตามรอบฮอร์โมน (ถุงน้ำ) ซึ่งพบได้ทั่วไป",
      "เป็นสัญญาณของโรคหัวใจ",
      "ไม่มีความหมายใดๆ ไม่ต้องสนใจเลย"
    ],
    correctIndex: 1,
    explanation:
      "ก้อนที่ยุบหายไปตามรอบเดือนมักเป็นถุงน้ำหรือการเปลี่ยนแปลงของเนื้อเยื่อ (fibrocystic changes) ซึ่งพบได้ทั่วไปและไม่ใช่มะเร็ง แต่ก้อนที่แข็ง ไม่ยุบ และไม่เจ็บ ควรรีบพบแพทย์เพื่อตรวจให้แน่ใจ!"
  },
  {
    id: 3,
    mascot: "Fit-Frank",
    color: "orange",
    hex: "#fb923c",
    difficulty: "ปานกลาง",
    topic: "วัยหมดประจำเดือน",
    question: "เพราะเหตุใดผู้หญิงวัยหมดประจำเดือนที่มีน้ำหนักเกิน จึงมีความเสี่ยงมะเร็งเต้านมสูงขึ้น?",
    options: [
      "เพราะฮอร์โมนเอสโตรเจนหมดไปเลย ทำให้ร่างกายอ่อนแอ",
      "เพราะไขมันส่วนเกินสามารถผลิตฮอร์โมนเอสโตรเจนทดแทนได้",
      "เพราะกระดูกบางลงเพียงอย่างเดียว",
      "เพราะความดันโลหิตสูงขึ้นเท่านั้น"
    ],
    correctIndex: 1,
    explanation:
      "หลังหมดประจำเดือน รังไข่หยุดผลิตเอสโตรเจน แต่เซลล์ไขมันจะเปลี่ยนสารตั้งต้นเป็นเอสโตรเจนทดแทน ทำให้ผู้ที่มีน้ำหนักเกินมีระดับฮอร์โมนสูงกว่าคนน้ำหนักปกติ จึงมีความเสี่ยงมะเร็งเต้านมสูงขึ้น!"
  },
  {
    id: 4,
    mascot: "Gene-Gina",
    color: "yellow",
    hex: "#facc15",
    difficulty: "ยาก",
    topic: "พันธุกรรม",
    question: "ปัจจัยทางพันธุกรรมข้อใด บ่งชี้ความเสี่ยงมะเร็งเต้านมสูงที่สุด?",
    options: [
      "มีญาติห่างๆ (ลูกพี่ลูกน้อง) เป็นมะเร็งปอด",
      "มีแม่หรือพี่สาวเป็นมะเร็งเต้านม ร่วมกับตรวจพบยีน BRCA1/BRCA2 ผิดปกติ",
      "พ่อเป็นโรคเบาหวาน",
      "ปู่เป็นมะเร็งต่อมลูกหมาก"
    ],
    correctIndex: 1,
    explanation:
      "การมีญาติสายตรง (แม่ พี่สาว ลูกสาว) เป็นมะเร็งเต้านม ร่วมกับยีน BRCA1/BRCA2 กลายพันธุ์ ถือเป็นปัจจัยเสี่ยงทางพันธุกรรมที่สำคัญที่สุด ควรปรึกษาแพทย์เพื่อตรวจคัดกรองเชิงรุก!"
  },
  {
    id: 5,
    mascot: "Screen-Sara",
    color: "pink",
    hex: "#ec4899",
    difficulty: "ยากมาก",
    topic: "ฮอร์โมนและกายวิภาค",
    question:
      "ข้อใดคือปัจจัยเสี่ยงมะเร็งเต้านมที่เกี่ยวข้องกับฮอร์โมนและกายวิภาคของเต้านมโดยตรง?",
    options: [
      "การนอนหลับไม่เพียงพอ",
      "เนื้อเต้านมแน่น (Dense Breast) ร่วมกับการใช้ฮอร์โมนทดแทนต่อเนื่องเป็นเวลานาน",
      "การรับประทานอาหารรสจัด",
      "การออกกำลังกายกลางแจ้ง"
    ],
    correctIndex: 1,
    explanation:
      "เนื้อเต้านมที่หนาแน่นทำให้ตรวจพบความผิดปกติได้ยากขึ้น และการใช้ฮอร์โมนทดแทน (HRT) ต่อเนื่องเป็นเวลานานก็เพิ่มความเสี่ยงมะเร็งเต้านม ผู้ที่มีเนื้อเต้านมแน่นควรตรวจอัลตราซาวด์เสริมจากแมมโมแกรม!"
  }
];

// Public version (no answer key) sent to clients.
const LEVELS_PUBLIC = LEVELS.map((l) => ({
  id: l.id,
  mascot: l.mascot,
  color: l.color,
  hex: l.hex,
  difficulty: l.difficulty,
  topic: l.topic,
  question: l.question,
  options: l.options
}));

const AVATAR_POOL = [
  "🐱", "🐶", "🐰", "🦊", "🐼", "🐨", "🐯", "🦁", "🐸", "🐵",
  "🐷", "🐮", "🐔", "🐧", "🦄", "🐙", "🐢", "🦋", "🐝", "🦉",
  "🐬", "🦕", "🐿️", "🦩", "🐳", "🦔", "🐣", "🦜", "🐴", "🦖"
];

// ---------------------------------------------------------------------------
// In-memory game state (single shared arena for up to 50 players)
// ---------------------------------------------------------------------------
let players = {}; // socket.id -> player object
let winners = [];
let gameEnded = false;
let avatarCursor = 0;

function makePlayer(id, name) {
  const avatar = AVATAR_POOL[avatarCursor % AVATAR_POOL.length];
  avatarCursor++;
  return {
    id,
    name: name.slice(0, 20),
    avatar,
    position: 0, // 0 = start
    finished: false,
    finishRank: null,
    finishTime: null,
    penaltyUntil: 0
  };
}

function publicPlayerList() {
  return Object.values(players).map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    position: p.position,
    finished: p.finished,
    finishRank: p.finishRank,
    penaltyUntil: p.penaltyUntil
  }));
}

function broadcastState() {
  io.to(ROOM_ID).emit("stateUpdate", {
    players: publicPlayerList(),
    winners,
    gameEnded,
    playerCount: Object.keys(players).length,
    maxPlayers: MAX_PLAYERS
  });
}

function checkGameOverConditions() {
  if (gameEnded) return;

  const allPlayers = Object.values(players);
  const totalPlayers = allPlayers.length;
  const allFinished = totalPlayers > 0 && allPlayers.every((p) => p.finished);

  if (winners.length >= MAX_WINNERS || allFinished) {
    gameEnded = true;
    io.to(ROOM_ID).emit("gameOver", {
      hallOfFame: winners,
      levelsRecap: LEVELS_PUBLIC.map((l) => ({ mascot: l.mascot, color: l.color, topic: l.topic })),
      message:
        "ภารกิจลุล่วง! ขอบคุณทุกคนที่ร่วมสืบหาความรู้เรื่องมะเร็งเต้านมไปด้วยกัน อย่าลืมตรวจเต้านมด้วยตนเองเป็นประจำ และพบแพทย์เพื่อตรวจคัดกรอง เพราะรู้เร็ว รักษาได้! 🎗️💗"
    });
  }
}

function resetGame() {
  players = {};
  winners = [];
  gameEnded = false;
  avatarCursor = 0;
  io.to(ROOM_ID).emit("gameReset");
  broadcastState();
}

// ---------------------------------------------------------------------------
// Socket.IO handlers
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  socket.on("join", (rawName) => {
    if (gameEnded) {
      socket.emit("joinError", "ภารกิจรอบนี้จบไปแล้ว กรุณารอให้มีผู้เล่นกดเริ่มภารกิจใหม่");
      return;
    }
    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit("joinError", "ห้องเต็มแล้ว (สูงสุด 50 คน) กรุณาลองใหม่ภายหลัง");
      return;
    }

    const name = (rawName || "สายลับนิรนาม").toString().trim() || "สายลับนิรนาม";
    const player = makePlayer(socket.id, name);
    players[socket.id] = player;
    socket.join(ROOM_ID);

    socket.emit("joined", {
      self: player,
      levels: LEVELS_PUBLIC,
      currentQuestion: LEVELS_PUBLIC[0],
      totalLevels: TOTAL_LEVELS
    });

    broadcastState();
  });

  socket.on("submitAnswer", ({ answerIndex }) => {
    const player = players[socket.id];
    if (!player || player.finished || gameEnded) return;
    if (Date.now() < player.penaltyUntil) return;

    const levelNumber = player.position + 1;
    if (levelNumber > TOTAL_LEVELS) return;

    const level = LEVELS[levelNumber - 1];
    const isCorrect = Number(answerIndex) === level.correctIndex;

    if (isCorrect) {
      player.position += 1;

      let justFinished = false;
      if (player.position === TOTAL_LEVELS) {
        player.position = TOTAL_LEVELS + 1; // finish node
        player.finished = true;
        player.finishTime = Date.now();
        justFinished = true;

        if (winners.length < MAX_WINNERS) {
          player.finishRank = winners.length + 1;
          winners.push({
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            rank: player.finishRank,
            finishTime: player.finishTime
          });
        }
      }

      const nextLevel = justFinished ? null : LEVELS_PUBLIC[player.position];

      socket.emit("answerResult", {
        correct: true,
        explanation: level.explanation,
        mascot: level.mascot,
        color: level.color,
        player,
        nextQuestion: nextLevel,
        finished: justFinished
      });

      if (justFinished) {
        io.to(ROOM_ID).emit("playerFinished", {
          name: player.name,
          avatar: player.avatar,
          rank: player.finishRank
        });
      }

      broadcastState();
      checkGameOverConditions();
    } else {
      player.penaltyUntil = Date.now() + PENALTY_MS;
      socket.emit("answerResult", {
        correct: false,
        explanation: level.explanation,
        mascot: level.mascot,
        color: level.color,
        penaltyUntil: player.penaltyUntil,
        penaltyMs: PENALTY_MS
      });
      broadcastState();
    }
  });

  socket.on("restartGame", () => {
    resetGame();
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      delete players[socket.id];
      broadcastState();
      checkGameOverConditions();
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎗️  Mission Pink server running on http://localhost:${PORT}`);
});
