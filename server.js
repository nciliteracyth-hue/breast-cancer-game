/**
 * รู้มั้ย ใครเสี่ยงมะเร็งเต้านม — 40-Level Solo / Multiplayer Board Game
 * Backend: Express + Socket.IO, fully in-memory (no database).
 *
 * Visual style: soft pastel pink theme with cute cartoon blob mascots (googly eyes).
 * Game logic below is unchanged from the original 40-level engine.
 *
 * Modes:
 *  - "solo"  -> each player gets a private room (roomId = "solo-"+socket.id)
 *  - "multi" -> everyone joins one shared public room, max 20 players,
 *               first 5 to reach the finish line are recorded as winners.
 */

const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const MAX_PUBLIC_PLAYERS = 20;
const MAX_WINNERS = 5;
const PENALTY_MS = 3000;
const TOTAL_LEVELS = 40;
const PUBLIC_ROOM_ID = "public-race";

// ---------------------------------------------------------------------------
// Admin auth — single shared password (set ADMIN_PASSWORD env var in prod),
// sessions kept in memory only (no database), matching the rest of this app.
// ---------------------------------------------------------------------------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_COOKIE = "admin_session";
const adminSessions = new Set();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function adminTokenFrom(req) {
  return parseCookies(req.headers.cookie)[ADMIN_COOKIE];
}

function isAdminAuthed(req) {
  const token = adminTokenFrom(req);
  return !!token && adminSessions.has(token);
}

