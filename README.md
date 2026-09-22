# الأعمال التطبيقية — Virtual & Remote Labs
### TP Virtuels & à Distance

منصة ويب لإنجاز الأعمال التطبيقية عبر **مسار إجباري من 3 مراحل**، والقفل يُفرض في **الخادم** (لا يمكن تجاوزه بتعديل الواجهة):

| المرحلة | الشرط | ما يحدث |
|---|---|---|
| 1. التجربة الافتراضية | — | محاكاة تفاعلية بخطوات متسلسلة، حفظ تلقائي، تقرير PDF مع المنحنيات. يجب بلوغ **100%** |
| 2. الكويز | المرحلة 1 = 100% | أسئلة MCQ / صح-خطأ / رقمي بتسامح / ملء فراغ، خلط، مؤقّت، محاولات محدودة، مهلة بين المحاولات، التصحيح بعد المحاولة الأخيرة فقط |
| 3. الجهاز الحقيقي عن بُعد | نتيجة الكويز ≥ العتبة (يحدّدها الأستاذ، الافتراضي 70%) | حجز موعد/طابور، جهاز واحد وطالب واحد، فيديو مباشر، قياسات لحظية، حدود أمان، إيقاف طارئ، سجل تدقيق |

الأدوار: **طالب / أستاذ / مدير**. الواجهة **فرنسية افتراضياً** مع تبديل إلى **العربية (RTL)** من الأعلى، ومتجاوبة مع الهاتف.

---

## 1) التثبيت والتشغيل (5 دقائق)

المتطلبات: Node.js ≥ 20، Docker (لقاعدة البيانات و MQTT) أو PostgreSQL و Mosquitto مثبّتين.

```bash
# 1) البنية التحتية: PostgreSQL + Mosquitto
docker compose up -d

# 2) الخادم (API + WebSocket) على المنفذ 4000
cd backend
cp .env.example .env            # عدّل JWT_SECRET
npm install
npm run setup                   # = prisma generate + prisma db push + بيانات تجريبية (seed)
npm run dev

# 3) الواجهة على المنفذ 3000 (في طرفية أخرى)
cd frontend
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev
```

افتح <http://localhost:3000>.

> ملاحظة: `prisma db push` ينشئ الجداول مباشرة. للإنتاج استعمل `npx prisma migrate dev --name init` ثم `npx prisma migrate deploy` لتحصل على ملفات ترحيل (migrations) قابلة للتتبع.

### الحسابات التجريبية

| الدور | البريد | كلمة المرور |
|---|---|---|
| مدير | admin@labs.test | Admin123! |
| أستاذ | prof@labs.test | Prof123! |
| طالب 1 | student1@labs.test | Student123! |
| طالب 2 (المرحلة 3 مفتوحة في تجربة أوم) | student2@labs.test | Student123! |

البيانات التجريبية: 3 تجارب (قانون أوم، شحن مكثف RC، مميزة الثنائي)، 6 أسئلة لكل تجربة بالفرنسية والعربية، فصل واحد، وجهاز وهمي واحد (`bench-mock`).

### الإنتاج

```bash
cd backend  && npm run build && NODE_ENV=production npm start   # يتطلب JWT_SECRET قوي
cd frontend && npm run build && npm start
```

---

## 2) البنية

```
virtual-labs/
├─ docker-compose.yml          PostgreSQL + Mosquitto
├─ mosquitto/mosquitto.conf
├─ hardware/bench_agent.py     وكيل الجهاز الحقيقي (Raspberry Pi/PC) عبر MQTT
├─ backend/                    Express + Socket.io + Prisma + MQTT
│  ├─ prisma/schema.prisma     14 جدولاً (User, Lab, Question, Progress, QuizAttempt, Device, Booking, ...)
│  ├─ prisma/seed.ts           البيانات التجريبية
│  ├─ src/labs/                محرّك التجارب (JSON) + مقيّم المعادلات الآمن + قفل المراحل (stages.ts)
│  ├─ src/quiz/                التصحيح والخدمة (محاولات، مؤقّت، مهلة)
│  ├─ src/remote/              الأجهزة (mock/MQTT)، الحجز والطابور، الأمان، بوابة Socket.io
│  ├─ src/reports/pdf.ts       تقارير PDF (عربي/فرنسي + منحنيات متجهية)
│  ├─ src/routes/              REST: auth, labs, simulation, quiz, remote, teacher, admin, misc
│  └─ scripts/                 e2e.ts (103 فحصاً)، mqtt-test.ts، mqtt-agent-test.ts
└─ frontend/                   Next.js (App Router) + TypeScript + Tailwind
   └─ src/{app,components,i18n,lib}
```

### كيف يُفرض القفل (Backend)

