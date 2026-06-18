// ============================================================
// سيرفر ربط هدايا TikTok Live بالمؤثرات البصرية
// ============================================================
// هذا السيرفر يقوم بثلاث مهام:
// 1. الاتصال ببث TikTok Live لستريمر معيّن والاستماع لأحداث الهدايا
// 2. عند وصول هدية، البحث عن المؤثر المرتبط بها (mapping)
// 3. إرسال أمر "تشغيل" لصفحة Browser Source المعنية عبر WebSocket
// ============================================================

const express = require("express");
const path = require("path");
const fs = require("fs");
const { WebcastPushConnection } = require("tiktok-live-connector");
const { WebSocketServer } = require("ws");
const http = require("http");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

// ------------------------------------------------------------
// إعداد WebSocket: صفحات Browser Source (overlays) تتصل هنا
// لتستقبل أوامر التشغيل في الزمن الحقيقي
// ------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws" });
const connectedOverlays = new Set();

wss.on("connection", (ws) => {
  connectedOverlays.add(ws);
  console.log(`[WebSocket] صفحة مؤثر جديدة اتصلت. العدد الحالي: ${connectedOverlays.size}`);

  ws.on("close", () => {
    connectedOverlays.delete(ws);
    console.log(`[WebSocket] صفحة مؤثر انقطعت. العدد الحالي: ${connectedOverlays.size}`);
  });
});

// إرسال أمر تشغيل مؤثر لكل الصفحات المتصلة (سنحسّنها لاحقًا لإرسال للستريمر المعني فقط)
function broadcastOverlayTrigger(overlayId, giftInfo) {
  const payload = JSON.stringify({
    type: "TRIGGER_OVERLAY",
    overlayId,
    gift: giftInfo,
    timestamp: Date.now(),
  });

  connectedOverlays.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

// ------------------------------------------------------------
// قائمة المؤثرات المتاحة فعليًا (الملفات الحقيقية الموجودة في public/)
// عند إضافة مؤثر جديد، أضفه هنا حتى يظهر في لوحة التحكم
// ------------------------------------------------------------
const AVAILABLE_OVERLAYS = [
  { id: "ov1", name: "قلب ذهبي متفتت", file: "overlay-golden-heart.html" },
  { id: "ov_rose", name: "وردة متطايرة", file: "overlay-rose.html" },
];

// ------------------------------------------------------------
// قائمة هدايا TikTok الشائعة (يدوية مؤقتًا، بانتظار سحبها من API لاحقًا)
// ------------------------------------------------------------
const KNOWN_GIFTS = [
  { giftId: 5655, name: "وردة" },
  { giftId: 5827, name: "تاج" },
  { giftId: 6064, name: "إصبع النار" },
  { giftId: 5269, name: "نجمة لامعة" },
];

// ------------------------------------------------------------
// جدول ربط الهدايا بالمؤثرات — محفوظ بملف JSON حتى يبقى بعد إعادة تشغيل السيرفر
// المفتاح: giftId الرسمي من TikTok | القيمة: overlayId
// ------------------------------------------------------------
const MAPPING_FILE = path.join(__dirname, "gift-mapping.json");

function loadMapping() {
  try {
    const raw = fs.readFileSync(MAPPING_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    // أول تشغيل أو الملف غير موجود: نبدأ بربط افتراضي واحد فقط
    return { "5655": "ov1" };
  }
}

function saveMapping(mapping) {
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2), "utf-8");
}

let giftToOverlayMap = loadMapping();

// ------------------------------------------------------------
// متغيرات حالة الاتصال ببث TikTok
// ------------------------------------------------------------
let tiktokConnection = null;
let currentUsername = null;