function requireAdmin(req, res, next) {
  if (isAdminAuthed(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ---------------------------------------------------------------------------
// Game content — 40 levels across 8 recurring categories, each category
// progressing from easy to very hard as the level number increases.
// correctIndex / explanation are kept server-side only.
// ---------------------------------------------------------------------------
const CATEGORY_NAMES = [
  "วิถีชีวิตและพฤติกรรมเสี่ยง",
  "การเปลี่ยนแปลงของร่างกาย",
  "วัยหมดประจำเดือนและฮอร์โมน",
  "พันธุกรรมและประวัติครอบครัว",
  "ฮอร์โมนทดแทนและกายวิภาคเต้านม",
  "การตรวจคัดกรองและเทคโนโลยี",
  "ความเชื่อและตำนานผิดๆ",
  "การดูแลรักษาและการใช้ชีวิต"
];

const DIFFICULTY_LABELS = ["ง่าย", "ง่าย-ปานกลาง", "ปานกลาง", "ยาก", "ยากมาก"];

// Mission Pink mascots — one per category, purely for frontend styling.
// This does not change any game logic, only adds display metadata.
const MASCOTS = [
  { name: "Nutri-Nia", color: "green", hex: "#4ade80" },
  { name: "Aware-Alex", color: "blue", hex: "#38bdf8" },
  { name: "Fit-Frank", color: "orange", hex: "#fb923c" },
  { name: "Gene-Gina", color: "yellow", hex: "#facc15" },
  { name: "Screen-Sara", color: "pink", hex: "#ec4899" },
  { name: "Scan-Somsri", color: "teal", hex: "#14b8a6" },
  { name: "Myth-Mint", color: "purple", hex: "#a78bfa" },
  { name: "Hope-Hana", color: "coral", hex: "#fb7185" }
];

// Raw content grouped by category (index 0-7), each with 5 tiers (easy -> very hard).
const RAW_CONTENT = [
  // Category 0: วิถีชีวิตและพฤติกรรมเสี่ยง
  [
    {
      avatar: "🍔", name: "มะนาว (อายุ 25 ปี)",
      desc: "ชอบกินของทอด ของหวาน ปาร์ตี้ดื่มแอลกอฮอล์บ่อย และมีน้ำหนักตัวเกินเกณฑ์มาตรฐาน",
      question: "พฤติกรรมของมะนาว ส่งผลต่อความเสี่ยงมะเร็งเต้านมหรือไม่?",
      options: ["ไม่เสี่ยงเลย เพราะยังอายุน้อย", "เสี่ยงเพิ่มขึ้น จากแอลกอฮอล์และความอ้วน"],
      correctIndex: 1,
      explanation: "แม้อายุน้อย แต่ความอ้วน (โดยเฉพาะไขมันสะสม) และการดื่มแอลกอฮอล์เป็นประจำ จะไปกระตุ้นฮอร์โมนที่เพิ่มความเสี่ยงมะเร็งเต้านมสะสมระยะยาวได้ ควรเริ่มปรับพฤติกรรมแต่เนิ่นๆ"
    },
    {
      avatar: "🚬", name: "พี่แนน (อายุ 32 ปี)",
      desc: "สูบบุหรี่มา 10 ปี ไม่ค่อยออกกำลังกาย นั่งทำงานทั้งวัน",
      question: "การสูบบุหรี่เกี่ยวข้องกับความเสี่ยงมะเร็งเต้านมหรือไม่?",
      options: ["ไม่เกี่ยวข้องเลย", "เกี่ยวข้อง โดยเฉพาะถ้าสูบก่อนมีบุตรคนแรก"],
      correctIndex: 1,
      explanation: "สารพิษในบุหรี่ส่งผลต่อเซลล์เต้านมโดยตรง โดยเฉพาะหากสูบตั้งแต่ช่วงวัยรุ่นก่อนตั้งครรภ์ครั้งแรก จะยิ่งเพิ่มความเสี่ยงมะเร็งเต้านมในระยะยาว"
    },
    {
      avatar: "🌙", name: "คุณอร (อายุ 40 ปี)",
      desc: "ทำงานกะดึกเป็นประจำมา 15 ปี นอนไม่เป็นเวลา และมีน้ำหนักเกินเล็กน้อย",
      question: "การทำงานกะดึกเป็นเวลานานเกี่ยวข้องกับความเสี่ยงมะเร็งเต้านมหรือไม่?",
      options: ["ไม่เกี่ยวข้อง", "มีงานวิจัยชี้ว่าอาจเพิ่มความเสี่ยงจากการรบกวนฮอร์โมนเมลาโทนิน"],
      correctIndex: 1,
      explanation: "การทำงานกะดึกรบกวนนาฬิกาชีวภาพและการหลั่งฮอร์โมนเมลาโทนิน ซึ่งงานวิจัยหลายชิ้นเชื่อมโยงการรบกวนนี้กับความเสี่ยงมะเร็งเต้านมที่เพิ่มขึ้น"
    },
    {
      avatar: "🍰", name: "คุณเบล (อายุ 38 ปี)",
      desc: "มีน้ำหนักเกินมาตั้งแต่วัยรุ่น ไม่เคยมีบุตร และเริ่มมีประจำเดือนครั้งแรกตอนอายุ 10 ปี",
      question: "ปัจจัยใดในเคสนี้ที่เพิ่มระยะเวลาการสัมผัสฮอร์โมนเอสโตรเจนสะสมมากที่สุด?",
      options: ["การไม่มีบุตรและการมีประจำเดือนเร็ว ทำให้สัมผัสฮอร์โมนเอสโตรเจนนานขึ้น", "การไม่มีบุตรไม่มีผลใดๆ ต่อฮอร์โมนเลย"],
      correctIndex: 0,
      explanation: "การมีประจำเดือนเร็วและไม่มีบุตร (หรือมีบุตรช้า) ทำให้ร่างกายสัมผัสฮอร์โมนเอสโตรเจนต่อเนื่องยาวนานขึ้น ซึ่งเป็นปัจจัยเสี่ยงสะสมที่สำคัญของมะเร็งเต้านม"
    },
    {
      avatar: "🍷", name: "คุณฝน (อายุ 45 ปี)",
      desc: "มีปัจจัยเสี่ยงร่วมหลายอย่าง: มีน้ำหนักเกิน ดื่มแอลกอฮอล์ทุกสัปดาห์ ทานยาคุมกำเนิดต่อเนื่อง 12 ปี และไม่ออกกำลังกาย",
      question: "การมีปัจจัยเสี่ยงหลายอย่างพร้อมกันแบบนี้ ส่งผลต่อความเสี่ยงโดยรวมอย่างไร?",
      options: ["ความเสี่ยงจะสะสมและทวีคูณมากกว่าการมีปัจจัยเดียว", "ปัจจัยต่างๆ จะหักล้างกันเอง ความเสี่ยงจึงเท่าเดิม"],
      correctIndex: 0,
      explanation: "ปัจจัยเสี่ยงด้านวิถีชีวิตมักมีผลสะสม (cumulative effect) เมื่อมีหลายปัจจัยร่วมกัน ความเสี่ยงโดยรวมจะสูงกว่าการมีปัจจัยใดปัจจัยหนึ่งเพียงอย่างเดียวอย่างมีนัยสำคัญ"
    }
  ],
  // Category 1: การเปลี่ยนแปลงของร่างกาย
  [
    {
      avatar: "🤲", name: "พี่นัท (อายุ 35 ปี)",
      desc: "สุขภาพแข็งแรงดี คลำเต้านมด้วยตัวเองก่อนมีประจำเดือนพบ 'ก้อนแข็ง' แต่พอหมดประจำเดือนก้อนนั้นก็เล็กลงและหายไป",
      question: "อาการนี้ถือว่าอันตราย และเป็นมะเร็งแน่นอนหรือไม่?",
      options: ["มักเป็นปกติจากการเปลี่ยนแปลงของฮอร์โมน", "อันตรายมาก รีบไปผ่าตัดด่วน!"],
      correctIndex: 0,
      explanation: "ก้อนที่คลำเจอช่วงก่อนเมนส์มาและยุบหายไปเอง มักเป็น 'ถุงน้ำ' หรือการเปลี่ยนแปลงของเนื้อเต้านมตามรอบฮอร์โมน (Fibrocystic changes) อย่างไรก็ตาม ควรตรวจคลำเต้านมตนเองทุกเดือน หลังประจำเดือนหมด 5-7 วัน ซึ่งเป็นช่วงที่เต้านมนิ่มที่สุด"
    },
    {
      avatar: "💧", name: "น้องปุ๊ก (อายุ 27 ปี)",
      desc: "สังเกตว่าหัวนมมีของเหลวไหลออกมาเองโดยไม่ได้บีบ มีสีคล้ายเลือดเล็กน้อย",
      question: "อาการของเหลวจากหัวนมแบบนี้ควรทำอย่างไร?",
      options: ["เป็นเรื่องปกติ ไม่ต้องตรวจ", "ควรพบแพทย์เพื่อตรวจเพิ่มเติมทันที"],
      correctIndex: 1,
      explanation: "ของเหลวที่ไหลเองโดยไม่บีบ โดยเฉพาะที่มีเลือดปน เป็นสัญญาณที่ควรตรวจอย่างละเอียด แม้ส่วนใหญ่จะไม่ใช่มะเร็งแต่ต้องแยกโรคให้แน่ชัดโดยแพทย์"
    },
    {
      avatar: "🍊", name: "คุณอ้อย (อายุ 42 ปี)",
      desc: "สังเกตผิวหนังบริเวณเต้านมมีลักษณะบุ๋มคล้ายผิวส้ม (dimpling) ร่วมกับหัวนมบุ๋มเข้าใหม่",
      question: "อาการนี้จัดเป็นสัญญาณเตือนระดับใด?",
      options: ["เป็นสัญญาณเตือนสำคัญที่ควรพบแพทย์ทันที", "เป็นเรื่องปกติของผิวหนังทั่วไป"],
      correctIndex: 0,
      explanation: "ผิวบุ๋มคล้ายส้ม (peau d'orange) และหัวนมบุ๋มใหม่ เป็นสัญญาณที่พบได้ในมะเร็งเต้านมชนิดลุกลาม ควรรีบพบแพทย์เพื่อวินิจฉัยโดยเร็ว"
    },
    {
      avatar: "🔍", name: "คุณมล (อายุ 30 ปี)",
      desc: "คลำเจอก้อนที่เคลื่อนไปมาได้ ผิวเรียบ ไม่เจ็บ ขนาดคงที่มา 2 ปี แพทย์วินิจฉัยว่าเป็น fibroadenoma",
      question: "ลักษณะก้อนแบบนี้ต่างจากก้อนมะเร็งอย่างไร?",
      options: ["ก้อนมะเร็งมักแข็ง ขอบไม่เรียบ ยึดติดกับเนื้อเยื่อ ไม่ค่อยเคลื่อนที่", "ก้อนมะเร็งจะเคลื่อนที่ได้ง่ายเหมือนกันทุกประการ"],
      correctIndex: 0,
      explanation: "Fibroadenoma มักนุ่ม ขอบเรียบ เคลื่อนที่ได้ ต่างจากก้อนมะเร็งที่มักแข็ง ขอบไม่เรียบ และยึดติดกับเนื้อเยื่อโดยรอบ อย่างไรก็ตามก้อนทุกชนิดควรได้รับการตรวจยืนยันจากแพทย์เสมอ"
    },
    {
      avatar: "🔬", name: "คุณจิน (อายุ 48 ปี)",
      desc: "ตรวจแมมโมแกรมพบก้อนขนาดเล็กมาก ไม่สามารถคลำเจอด้วยมือ แพทย์แนะนำให้ทำการเจาะชิ้นเนื้อ (biopsy) เพื่อยืนยัน",
      question: "เหตุใดการเจาะชิ้นเนื้อจึงจำเป็นแม้ภาพถ่ายจะดูน่าสงสัย?",
      options: ["ภาพถ่ายเพียงอย่างเดียวไม่สามารถยืนยันได้ 100% ว่าเป็นมะเร็งหรือไม่ ต้องอาศัยผลชิ้นเนื้อยืนยัน", "ถ้าเห็นในภาพถ่ายแล้วถือว่าฟันธงได้เลยว่าเป็นมะเร็ง"],
      correctIndex: 0,
      explanation: "การตรวจทางรังสีเป็นเพียงเครื่องมือคัดกรอง การวินิจฉัยที่แน่ชัดว่าเป็นมะเร็งหรือไม่ต้องอาศัยผลการตรวจชิ้นเนื้อทางพยาธิวิทยาเสมอ"
    }
  ],
  // Category 2: วัยหมดประจำเดือนและฮอร์โมน
  [
    {
      avatar: "🌸", name: "คุณแม่พิมพ์ (อายุ 52 ปี)",
      desc: "เพิ่งเข้าสู่วัยทอง (หมดประจำเดือน) รูปร่างท้วมขึ้น น้ำหนักตัวเพิ่มขึ้นรวดเร็ว ไม่เคยมีคนในครอบครัวเป็นมะเร็ง",
      question: "ปัจจัยใดในตอนนี้ ที่ทำให้คุณแม่พิมพ์มีความเสี่ยงมะเร็งเต้านมสูงขึ้น?",
      options: ["การไม่มีประวัติครอบครัวป่วย", "อายุที่มากขึ้น และความอ้วนหลังหมดประจำเดือน"],
      correctIndex: 1,
      explanation: "เมื่อหมดประจำเดือน รังไข่จะหยุดสร้างเอสโตรเจน แต่ 'เซลล์ไขมัน' ในคนอ้วนจะเปลี่ยนสารตั้งต้นให้กลายเป็นเอสโตรเจนแทน ฮอร์โมนที่มากเกินไปนี้จะไปกระตุ้นเต้านม ประกอบกับอายุที่มากขึ้นก็เป็นปัจจัยเสี่ยงหลัก"
    },
    {
      avatar: "⏳", name: "คุณนิด (อายุ 50 ปี)",
      desc: "เริ่มมีประจำเดือนตอนอายุ 10 ปี (เร็วกว่าปกติ) และคาดว่าจะหมดประจำเดือนช้ากว่าคนทั่วไป",
      question: "การมีประจำเดือนเร็วและหมดช้า ส่งผลต่อความเสี่ยงอย่างไร?",
      options: ["ไม่มีผลใดๆ", "เพิ่มความเสี่ยงเพราะสัมผัสฮอร์โมนเอสโตรเจนนานกว่าคนทั่วไป"],
      correctIndex: 1,
      explanation: "ยิ่งมีรอบประจำเดือนยาวนาน (เริ่มเร็ว-หมดช้า) ร่างกายยิ่งสัมผัสฮอร์โมนเอสโตรเจนสะสมนานขึ้น ซึ่งเป็นปัจจัยเสี่ยงของมะเร็งเต้านม"
    },
    {
      avatar: "🧈", name: "คุณวิภา (อายุ 55 ปี)",
      desc: "หมดประจำเดือนมา 5 ปี มีภาวะอ้วนลงพุง (BMI 31) และไม่เคยออกกำลังกาย",
      question: "เพราะเหตุใดไขมันหน้าท้องจึงเพิ่มความเสี่ยงเป็นพิเศษในวัยหมดประจำเดือน?",
      options: ["ไขมันหน้าท้องเป็นแหล่งผลิตเอสโตรเจนทดแทนหลังรังไข่หยุดทำงาน", "ไขมันหน้าท้องไม่เกี่ยวข้องกับฮอร์โมนเลย"],
      correctIndex: 0,
      explanation: "หลังหมดประจำเดือน เนื้อเยื่อไขมันโดยเฉพาะไขมันช่องท้องจะเปลี่ยนสารตั้งต้นเป็นเอสโตรเจน ทำให้ระดับฮอร์โมนยังคงสูงและกระตุ้นเซลล์เต้านมได้"
    },
    {
      avatar: "📊", name: "คุณสมร (อายุ 58 ปี)",
      desc: "หมดประจำเดือน มีค่าดัชนีมวลกาย (BMI) 33 ผลตรวจเลือดพบระดับเอสโตรเจนสูงกว่าคนวัยเดียวกันที่ผอมกว่า",
      question: "ข้อมูลนี้สนับสนุนแนวคิดใด?",
      options: ["คนอ้วนวัยทองมีความเสี่ยงมะเร็งเต้านมสูงกว่าคนผอมในวัยเดียวกัน", "น้ำหนักตัวไม่มีผลต่อระดับฮอร์โมนในวัยทอง"],
      correctIndex: 0,
      explanation: "งานวิจัยยืนยันว่าผู้หญิงวัยหมดประจำเดือนที่มีน้ำหนักเกินมีความเสี่ยงมะเร็งเต้านมสูงกว่าคนที่มีน้ำหนักปกติอย่างชัดเจน เนื่องจากระดับฮอร์โมนเอสโตรเจนที่สูงกว่า"
    },
    {
      avatar: "📈", name: "งานวิจัยเชิงสถิติ",
      desc: "งานวิจัยชิ้นหนึ่งพบว่าผู้หญิงที่หมดประจำเดือนหลังอายุ 55 ปี มีความเสี่ยงมะเร็งเต้านมสูงกว่าผู้หญิงที่หมดประจำเดือนก่อนอายุ 45 ปี ประมาณ 2 เท่า",
      question: "ข้อสรุปใดอธิบายผลวิจัยนี้ได้ถูกต้องที่สุด?",
      options: ["ระยะเวลาการสัมผัสฮอร์โมนเอสโตรเจนตลอดชีวิตที่ยาวนานกว่า สัมพันธ์กับความเสี่ยงที่สูงขึ้น", "อายุที่หมดประจำเดือนไม่มีความสัมพันธ์ใดๆ กับความเสี่ยงมะเร็ง"],
      correctIndex: 0,
      explanation: "ยิ่งหมดประจำเดือนช้า ร่างกายยิ่งสัมผัสฮอร์โมนเอสโตรเจนจากรอบเดือนยาวนานกว่า ซึ่งเป็นปัจจัยเสี่ยงสะสมที่สำคัญของมะเร็งเต้านม"
    }
  ],
  // Category 3: พันธุกรรมและประวัติครอบครัว
  [
    {
      avatar: "🧬", name: "คุณดาว (อายุ 45 ปี)",
      desc: "มีประวัติสายตรง คือ คุณแม่และพี่สาวแท้ๆ ป่วยเป็นมะเร็งเต้านมตั้งแต่พวกเขายังอายุไม่ถึง 45 ปี",
      question: "คุณดาวควรปฏิบัติตัวอย่างไรเพื่อป้องกันความเสี่ยงอย่างเหมาะสมที่สุด?",
      options: ["รอให้เจ็บ หรือคลำเจอก้อนค่อยไปพบแพทย์", "พบแพทย์เพื่อคัดกรอง และอาจพิจารณาตรวจยีนพันธุกรรม"],
      correctIndex: 1,
      explanation: "ประวัติสายตรงเป็นมะเร็งเต้านมตั้งแต่อายุน้อย ถือว่าเสี่ยงสูงมาก (High Risk) คุณดาวอาจมียีนกลายพันธุ์ เช่น BRCA1/BRCA2 ควรทำแมมโมแกรม+อัลตราซาวด์ทุกปี และปรึกษาแพทย์เฉพาะทาง"
    },
    {
      avatar: "👪", name: "คุณเมย์ (อายุ 33 ปี)",
      desc: "ยายและป้าฝ่ายแม่เคยป่วยมะเร็งเต้านม แต่แม่ของเธอไม่เป็นอะไร",
      question: "การที่ยายและป้า (ไม่ใช่ญาติสายตรงกับตัวเธอโดยตรง) เป็นมะเร็ง มีความสำคัญหรือไม่?",
      options: ["ไม่สำคัญเลยเพราะแม่ไม่เป็น", "ยังคงมีความสำคัญ ควรแจ้งประวัติครอบครัวฝ่ายแม่ให้แพทย์ทราบเพื่อประเมินความเสี่ยง"],
      correctIndex: 1,
      explanation: "ประวัติครอบครัวทั้งฝ่ายแม่และพ่อ รวมถึงญาติที่ไม่ใช่สายตรงโดยตรง ก็มีผลต่อการประเมินความเสี่ยงทางพันธุกรรม ควรแจ้งแพทย์ให้ครบถ้วนเสมอ"
    },
    {
      avatar: "🧫", name: "คุณฟ้า (อายุ 38 ปี)",
      desc: "ตรวจพบยีน BRCA1 กลายพันธุ์ แต่ยังไม่มีอาการหรือก้อนใดๆ",
      question: "การตรวจพบยีนกลายพันธุ์โดยไม่มีอาการ หมายความว่าอย่างไร?",
      options: ["หมายความว่าไม่มีความเสี่ยงเพราะยังไม่มีอาการ", "หมายความว่ามีความเสี่ยงสูงกว่าคนทั่วไปมากในอนาคต ควรวางแผนเฝ้าระวังเชิงรุก"],
      correctIndex: 1,
      explanation: "ผู้ที่มียีน BRCA1/2 กลายพันธุ์มีความเสี่ยงสะสมตลอดชีวิตสูงถึง 45-72% แม้ยังไม่มีอาการ จึงควรวางแผนตรวจคัดกรองถี่ขึ้นหรือปรึกษามาตรการป้องกันเชิงรุกกับแพทย์"
    },
    {
      avatar: "👨‍👩‍👧‍👦", name: "ครอบครัวคุณตาล",
      desc: "มีทั้งมะเร็งเต้านมและมะเร็งรังไข่ในญาติสายตรงหลายคนของครอบครัว",
      question: "รูปแบบการป่วยในครอบครัวนี้บ่งชี้ถึงกลุ่มอาการใด?",
      options: ["กลุ่มอาการมะเร็งเต้านมและรังไข่ทางพันธุกรรม (Hereditary Breast and Ovarian Cancer syndrome)", "เป็นเรื่องบังเอิญที่ไม่มีความเกี่ยวข้องกันทางพันธุกรรม"],
      correctIndex: 0,
      explanation: "การพบมะเร็งเต้านมและรังไข่ร่วมกันในครอบครัวเดียวกันหลายคน เป็นลักษณะเฉพาะของกลุ่มอาการทางพันธุกรรมที่เกี่ยวข้องกับยีน BRCA ควรปรึกษาแพทย์ผู้เชี่ยวชาญด้านพันธุศาสตร์มะเร็ง"
    },
    {
      avatar: "⚕️", name: "คุณแพร (อายุ 40 ปี)",
      desc: "ตรวจพบยีน BRCA1 กลายพันธุ์ และกำลังตัดสินใจระหว่างการเฝ้าระวังถี่ขึ้นกับการผ่าตัดป้องกัน (risk-reducing mastectomy)",
      question: "การผ่าตัดป้องกันมีจุดประสงค์อย่างไร?",
      options: ["เพื่อลดความเสี่ยงการเกิดมะเร็งเต้านมในอนาคตอย่างมีนัยสำคัญในผู้ที่มีความเสี่ยงทางพันธุกรรมสูงมาก", "เพื่อรักษามะเร็งที่เป็นอยู่แล้วให้หายขาด"],
      correctIndex: 0,
      explanation: "การผ่าตัดป้องกัน (risk-reducing mastectomy) เป็นทางเลือกสำหรับผู้ที่มีความเสี่ยงทางพันธุกรรมสูงมาก เพื่อลดโอกาสเกิดมะเร็งในอนาคต ไม่ใช่การรักษามะเร็งที่มีอยู่แล้ว การตัดสินใจควรทำร่วมกับแพทย์ผู้เชี่ยวชาญอย่างรอบคอบ"
    }
  ],
  // Category 4: ฮอร์โมนทดแทนและกายวิภาคเต้านม
  [
    {
      avatar: "💊", name: "ป้าศรี (อายุ 60 ปี)",
      desc: "ทานยาฮอร์โมนทดแทนวัยทองมา 10 ปี และผลตรวจแมมโมแกรมระบุว่ามีภาวะ 'เนื้อเต้านมแน่น (Dense Breast)'",
      question: "ระดับความเสี่ยงมะเร็งเต้านมของป้าศรี จัดอยู่ในระดับใด?",
      options: ["เสี่ยงทั่วไป เพราะยาฮอร์โมนทดแทนปลอดภัยเสมอ", "เสี่ยงสูง ต้องเฝ้าระวังอย่างใกล้ชิดร่วมกับแพทย์"],
      correctIndex: 1,
      explanation: "การใช้ยาฮอร์โมนทดแทนแบบรวม (เอสโตรเจน+โปรเจสติน) ติดต่อกันเกิน 5 ปี จะเพิ่มความเสี่ยงมะเร็งเต้านม และภาวะเนื้อเต้านมแน่นก็เพิ่มความเสี่ยงเช่นกัน อีกทั้งยังทำให้ภาพแมมโมแกรมดูยากขึ้นด้วย"
    },
    {
      avatar: "⏱️", name: "คุณนุช (อายุ 50 ปี)",
      desc: "เริ่มทานฮอร์โมนทดแทนเพื่อลดอาการร้อนวูบวาบมาได้ 2 ปี",
      question: "การทานฮอร์โมนทดแทนระยะสั้น (ไม่เกิน 3-5 ปี) มีความเสี่ยงอย่างไรเทียบกับระยะยาว?",
      options: ["ความเสี่ยงจากการใช้ระยะสั้นต่ำกว่าการใช้ต่อเนื่องเกิน 5 ปีอย่างชัดเจน", "ระยะเวลาการใช้ไม่มีผลต่อความเสี่ยงเลย"],
      correctIndex: 0,
      explanation: "ความเสี่ยงมะเร็งเต้านมจากฮอร์โมนทดแทนสัมพันธ์กับระยะเวลาการใช้ ยิ่งใช้นานความเสี่ยงยิ่งเพิ่ม การใช้ระยะสั้นภายใต้คำแนะนำแพทย์จึงมีความเสี่ยงต่ำกว่า"
    },
    {
      avatar: "⚗️", name: "คุณอำไพ (อายุ 55 ปี)",
      desc: "ทานฮอร์โมนทดแทนชนิด 'เอสโตรเจนอย่างเดียว' (ไม่มีโปรเจสติน) เนื่องจากตัดมดลูกไปแล้ว",
      question: "ฮอร์โมนทดแทนชนิดเอสโตรเจนเดี่ยว เทียบกับชนิดผสม (เอสโตรเจน+โปรเจสติน) มีความเสี่ยงต่อเต้านมต่างกันหรือไม่?",
      options: ["ชนิดผสมมักมีความเสี่ยงต่อมะเร็งเต้านมสูงกว่าชนิดเอสโตรเจนเดี่ยว", "ทั้งสองชนิดมีความเสี่ยงเท่ากันทุกประการ"],
      correctIndex: 0,
      explanation: "งานวิจัยพบว่าฮอร์โมนทดแทนชนิดผสม (เอสโตรเจน+โปรเจสติน) มีความสัมพันธ์กับความเสี่ยงมะเร็งเต้านมสูงกว่าชนิดเอสโตรเจนเดี่ยว ซึ่งมักใช้ในผู้ที่ตัดมดลูกไปแล้ว"
    },
    {
      avatar: "🩻", name: "คุณตุ๊ก (อายุ 47 ปี)",
      desc: "ผลแมมโมแกรมระบุว่ามีเนื้อเต้านมแน่นระดับ C (heterogeneously dense)",
      question: "เนื้อเต้านมแน่นส่งผลต่อการตรวจคัดกรองอย่างไร?",
      options: ["ทำให้มองเห็นก้อนผิดปกติในภาพแมมโมแกรมได้ยากขึ้น และอาจต้องตรวจอัลตราซาวด์เสริม", "ไม่มีผลใดๆ ต่อความแม่นยำของการตรวจ"],
      correctIndex: 0,
      explanation: "เนื้อเต้านมแน่นจะปรากฏเป็นสีขาวในภาพแมมโมแกรม เช่นเดียวกับก้อนเนื้อผิดปกติ ทำให้ตรวจพบได้ยากขึ้น จึงมักแนะนำให้ตรวจอัลตราซาวด์หรือ MRI เพิ่มเติมในผู้ที่มีเนื้อเต้านมแน่นมาก"
    },
    {
      avatar: "📋", name: "คุณละออง (อายุ 62 ปี)",
      desc: "ทานฮอร์โมนทดแทนชนิดผสมต่อเนื่อง 8 ปี และมีเนื้อเต้านมแน่นร่วมด้วย แพทย์แนะนำให้ประเมินความเสี่ยงและประโยชน์อย่างละเอียด",
      question: "ในสถานการณ์ที่มีปัจจัยเสี่ยงซ้อนกันหลายอย่างเช่นนี้ แนวทางที่เหมาะสมที่สุดคืออะไร?",
      options: ["ปรึกษาแพทย์เพื่อชั่งน้ำหนักประโยชน์และความเสี่ยงเป็นรายบุคคล พร้อมเฝ้าระวังถี่ขึ้น", "หยุดยาเองทันทีโดยไม่ปรึกษาแพทย์เพราะกลัวมะเร็ง"],
      correctIndex: 0,
      explanation: "การตัดสินใจเกี่ยวกับฮอร์โมนทดแทนควรทำร่วมกับแพทย์เสมอ โดยพิจารณาปัจจัยเสี่ยงรายบุคคล ประโยชน์ด้านคุณภาพชีวิต และแผนการเฝ้าระวังที่เหมาะสม ไม่ควรหยุดยาเองโดยไม่ปรึกษาแพทย์"
    }
  ],
  // Category 5: การตรวจคัดกรองและเทคโนโลยี
  [
    {
      avatar: "🏥", name: "คุณหญิง (อายุ 39 ปี)",
      desc: "ยังไม่เคยตรวจแมมโมแกรมเลยตลอดชีวิต",
      question: "ผู้หญิงทั่วไปควรเริ่มตรวจแมมโมแกรมครั้งแรกเมื่ออายุเท่าไหร่โดยประมาณ?",
      options: ["ประมาณอายุ 40 ปีขึ้นไป (หรือตามคำแนะนำแพทย์)", "ต้องรอให้อายุ 70 ปีขึ้นไปเท่านั้น"],
      correctIndex: 0,
      explanation: "โดยทั่วไปแนะนำให้ผู้หญิงเริ่มตรวจแมมโมแกรมเมื่ออายุ 40 ปีขึ้นไป หรือเร็วกว่านั้นหากมีปัจจัยเสี่ยงสูง เช่น ประวัติครอบครัว ควรปรึกษาแพทย์เพื่อวางแผนที่เหมาะสมกับตนเอง"
    },
    {
      avatar: "📷", name: "คุณเอ๋ (อายุ 45 ปี)",
      desc: "ตรวจแมมโมแกรมประจำปีตามปกติ ไม่มีอาการผิดปกติใดๆ",
      question: "การตรวจแมมโมแกรมประจำปีแบบนี้เรียกว่าอะไร และต่างจากกรณีมีก้อนผิดปกติอย่างไร?",
      options: ["เรียกว่า screening mammogram ส่วนกรณีมีอาการผิดปกติจะเป็น diagnostic mammogram ซึ่งตรวจละเอียดกว่า", "ทั้งสองแบบเหมือนกันทุกประการไม่มีความแตกต่าง"],
      correctIndex: 0,
      explanation: "Screening mammogram คือการตรวจคัดกรองในคนที่ไม่มีอาการ ส่วน diagnostic mammogram ใช้ตรวจเพิ่มเติมเมื่อพบความผิดปกติ ซึ่งมักตรวจละเอียดและใช้มุมภาพมากกว่า"
    },
    {
      avatar: "🔎", name: "คุณพลอย (อายุ 29 ปี)",
      desc: "คลำเจอก้อนที่เต้านม แพทย์แนะนำให้ตรวจอัลตราซาวด์แทนแมมโมแกรม",
      question: "เหตุใดผู้หญิงอายุน้อยจึงมักตรวจด้วยอัลตราซาวด์ก่อน?",
      options: ["เพราะเนื้อเต้านมในคนอายุน้อยมักแน่นกว่า อัลตราซาวด์จึงให้ภาพที่ชัดเจนกว่าแมมโมแกรมในกรณีนี้", "เพราะอัลตราซาวด์ราคาแพงกว่าจึงใช้กับคนอายุน้อยเท่านั้น"],
      correctIndex: 0,
      explanation: "ในผู้หญิงอายุน้อยที่เนื้อเต้านมมักหนาแน่นกว่า อัลตราซาวด์มักให้ภาพที่ชัดเจนกว่าแมมโมแกรม จึงมักเลือกใช้เป็นการตรวจเบื้องต้นก่อน"
    },
    {
      avatar: "🧲", name: "คุณดวงใจ (อายุ 42 ปี)",
      desc: "มีประวัติครอบครัวเป็นมะเร็งเต้านมและมียีน BRCA แพทย์แนะนำให้ตรวจ MRI เต้านมเพิ่มเติมนอกจากแมมโมแกรม",
      question: "เหตุใดกลุ่มเสี่ยงสูงจึงต้องตรวจ MRI เพิ่มเติม?",
      options: ["MRI มีความไวสูงกว่าในการตรวจพบมะเร็งในกลุ่มที่มีความเสี่ยงสูงทางพันธุกรรม", "MRI ไม่มีประโยชน์เพิ่มเติมใดๆ เมื่อเทียบกับแมมโมแกรม"],
      correctIndex: 0,
      explanation: "สำหรับผู้ที่มีความเสี่ยงสูงทางพันธุกรรม เช่น มียีน BRCA การตรวจ MRI ร่วมกับแมมโมแกรมจะช่วยเพิ่มความไวในการตรวจพบมะเร็งระยะเริ่มต้นได้ดีกว่าการตรวจแมมโมแกรมเพียงอย่างเดียว"
    },
    {
      avatar: "📄", name: "คุณรัตน์",
      desc: "ผลแมมโมแกรมได้รับการจัดระดับ BI-RADS 4 ซึ่งหมายถึง 'สงสัยความผิดปกติ'",
      question: "การจัดระดับ BI-RADS 4 หมายความว่าอย่างไร และควรทำอย่างไรต่อ?",
      options: ["มีโอกาสเป็นมะเร็งระดับหนึ่งที่ต้องตรวจเพิ่มเติม เช่น การเจาะชิ้นเนื้อ ไม่ได้แปลว่าเป็นมะเร็งแน่นอน", "หมายถึงเป็นมะเร็งระยะสุดท้ายแน่นอน 100%"],
      correctIndex: 0,
      explanation: "ระบบ BI-RADS ใช้จัดระดับความน่าสงสัยของภาพถ่ายทางรังสี โดย BI-RADS 4 หมายถึงมีความน่าสงสัยระดับปานกลางถึงสูงที่ควรตรวจเพิ่มเติม เช่น การเจาะชิ้นเนื้อ เพื่อยืนยันผลที่แน่ชัด ไม่ใช่การวินิจฉัยขั้นสุดท้าย"
    }
  ],
  // Category 6: ความเชื่อและตำนานผิดๆ
  [
    {
      avatar: "❓", name: "น้องเบล (อายุ 24 ปี)",
      desc: "มีคนบอกน้องเบลว่า 'อายุน้อยไม่มีทางเป็นมะเร็งเต้านมหรอก'",
      question: "คำกล่าวนี้ถูกต้องหรือไม่?",
      options: ["ถูกต้อง คนอายุน้อยไม่มีทางเป็น", "ไม่ถูกต้อง มะเร็งเต้านมพบได้ในทุกช่วงวัยแม้จะพบน้อยกว่าในคนอายุน้อย"],
      correctIndex: 1,
      explanation: "แม้มะเร็งเต้านมจะพบมากขึ้นตามอายุ แต่ก็สามารถเกิดขึ้นได้ในผู้หญิงอายุน้อยเช่นกัน โดยเฉพาะผู้ที่มีปัจจัยเสี่ยงทางพันธุกรรม จึงไม่ควรประมาทไม่ว่าจะอายุเท่าไหร่"
    },
    {
      avatar: "👨", name: "คุณสมชาย (อายุ 50 ปี)",
      desc: "สงสัยว่า 'ผู้ชายเป็นมะเร็งเต้านมได้ไหม'",
      question: "ผู้ชายมีโอกาสเป็นมะเร็งเต้านมหรือไม่?",
      options: ["ไม่มีทางเป็นเพราะผู้ชายไม่มีเต้านม", "มีโอกาสเป็นได้ แม้จะพบน้อยกว่าผู้หญิงมาก"],
      correctIndex: 1,
      explanation: "ผู้ชายก็มีเนื้อเยื่อเต้านมและสามารถเป็นมะเร็งเต้านมได้ แม้จะพบได้น้อยกว่าผู้หญิงมาก (ประมาณ 1% ของผู้ป่วยทั้งหมด) จึงไม่ควรละเลยหากพบก้อนผิดปกติที่หน้าอก"
    },
    {
      avatar: "🎽", name: "คุณจอย (อายุ 33 ปี)",
      desc: "เพื่อนของคุณจอยเตือนว่า 'ใส่ยกทรงมีโครงเหล็กบ่อยๆ ทำให้เป็นมะเร็งเต้านม'",
      question: "ความเชื่อนี้มีหลักฐานทางการแพทย์รองรับหรือไม่?",
      options: ["มีหลักฐานชัดเจนว่าเป็นสาเหตุโดยตรง", "ไม่มีหลักฐานทางวิทยาศาสตร์ที่น่าเชื่อถือสนับสนุนความเชื่อนี้"],
      correctIndex: 1,
      explanation: "ปัจจุบันไม่มีหลักฐานทางวิทยาศาสตร์ที่น่าเชื่อถือสนับสนุนว่าการใส่ยกทรงมีโครงเหล็กเป็นสาเหตุของมะเร็งเต้านม ปัจจัยเสี่ยงที่แท้จริงเกี่ยวข้องกับฮอร์โมน พันธุกรรม และวิถีชีวิตมากกว่า"
    },
    {
      avatar: "👪", name: "คุณนก (อายุ 46 ปี)",
      desc: "คิดว่า 'ไม่มีใครในครอบครัวเป็นมะเร็งเต้านมเลย ฉันจึงไม่มีทางเสี่ยง'",
      question: "ความคิดนี้ถูกต้องหรือไม่ เพราะเหตุใด?",
      options: ["ถูกต้องสมบูรณ์ ไม่มีประวัติครอบครัวเท่ากับไม่มีความเสี่ยงเลย", "ไม่ถูกต้อง เพราะผู้ป่วยมะเร็งเต้านมส่วนใหญ่กว่า 85% ไม่มีประวัติครอบครัวเลย"],
      correctIndex: 1,
      explanation: "ความจริงแล้วผู้ป่วยมะเร็งเต้านมส่วนใหญ่ (ประมาณ 85-90%) ไม่มีประวัติครอบครัวเป็นมะเร็งเลย ปัจจัยเสี่ยงส่วนใหญ่เกิดจากการสะสมของฮอร์โมน อายุ และวิถีชีวิต ดังนั้นทุกคนควรตรวจคัดกรองสม่ำเสมอไม่ว่าจะมีประวัติครอบครัวหรือไม่"
    },
    {
      avatar: "☢️", name: "คุณแอน (อายุ 41 ปี)",
      desc: "กลัวว่า 'รังสีจากการตรวจแมมโมแกรมจะทำให้เป็นมะเร็งเต้านมได้เอง' จึงไม่ยอมไปตรวจ",
      question: "ความกังวลนี้สมเหตุสมผลแค่ไหน เมื่อเทียบกับประโยชน์ของการตรวจคัดกรอง?",
      options: ["ปริมาณรังสีจากแมมโมแกรมต่ำมากและปลอดภัยสูง ประโยชน์จากการตรวจพบมะเร็งระยะเริ่มต้นมีมากกว่าความเสี่ยงจากรังสีอย่างมาก", "รังสีจากแมมโมแกรมอันตรายมากจนไม่ควรตรวจเลยตลอดชีวิต"],
      correctIndex: 0,
      explanation: "ปริมาณรังสีจากการตรวจแมมโมแกรมอยู่ในระดับต่ำมากและได้รับการควบคุมมาตรฐานความปลอดภัยอย่างเข้มงวด ประโยชน์จากการตรวจพบมะเร็งตั้งแต่ระยะเริ่มต้นมีมากกว่าความเสี่ยงเล็กน้อยจากรังสีอย่างมาก จึงไม่ควรหลีกเลี่ยงการตรวจคัดกรองด้วยเหตุผลนี้"
    }
  ],
  // Category 7: การดูแลรักษาและการใช้ชีวิต
  [
    {
      avatar: "🎗️", name: "คุณอุ๋ย (อายุ 44 ปี)",
      desc: "เพิ่งตรวจพบมะเร็งเต้านมระยะเริ่มต้น (ระยะที่ 1)",
      question: "การตรวจพบมะเร็งตั้งแต่ระยะเริ่มต้น ส่งผลต่อการรักษาอย่างไร?",
      options: ["โอกาสรักษาหายขาดสูงกว่าการตรวจพบในระยะลุกลาม", "ไม่ว่าจะตรวจพบระยะไหนก็รักษาผลลัพธ์เหมือนกันหมด"],
      correctIndex: 0,
      explanation: "การตรวจพบมะเร็งเต้านมตั้งแต่ระยะเริ่มต้นมีโอกาสรักษาหายขาดสูงกว่าการตรวจพบในระยะลุกลามอย่างมีนัยสำคัญ นี่คือเหตุผลสำคัญที่ควรตรวจคัดกรองสม่ำเสมอ"
    },
    {
      avatar: "💉", name: "คุณป้อม (อายุ 50 ปี)",
      desc: "ได้รับการวินิจฉัยมะเร็งเต้านม แพทย์อธิบายแผนการรักษาที่อาจรวมทั้งผ่าตัด เคมีบำบัด ฉายแสง และฮอร์โมนบำบัด",
      question: "การรักษามะเร็งเต้านมมักใช้วิธีเดียวหรือหลายวิธีร่วมกัน?",
      options: ["มักใช้เพียงวิธีเดียวเท่านั้นเสมอ", "มักใช้หลายวิธีร่วมกันขึ้นอยู่กับระยะและชนิดของมะเร็ง"],
      correctIndex: 1,
      explanation: "การรักษามะเร็งเต้านมมักเป็นการรักษาแบบสหสาขา (multidisciplinary) โดยผสมผสานวิธีต่างๆ เช่น ผ่าตัด เคมีบำบัด ฉายแสง และฮอร์โมนบำบัด ขึ้นอยู่กับระยะ ชนิด และลักษณะเฉพาะของมะเร็งแต่ละราย"
    },
    {
      avatar: "🤝", name: "คุณแหวว (อายุ 39 ปี)",
      desc: "รู้สึกเครียดและวิตกกังวลมากหลังทราบผลวินิจฉัยมะเร็งเต้านม",
      question: "การเข้าร่วมกลุ่มสนับสนุนหรือปรึกษาผู้เชี่ยวชาญด้านจิตใจ มีประโยชน์อย่างไรระหว่างการรักษา?",
      options: ["ไม่มีประโยชน์ใดๆ ควรพึ่งตัวเองเท่านั้น", "ช่วยลดความเครียด เพิ่มกำลังใจ และส่งผลดีต่อคุณภาพชีวิตระหว่างการรักษา"],
      correctIndex: 1,
      explanation: "การสนับสนุนด้านจิตใจ ไม่ว่าจะเป็นกลุ่มเพื่อนผู้ป่วย ครอบครัว หรือผู้เชี่ยวชาญ มีบทบาทสำคัญในการช่วยลดความเครียดและเพิ่มกำลังใจ ซึ่งส่งผลดีต่อคุณภาพชีวิตของผู้ป่วยระหว่างการรักษา"
    },
    {
      avatar: "📅", name: "คุณรวี (อายุ 46 ปี)",
      desc: "รักษามะเร็งเต้านมจนครบตามแผนแล้ว แพทย์นัดติดตามผลทุก 3-6 เดือน",
      question: "เหตุใดผู้ป่วยที่รักษาครบแล้วยังต้องติดตามผลอย่างต่อเนื่อง?",
      options: ["เพื่อเฝ้าระวังการกลับเป็นซ้ำและติดตามผลข้างเคียงระยะยาวจากการรักษา", "เพราะแพทย์ต้องการหารายได้เพิ่มเท่านั้น ไม่มีประโยชน์ทางการแพทย์"],
      correctIndex: 0,
      explanation: "การติดตามผลหลังการรักษาครบแล้ว มีความสำคัญมากในการเฝ้าระวังการกลับเป็นซ้ำของมะเร็ง และติดตามผลข้างเคียงระยะยาวที่อาจเกิดจากการรักษา เพื่อดูแลสุขภาพผู้ป่วยอย่างต่อเนื่อง"
    },
    {
      avatar: "🧪", name: "คุณเมษ์",
      desc: "ผลตรวจชิ้นเนื้อระบุว่ามะเร็งเป็นชนิด 'HER2-positive' ซึ่งต่างจากชนิด 'Hormone receptor-positive'",
      question: "เหตุใดการทราบชนิดตัวรับ (receptor) ของมะเร็งจึงสำคัญต่อการวางแผนรักษา?",
      options: ["ช่วยให้แพทย์เลือกวิธีรักษาที่จำเพาะเจาะจงกับชนิดของมะเร็ง เช่น ยาพุ่งเป้า ทำให้การรักษามีประสิทธิภาพมากขึ้น", "ชนิดตัวรับไม่มีผลต่อการเลือกวิธีรักษาใดๆ ทั้งสิ้น"],
      correctIndex: 0,
      explanation: "การตรวจชนิดตัวรับของมะเร็ง เช่น ฮอร์โมนตัวรับ (ER/PR) หรือ HER2 ช่วยให้แพทย์วางแผนการรักษาแบบจำเพาะเจาะจง (personalized medicine) เช่น การใช้ยาพุ่งเป้าหรือฮอร์โมนบำบัด ซึ่งช่วยเพิ่มประสิทธิภาพการรักษาและลดผลข้างเคียงที่ไม่จำเป็น"
    }
  ]
];

// Flatten into 40 levels, interleaving categories so consecutive levels vary
// in topic while difficulty rises every 8 levels (tier 0..4).
const LEVELS = [];
for (let tier = 0; tier < 5; tier++) {
  for (let cat = 0; cat < 8; cat++) {
    const content = RAW_CONTENT[cat][tier];
    const levelNum = tier * 8 + cat + 1;
    LEVELS.push({
      level: levelNum,
      category: CATEGORY_NAMES[cat],
      difficulty: DIFFICULTY_LABELS[tier],
      mascot: MASCOTS[cat].name,
      mascotColor: MASCOTS[cat].color,
      mascotHex: MASCOTS[cat].hex,
      avatar: content.avatar,
      name: content.name,
      desc: content.desc,
      question: content.question,
      options: content.options,
      correctIndex: content.correctIndex,
      explanation: content.explanation
    });
  }
}

// Public version (no answer key) sent to clients.
const LEVELS_PUBLIC = LEVELS.map((l) => ({
  level: l.level,
  category: l.category,
  difficulty: l.difficulty,
  mascot: l.mascot,
  mascotColor: l.mascotColor,
  mascotHex: l.mascotHex,
  avatar: l.avatar,
  name: l.name,
  desc: l.desc,
  question: l.question,
  options: l.options
}));

const AVATAR_POOL = [
  "🐱", "🐶", "🐰", "🦊", "🐼", "🐨", "🐯", "🦁", "🐸", "🐵",
  "🐷", "🐮", "🐔", "🐧", "🦄", "🐙", "🐢", "🦋", "🐝", "🦉",
  "🐬", "🦕", "🐿️", "🦩", "🐳", "🦔", "🐣", "🦜", "🐴", "🦖"
];

// ---------------------------------------------------------------------------
// In-memory room state
// ---------------------------------------------------------------------------
let rooms = {}; // roomId -> room state

function createRoom(roomId, isPublic, maxPlayers) {
  rooms[roomId] = {
    id: roomId,
    isPublic,
    maxPlayers,
    players: {},
    winners: [],
    gameEnded: false,
    avatarCursor: 0
  };
  return rooms[roomId];
}

function getPublicRoom() {
  let room = rooms[PUBLIC_ROOM_ID];
  // Auto-recycle a finished, now-empty public room so new players can start fresh.
  if (room && room.gameEnded && Object.keys(room.players).length === 0) {
    delete rooms[PUBLIC_ROOM_ID];
    room = null;
  }
  if (!room) {
    room = createRoom(PUBLIC_ROOM_ID, true, MAX_PUBLIC_PLAYERS);
  }
  return room;
}

function makePlayer(room, id, name) {
  const avatar = AVATAR_POOL[room.avatarCursor % AVATAR_POOL.length];
  room.avatarCursor++;
  return {
    id,
    name: name.slice(0, 20),
    avatar,
    position: 0,
    finished: false,
    finishRank: null,
    finishTime: null,
    penaltyUntil: 0
  };
}

function publicPlayerList(room) {
  return Object.values(room.players).map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    position: p.position,
    finished: p.finished,
    finishRank: p.finishRank,
    penaltyUntil: p.penaltyUntil
  }));
}

