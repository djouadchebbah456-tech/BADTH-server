# بثّ — TikTok LIVE Overlay Server

سيرفر يتصل ببث TikTok LIVE لأي يوزر، ويستقبل الهدايا/المتابعات/اللايكات/المشاركات
لحظياً، ويرسلها لصفحة Overlay شفافة تُستخدم في OBS كـ **Browser Source** أثناء
البث على TikTok Studio.

---

## 1. الملفات

```
badth-server/
├── server.js          ← السيرفر (Node.js + WebSocket)
├── package.json
└── public/
    └── overlay.html    ← الصفحة التي تضعها في OBS
    └── effects/        ← ضع ملفات فيديو المؤثرات هنا (تنشئها أنت)
```

---

## 2. النشر المجاني على Render

1. أنشئ حساب على [render.com](https://render.com) (مجاني)
2. ارفع هذا المجلد إلى مستودع GitHub جديد
3. في Render: **New → Web Service** → اختر المستودع
4. الإعدادات:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. بعد النشر، ستحصل على رابط مثل:
   ```
   https://badth-server.onrender.com
   ```
   ورابط الـ WebSocket هو نفسه لكن بـ `wss://` بدل `https://`

> ⚠️ الخطة المجانية في Render "تنام" بعد عدم الاستخدام وتحتاج ثوانٍ
> لإعادة التشغيل عند أول اتصال. هذا مقبول للتجربة، لكن للاستخدام
> الجاد يُفضّل خطة مدفوعة صغيرة ($7/شهر) لضمان عدم انقطاع الاتصال
> أثناء البث المباشر.

---

## 3. رابط الـ Overlay لكل مستخدم (مستخدمك في منصتك)

كل مستخدم في منصتك يحصل على رابط فريد بإضافة username التيكتوك الخاص به:

```
https://badth-server.onrender.com/overlay.html?server=wss://badth-server.onrender.com&user=USERNAME_TIKTOK
```

هذا الرابط يُلصق في OBS كـ **Browser Source**:
- العرض: 1080 × 1920 (أو حسب دقتك)
- ✅ فعّل "Transparent background"

---

## 4. رفع مؤثراتك (الفيديوهات)

ضع ملفات الفيديو (mp4/webm بخلفية شفافة أو ألفا) داخل:
```
public/effects/
```

ثم عدّل الخريطة في `overlay.html` (داخل `EFFECT_MAP`) لتربط كل هدية
باسم الملف المناسب:

```js
gifts: {
  'rose':   'effects/rose-storm.mp4',
  'lion':   'effects/lion-roar.mp4',
  ...
}
```

> أسماء الهدايا (giftName) تأتي من TikTok بالإنجليزية مثل
> "Rose"، "Lion"، "Galaxy"، "TikTok Universe" — استخدمها بحروف صغيرة
> في `EFFECT_MAP`.

---

## 5. التشغيل محلياً (للتجربة قبل النشر)

```bash
cd badth-server
npm install
npm start
```

السيرفر يعمل على `http://localhost:3000`
الـ Overlay:
```
http://localhost:3000/overlay.html?server=ws://localhost:3000&user=USERNAME_TIKTOK
```

---

## 6. ملاحظات مهمة

- **يجب أن يكون المستخدم على الهواء (Live)** ليستقبل السيرفر أي أحداث.
- الاتصال يستخدم مكتبة `tiktok-live-connector` المفتوحة المصدر — لا يحتاج
  مفاتيح API، لكنه غير رسمي وقد يحتاج تحديثات إذا غيّرت TikTok نظامها الداخلي.
- سيرفر واحد يمكنه خدمة عدة مستخدمين (غرف) في نفس الوقت تلقائياً.
- الغرفة تُغلق تلقائياً بعد دقيقة من عدم وجود أي Overlay متصل بها، لتوفير الموارد.

---

## 7. الخطوات التالية لمنصتك

- [ ] صفحة تسجيل دخول + ربط حساب TikTok لكل مستخدم
- [ ] لوحة تحكم لرفع/اختيار المؤثرات وربطها بالأحداث (بدون كود)
- [ ] نظام اشتراكات (USDT) يفعّل/يعطّل الوصول حسب الخطة
- [ ] تخزين خرائط `EFFECT_MAP` لكل مستخدم في قاعدة بيانات بدل تعديل الكود