- `src/labs/stages.ts` يحتوي `assertStage2Open` و`assertStage3Open`؛ كل مسار حساس (بدء الكويز، الحجز، الانضمام للطابور، **وكل حدث Socket.io**: `session:join`, `device:command`, `device:record`) يعيد التحقق منها.
- المرحلة 1 لا تكتمل إلا بإتمام الخطوات **بالترتيب** في الخادم؛ النقاط المقاسة تُقارَن بالنموذج الفيزيائي (تُرفض القيم المزوَّرة)، وجواب الحساب يُقارَن بتقدير الخادم من نقاط الطالب نفسه.
- المرحلة 3 تُفتح فقط حين يتحقق `bestPercent ≥ Lab.passThreshold`؛ ويمكن للأستاذ تغيير العتبة لكل تجربة.
- قيم قياس الجهاز الحقيقي تُسجَّل **من الخادم** (آخر قياس فعلي) وليس من العميل.

### تعريف تجربة جديدة (JSON)
يستطيع الأستاذ إنشاء/تعديل تجربة من واجهة **Mes TP ← Définition du TP**: المحاكي (`ohm|rc|diode|generic`)، المقادير، الثوابت، المعادلات، المخرجات، والخطوات (`read | setup | measure | compute | report`) وإعداد الجهاز الحقيقي `remote`. زر «Valider» يتحقق من المخطط قبل الحفظ. يُنصح بالبدء بنسخ تعريف تجربة موجودة.

---

## 3) الجهاز الحقيقي (MQTT)

الجهاز التجريبي `bench-mock` (نوع MOCK) يحاكي فيزيائياً المقاومات و RC والثنائي دون أي عتاد. لربط جهاز حقيقي:

1. في **Appareils** أضف جهازاً بنوع `MQTT` وحقل `topic` (مثلاً `bench-01`) وحدود الأمان، واختياريّاً رابط `videoUrl` (بث MJPEG).
2. شغّل الوكيل على الجهاز (Raspberry Pi أو غيره):
   ```bash
   pip install paho-mqtt
   python3 hardware/bench_agent.py --host <عنوان_الوسيط> --topic bench-01            # عتاد محاكى للاختبار
   ```
   ثم عدّل الصنف `RaspberryPiHardware` ليستعمل الـ DAC/ADC/المرحلات لديك.
3. المواضيع: `labs/<topic>/cmd` (خادم→جهاز)، `labs/<topic>/telemetry` (جهاز→خادم، ~10Hz)، `labs/<topic>/status` (`online` + Last-Will `offline`).
4. الفيديو: مثلاً `mjpg-streamer` أو `libcamera-vid` على الجهاز؛ ضع رابط البث في `videoUrl`. الخادم يمرّر البث عبر رمز قصير الأمد مرتبط بالحصة، فلا يُكشف رابط الجهاز.

### الأمان
- كل أمر يمرّ عبر `safety.ts` (مجالات، حمل مسموح، تحديد معدل 8 أوامر/ث، قفل الإيقاف الطارئ حتى `reset`) ثم يُسجَّل في `CommandLog`.
- الوكيل يطبّق حدوده المحلية أيضاً ويدخل حالة آمنة عند فقدان الاتصال. **أضف دائماً حماية عتادية مستقلة** (فيوز، تحديد تيار في المزوّد).
- في الإنتاج: عطّل `allow_anonymous` في Mosquitto، استعمل كلمات مرور/ACL و TLS، وضع الخادم خلف HTTPS، وغيّر `JWT_SECRET`.

---

## 4) الاختبارات

```bash
cd backend
npm run typecheck
npm run test:e2e        # يتطلب الخادم يعمل على :4000 وقاعدة بيانات مُهيّأة بـ seed جديد (103 فحصاً)
npm run test:mqtt       # وكيل Python الحقيقي ↔ سائق MQTT عبر وسيط مدمج
cd ../frontend
npm run typecheck && npm run build
node scripts/check-i18n.mjs     # مفاتيح الفرنسية والعربية متطابقة وكل مفتاح مستعمل معرَّف
```

---

## 5) حدود معروفة (صراحةً)

- **WebRTC غير منفَّذ**: الفيديو عبر MJPEG (وكاميرا محاكاة للجهاز الوهمي).
- **الجهاز الحقيقي والفيديو الحقيقي لم يُختبرا** على عتاد فعلي؛ اختُبر تكامل MQTT ووكيل Python مع عتاد محاكى ووسيط مدمج.
- الإيميلات في وضع «dry-run» (تُكتب في السجل) ما لم تضبط SMTP.
- التجارب الثلاث تستعمل محاكيات مخصّصة (أوم، RC، ثنائي)؛ المحاكي `generic` يعتمد على المعادلات النصّية فقط.
- بُني الاختبار مقابل PostgreSQL محلي؛ لم تُنشأ ملفات ترحيل Prisma (استعمل `db push` أو ولّدها كما في الأعلى).