function broadcastState(room) {
  io.to(room.id).emit("stateUpdate", {
    players: publicPlayerList(room),
    winners: room.winners,
    gameEnded: room.gameEnded,
    playerCount: Object.keys(room.players).length,
    maxPlayers: room.maxPlayers,
    isPublic: room.isPublic
  });
  pushAdminSnapshot();
}

// ---------------------------------------------------------------------------
// Admin dashboard data — read-only snapshot of live rooms/players, pushed to
// the /admin Socket.IO namespace on every state change.
// ---------------------------------------------------------------------------
function buildAdminSnapshot() {
  const roomList = Object.values(rooms).map((r) => ({
    id: r.id,
    isPublic: r.isPublic,
    maxPlayers: r.maxPlayers,
    gameEnded: r.gameEnded,
    winners: r.winners,
    playerCount: Object.keys(r.players).length,
    players: publicPlayerList(r)
  }));

  const publicRoom = roomList.find((r) => r.isPublic) || null;
  const soloRooms = roomList.filter((r) => !r.isPublic);

  return {
    generatedAt: Date.now(),
    totalRooms: roomList.length,
    totalPlayers: roomList.reduce((sum, r) => sum + r.playerCount, 0),
    multiPlayers: publicRoom ? publicRoom.playerCount : 0,
    soloPlayers: soloRooms.reduce((sum, r) => sum + r.playerCount, 0),
    publicRoom,
    soloRooms
  };
}