function connectToTikTok(username) {
  if (tiktokConnection) {
    tiktokConnection.disconnect();
  }

  currentUsername = username;
  tiktokConnection = new WebcastPushConnection(username);

  tiktokConnection
    .connect()
    .then((state) => {
      console.log(`✅ تم الاتصال ببث: ${username} | Room ID: ${state.roomId}`);
    })
    .catch((err) => {
      console.error(`❌ فشل الاتصال ببث ${username}:`, err.message);
    });

  // أهم حدث: استلام هدية
  tiktokConnection.on("gift", (data) => {
    console.log("------------------------------------------------");
    console.log(`🎁 هدية واردة من: ${data.uniqueId}`);
    console.log(`   اسم الهدية: ${data.giftName}`);
    console.log(`   giftId: ${data.giftId}`);
    console.log(`   العدد: ${data.repeatCount}`);
    console.log("------------------------------------------------");

    // إذا كانت الهدية مكررة (combo) وما خلصت بعد، تجاهلها لتجنب التكرار
    if (data.giftType === 1 && !data.repeatEnd) {
      return;
    }

    const overlayId = giftToOverlayMap[String(data.giftId)];

    if (overlayId) {
      console.log(`   ↳ مرتبطة بمؤثر: ${overlayId} — يتم الإرسال الآن`);
      broadcastOverlayTrigger(overlayId, {
        giftName: data.giftName,
        sender: data.uniqueId,
        repeatCount: data.repeatCount,
      });
    } else {
      console.log(`   ↳ لا يوجد مؤثر مرتبط بهذه الهدية (giftId: ${data.giftId})`);
    }
  });

  tiktokConnection.on("disconnected", () => {
    console.log("⚠️ انقطع الاتصال ببث TikTok");
  });

  tiktokConnection.on("streamEnd", () => {
    console.log("⏹️ البث انتهى");
  });
}

// ------------------------------------------------------------
// REST API بسيط للتحكم بالسيرفر من الخارج
// ------------------------------------------------------------

// بدء الاتصال ببث ستريمر معيّن
app.post("/api/connect", (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "يجب إرسال username" });
  }
  connectToTikTok(username);
  res.json({ status: "محاولة الاتصال بدأت", username });
});

// التحقق من حالة الاتصال الحالي
app.get("/api/status", (req, res) => {
  res.json({
    connected: !!tiktokConnection,
    username: currentUsername,
    overlaysConnected: connectedOverlays.size,
  });
});

// ------------------------------------------------------------
// Endpoints لخدمة لوحة التحكم (الواجهة)
// ------------------------------------------------------------

// قائمة كل المؤثرات المتاحة فعليًا
app.get("/api/overlays", (req, res) => {
  res.json(AVAILABLE_OVERLAYS);
});

// قائمة الهدايا المعروفة
app.get("/api/gifts", (req, res) => {
  res.json(KNOWN_GIFTS);
});

// قراءة جدول الربط الحالي بالكامل
app.get("/api/mapping", (req, res) => {
  res.json(giftToOverlayMap);
});

// تحديث ربط هدية معيّنة بمؤثر معيّن (أو حذف الربط بإرسال overlayId = null)
app.post("/api/mapping", (req, res) => {
  const { giftId, overlayId } = req.body;
  if (!giftId) {
    return res.status(400).json({ error: "يجب إرسال giftId" });
  }

  if (overlayId === null) {
    delete giftToOverlayMap[String(giftId)];
  } else {
    giftToOverlayMap[String(giftId)] = overlayId;
  }

  saveMapping(giftToOverlayMap);
  res.json({ status: "تم التحديث", mapping: giftToOverlayMap });
});

// تشغيل تجريبي يدوي لمؤثر معيّن (لزر "▷ تجربة" في الواجهة)
app.post("/api/trigger", (req, res) => {
  const { overlayId } = req.body;
  if (!overlayId) {
    return res.status(400).json({ error: "يجب إرسال overlayId" });
  }

  broadcastOverlayTrigger(overlayId, { giftName: "تجربة يدوية", sender: "لوحة التحكم", repeatCount: 1 });
  res.json({ status: "تم إرسال أمر التشغيل", overlayId });
});

// ملاحظة: الصفحة الرئيسية "/" تُخدَّم تلقائيًا من public/index.html
// (لوحة التحكم الحقيقية)، بفضل app.use(express.static(...)) في الأعلى

// ------------------------------------------------------------
// تشغيل السيرفر
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