const adminIo = io.of("/admin");
adminIo.use((socket, next) => {
  const token = parseCookies(socket.handshake.headers.cookie)[ADMIN_COOKIE];
  if (token && adminSessions.has(token)) return next();
  next(new Error("unauthorized"));
});
adminIo.on("connection", (socket) => {
  socket.emit("snapshot", buildAdminSnapshot());
});

function pushAdminSnapshot() {
  adminIo.emit("snapshot", buildAdminSnapshot());
}

function checkGameOverConditions(room) {
  if (room.gameEnded) return;

  const allPlayers = Object.values(room.players);
  const totalPlayers = allPlayers.length;
  const allFinished = totalPlayers > 0 && allPlayers.every((p) => p.finished);

  if (room.winners.length >= MAX_WINNERS || allFinished) {
    room.gameEnded = true;
    io.to(room.id).emit("gameOver", {
      hallOfFame: room.winners,
      isSolo: !room.isPublic,
      mascotsRecap: MASCOTS.map((m, i) => ({ mascot: m.name, color: m.color, hex: m.hex, category: CATEGORY_NAMES[i] })),
      message:
        "ขอบคุณทุกคนที่ร่วมเล่นเกมนี้! อย่าลืมนะคะ การตรวจเต้านมด้วยตนเองเป็นประจำ และพบแพทย์เพื่อตรวจคัดกรอง คือกุญแจสำคัญของการต่อกรกับมะเร็งเต้านมตั้งแต่ระยะเริ่มต้น 🎗️💗"
    });
  }
}

function resetRoom(room) {
  room.players = {};
  room.winners = [];
  room.gameEnded = false;
  room.avatarCursor = 0;
  io.to(room.id).emit("gameReset");
  broadcastState(room);
}

// ---------------------------------------------------------------------------
// Socket.IO handlers
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  socket.on("join", ({ name, mode }) => {
    let room;

    if (mode === "solo") {
      const roomId = "solo-" + socket.id;
      room = createRoom(roomId, false, 1);
    } else {
      room = getPublicRoom();
      if (room.gameEnded) {
        socket.emit(
          "joinError",
          "รอบนี้จบไปแล้ว กรุณารอให้มีผู้เล่นกดเริ่มรอบใหม่ หรือเลือกเล่นโหมดคนเดียวไปก่อน"
        );
        return;
      }
      if (Object.keys(room.players).length >= room.maxPlayers) {
        socket.emit(
          "joinError",
          "ห้องเต็มแล้ว (สูงสุด 20 คน) กรุณาลองใหม่ภายหลัง หรือเลือกเล่นโหมดคนเดียว"
        );
        return;
      }
    }

    const cleanName = (name || "ผู้เล่นนิรนาม").toString().trim() || "ผู้เล่นนิรนาม";
    const player = makePlayer(room, socket.id, cleanName);
    room.players[socket.id] = player;

    socket.join(room.id);
    socket.data.roomId = room.id;

    socket.emit("joined", {
      self: player,
      levels: LEVELS_PUBLIC,
      currentQuestion: LEVELS_PUBLIC[0],
      totalLevels: TOTAL_LEVELS,
      mode: room.isPublic ? "multi" : "solo",
      maxPlayers: room.maxPlayers
    });

    broadcastState(room);
  });

  socket.on("submitAnswer", ({ answerIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const player = room.players[socket.id];
    if (!player || player.finished || room.gameEnded) return;

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

        if (room.winners.length < MAX_WINNERS) {
          player.finishRank = room.winners.length + 1;
          room.winners.push({
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
        mascotColor: level.mascotColor,
        player,
        nextQuestion: nextLevel,
        finished: justFinished
      });

      if (justFinished) {
        io.to(room.id).emit("playerFinished", {
          name: player.name,
          avatar: player.avatar,
          rank: player.finishRank
        });
      }

      broadcastState(room);
      checkGameOverConditions(room);
    } else {
      player.penaltyUntil = Date.now() + PENALTY_MS;
      socket.emit("answerResult", {
        correct: false,
        explanation: level.explanation,
        mascot: level.mascot,
        mascotColor: level.mascotColor,
        penaltyUntil: player.penaltyUntil,
        penaltyMs: PENALTY_MS
      });
      broadcastState(room);
    }
  });

  socket.on("restartGame", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    resetRoom(rooms[roomId]);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    delete room.players[socket.id];

    if (!room.isPublic && Object.keys(room.players).length === 0) {
      delete rooms[roomId];
      pushAdminSnapshot();
      return;
    }

    broadcastState(room);
    checkGameOverConditions(room);
  });
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------
app.get("/admin", (req, res) => {
  // Magic-link access: visiting /admin?key=<ADMIN_PASSWORD> logs you in
  // instantly (sets the same session cookie the password form would),
  // so the link itself can be bookmarked/shared instead of typing a password.
  const key = req.query.key;
  if (key && key === ADMIN_PASSWORD && !isAdminAuthed(req)) {
    const token = crypto.randomBytes(24).toString("hex");
    adminSessions.add(token);
    res.setHeader(
      "Set-Cookie",
      `${ADMIN_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`
    );
  }
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.post("/admin/api/login", (req, res) => {
  const password = (req.body && req.body.password) || "";
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "รหัสผ่านไม่ถูกต้อง" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.add(token);
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`
  );
  res.json({ ok: true });
});

app.post("/admin/api/logout", (req, res) => {
  const token = adminTokenFrom(req);
  if (token) adminSessions.delete(token);
  res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/admin/api/session", (req, res) => {
  res.json({ authenticated: isAdminAuthed(req) });
});

app.get("/admin/api/levels", requireAdmin, (req, res) => {
  res.json({ totalLevels: TOTAL_LEVELS, categories: CATEGORY_NAMES, levels: LEVELS });
});

app.get("/admin/api/snapshot", requireAdmin, (req, res) => {
  res.json(buildAdminSnapshot());
});

server.listen(PORT, () => {
  console.log(`🎗️  รู้มั้ย ใครเสี่ยงมะเร็งเต้านม (40 levels) running on http://localhost:${PORT}`);
});
