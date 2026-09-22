// بيانات الـ TP الثلاثة: تعريف المحاكاة (JSON) + بنك أسئلة الكويز — ثنائي اللغة (FR/AR)
import type { LabDefinition } from "../src/labs/definition";

type L = { ar: string; fr: string };
const l = (fr: string, ar: string): L => ({ fr, ar });

// ============================================================================
//  TP 1 — قانون أوم
// ============================================================================
export const ohm: LabDefinition = {
  version: 1,
  simulator: "ohm",
  parameters: [
    { key: "U", label: l("Tension U", "التوتر U"), unit: "V", min: 0, max: 12, step: 0.5, default: 0 },
    { key: "R", label: l("Résistance R", "المقاومة R"), unit: "Ω", min: 100, max: 470, step: 1, default: 100, options: [100, 220, 470] },
  ],
  constants: {},
  equations: [
    { name: "I", expr: "1000*U/R" },
    { name: "P", expr: "1000*U*U/R" },
  ],
  outputs: [
    { key: "I", label: l("Courant I", "التيار I"), unit: "mA", decimals: 2 },
    { key: "P", label: l("Puissance P", "الاستطاعة P"), unit: "mW", decimals: 1 },
  ],
  noise: 0.01,
  plot: { x: "U", y: "I", xLabel: l("U (V)", "U (V)"), yLabel: l("I (mA)", "I (mA)") },
  steps: [
    {
      id: "intro",
      type: "read",
      title: l("Objectif et matériel", "الهدف والعتاد"),
      body: l(
        "Vérifier la loi d'Ohm U = R·I sur une résistance : on fait varier la tension U d'un générateur, on mesure le courant I avec un ampèremètre (en série) et la tension avec un voltmètre (en dérivation), puis on trace U = f(I).",
        "التحقق من قانون أوم U = R·I على مقاومة: نغيّر توتر المولّد U ونقيس التيار I بأمبيرمتر (على التوالي) والتوتر بفولطمتر (على التوازي)، ثم نرسم المنحنى.",
      ),
    },
    {
      id: "setup",
      type: "setup",
      title: l("Montage : choisir R = 220 Ω", "التركيب: اختيار R = 220 Ω"),
      body: l("Sélectionnez la résistance de 220 Ω dans le montage, puis validez.", "اختر المقاومة 220 Ω في الدارة ثم أكّد."),
      require: { R: 220 },
    },
    {
      id: "measure",
      type: "measure",
      title: l("Mesures U / I", "قياسات U / I"),
      body: l(
        "Faites varier U de 0 à 12 V et enregistrez au moins 6 points de mesure (valeurs de U différentes).",
        "غيّر U من 0 إلى 12 فولت وسجّل 6 نقاط قياس على الأقل (قيم مختلفة لـ U).",
      ),
      minPoints: 6,
      lock: ["R"],
      xParam: "U",
    },
    {
      id: "compute-r",
      type: "compute",
      title: l("Détermination de R", "تحديد قيمة R"),
      body: l(
        "La courbe I = f(U) est une droite passant par l'origine. Calculez R à partir de sa pente (R = 1/pente) et saisissez la valeur en Ω.",
        "المنحنى I = f(U) مستقيم يمر من الأصل. احسب R من ميله (R = 1/الميل) وأدخل القيمة بالأوم.",
      ),
      quantity: l("Résistance R", "المقاومة R"),
      unit: "Ω",
      tolerancePct: 8,
      estimator: { kind: "slope", x: "U", y: "I", invert: true, factor: 1000 },
    },
    {
      id: "report",
      type: "report",
      title: l("Rapport de TP", "تقرير التجربة"),
      body: l("Générez le rapport PDF (mesures, courbe, résultats). Cette étape termine le TP virtuel et débloque le quiz.", "ولّد تقرير PDF (القياسات، المنحنى، النتائج). هذه الخطوة تنهي التجربة الافتراضية وتفتح الكويز."),
    },
  ],
  remote: {
    load: "R220",
    minPoints: 6,
    plot: { x: "vLoad", y: "current", xLabel: l("U (V)", "U (V)"), yLabel: l("I (mA)", "I (mA)") },
    voltageMax: 12,
    instructions: l(
      "Sur le banc réel : sélectionnez la charge R220, activez la sortie, augmentez la tension par paliers de 0 à 12 V et enregistrez au moins 6 points.",
      "على الجهاز الحقيقي: اختر الحمل R220، فعّل الخرج، ارفع الجهد تدريجياً من 0 إلى 12 فولت وسجّل 6 نقاط على الأقل.",
    ),
  },
};

// ============================================================================
//  TP 2 — شحن مكثف (دارة RC)
// ============================================================================
export const rc: LabDefinition = {
  version: 1,
  simulator: "rc",
  parameters: [
    { key: "E", label: l("Force électromotrice E", "القوة المحركة E"), unit: "V", min: 5, max: 12, step: 1, default: 5, options: [5, 10, 12] },
    { key: "R", label: l("Résistance R", "المقاومة R"), unit: "kΩ", min: 1, max: 10, step: 0.1, default: 1, options: [1, 2.2, 4.7, 10] },
    { key: "C", label: l("Capacité C", "السعة C"), unit: "µF", min: 100, max: 470, step: 1, default: 100, options: [100, 220, 470] },
    { key: "t", label: l("Temps t", "الزمن t"), unit: "s", min: 0, max: 30, step: 0.1, default: 0 },
  ],
  constants: {},
  equations: [
    { name: "tau", expr: "R*C/1000" },
    { name: "Uc", expr: "E*(1-exp(-t/tau))" },
    { name: "i", expr: "E/R*exp(-t/tau)" },
  ],
  outputs: [
    { key: "Uc", label: l("Tension Uc", "التوتر Uc"), unit: "V", decimals: 3 },
    { key: "i", label: l("Courant i", "التيار i"), unit: "mA", decimals: 3 },
  ],
  noise: 0.005,
  plot: { x: "t", y: "Uc", xLabel: l("t (s)", "t (s)"), yLabel: l("Uc (V)", "Uc (V)") },
  steps: [
    {
      id: "intro",
      type: "read",
      title: l("Objectif", "الهدف"),
      body: l(
        "Étudier la charge d'un condensateur à travers une résistance : Uc(t) = E(1 − e^(−t/τ)) avec τ = R·C. On relève Uc à différents instants pour déterminer τ.",
        "دراسة شحن مكثف عبر مقاومة: Uc(t) = E(1 − e^(−t/τ)) مع τ = R·C. نقيس Uc في لحظات مختلفة لتحديد τ.",
      ),
    },
    {
      id: "setup",
      type: "setup",
      title: l("Montage : E = 10 V, R = 4,7 kΩ, C = 470 µF", "التركيب: E = 10 V، R = 4.7 kΩ، C = 470 µF"),
      body: l("Réglez les composants comme indiqué puis validez.", "اضبط المكوّنات كما هو مذكور ثم أكّد."),
      require: { E: 10, R: 4.7, C: 470 },
    },
    {
      id: "measure",
      type: "measure",
      title: l("Relevé de Uc(t)", "قياس Uc(t)"),
      body: l(
        "Lancez la charge, puis enregistrez Uc à au moins 8 instants différents (de préférence entre 0,5 s et 6 s).",
        "شغّل الشحن ثم سجّل Uc عند 8 لحظات مختلفة على الأقل (يفضّل بين 0.5 و6 ثوانٍ).",
      ),
      minPoints: 8,
      lock: ["E", "R", "C"],
      xParam: "t",
    },
    {
      id: "compute-tau",
      type: "compute",
      title: l("Détermination de τ", "تحديد ثابت الزمن τ"),
      body: l(
        "Déterminez la constante de temps τ (temps pour atteindre 63 % de E, ou pente de ln(1 − Uc/E) = −t/τ) et saisissez-la en secondes.",
        "حدّد ثابت الزمن τ (الزمن اللازم لبلوغ 63% من E، أو ميل ln(1 − Uc/E) = −t/τ) وأدخله بالثواني.",
      ),
      quantity: l("Constante de temps τ", "ثابت الزمن τ"),
      unit: "s",
      tolerancePct: 15,
      estimator: { kind: "rc_tau", x: "t", y: "Uc", e: "E" },
    },
    {
      id: "report",
      type: "report",
      title: l("Rapport de TP", "تقرير التجربة"),
      body: l("Générez le rapport PDF pour terminer le TP virtuel.", "ولّد تقرير PDF لإنهاء التجربة الافتراضية."),
    },
  ],
  remote: {
    load: "RC",
    minPoints: 8,
    plot: { x: "tSwitch", y: "vLoad", xLabel: l("t (s)", "t (s)"), yLabel: l("Uc (V)", "Uc (V)") },
    voltageMax: 12,
    instructions: l(
      "Sur le banc réel : sélectionnez la charge RC (R = 4,7 kΩ, C = 470 µF), réglez 10 V, puis basculez l'interrupteur sur ON et enregistrez Uc à au moins 8 instants pendant la charge.",
      "على الجهاز الحقيقي: اختر الحمل RC (R = 4.7 kΩ، C = 470 µF)، اضبط 10 فولت ثم شغّل المفتاح ON وسجّل Uc عند 8 لحظات على الأقل أثناء الشحن.",
    ),
  },
};

// ============================================================================
//  TP 3 — مميّزة الثنائي
// ============================================================================
export const diode: LabDefinition = {
  version: 1,
  simulator: "diode",
  parameters: [{ key: "Vd", label: l("Tension diode Vd", "توتر الثنائي Vd"), unit: "V", min: 0, max: 0.8, step: 0.02, default: 0 }],
  constants: { Is: 1e-9, nVt: 0.0465 },
  equations: [{ name: "I", expr: "1000*Is*(exp(Vd/nVt)-1)" }],
  outputs: [{ key: "I", label: l("Courant I", "التيار I"), unit: "mA", decimals: 3 }],
  noise: 0.01,
  plot: { x: "Vd", y: "I", xLabel: l("Vd (V)", "Vd (V)"), yLabel: l("I (mA)", "I (mA)") },
  steps: [
    {
      id: "intro",
      type: "read",
      title: l("Objectif", "الهدف"),
      body: l(
        "Tracer la caractéristique courant-tension I = f(Vd) d'une diode à jonction polarisée en direct et déterminer sa tension de seuil.",
        "رسم المميّزة تيار-توتر I = f(Vd) لثنائي مستقطب في الاتجاه المباشر وتحديد توتر العتبة.",
      ),
    },
    {
      id: "measure",
      type: "measure",
      title: l("Mesures I(Vd)", "قياسات I(Vd)"),
      body: l(
        "Faites varier Vd de 0 à 0,8 V. Enregistrez au moins 8 points, dont plusieurs entre 0,60 V et 0,70 V où le courant décolle (il doit dépasser 1 mA).",
        "غيّر Vd من 0 إلى 0.8 فولت. سجّل 8 نقاط على الأقل، منها عدة نقاط بين 0.60 و0.70 فولت حيث يرتفع التيار (يجب أن يتجاوز 1 mA).",
      ),
      minPoints: 8,
      lock: [],
      xParam: "Vd",
    },
    {
      id: "compute-vth",
      type: "compute",
      title: l("Tension de seuil", "توتر العتبة"),
      body: l(
        "Sur votre courbe, déterminez la tension Vd pour laquelle I = 1 mA (par interpolation) et saisissez-la en volts.",
        "من منحناك، حدّد التوتر Vd الذي عنده I = 1 mA (بالاستيفاء) وأدخله بالفولت.",
      ),
      quantity: l("Vd pour I = 1 mA", "Vd عند I = 1 mA"),
      unit: "V",
      tolerancePct: 5,
      estimator: { kind: "threshold", x: "Vd", y: "I", level: 1 },
    },
    {
      id: "report",
      type: "report",
      title: l("Rapport de TP", "تقرير التجربة"),
      body: l("Générez le rapport PDF pour terminer le TP virtuel.", "ولّد تقرير PDF لإنهاء التجربة الافتراضية."),
    },
  ],
  remote: {
    load: "DIODE",
    minPoints: 8,
    plot: { x: "vLoad", y: "current", xLabel: l("Vd (V)", "Vd (V)"), yLabel: l("I (mA)", "I (mA)") },
    voltageMax: 12,
    instructions: l(
      "Sur le banc réel (diode + résistance série 220 Ω) : activez la sortie et augmentez la tension source de 0 à 12 V ; enregistrez au moins 8 points en particulier autour du coude de la diode.",
      "على الجهاز الحقيقي (ثنائي + مقاومة توالٍ 220 Ω): فعّل الخرج وارفع جهد المنبع من 0 إلى 12 فولت؛ سجّل 8 نقاط على الأقل خاصة حول منحنى الانعطاف للثنائي.",
    ),
  },
};

// ============================================================================
//  بنك الأسئلة
// ============================================================================
export interface SeedQuestion {
  type: "MCQ" | "TRUE_FALSE" | "NUMERIC" | "FILL_BLANK";
  textFr: string;
  textAr: string;
  payload: object;
  points?: number;
  explanationFr?: string;
  explanationAr?: string;
}

const ch = (id: string, fr: string, ar: string) => ({ id, fr, ar });

export const ohmQuestions: SeedQuestion[] = [
  {
    type: "MCQ",
    textFr: "Quelle est l'unité de la résistance électrique ?",
    textAr: "ما هي وحدة المقاومة الكهربائية؟",
    payload: { choices: [ch("a", "Le volt (V)", "الفولت (V)"), ch("b", "L'ampère (A)", "الأمبير (A)"), ch("c", "L'ohm (Ω)", "الأوم (Ω)"), ch("d", "Le watt (W)", "الواط (W)")], correct: ["c"], multi: false },
    explanationFr: "La résistance se mesure en ohms (Ω).",
    explanationAr: "تُقاس المقاومة بالأوم (Ω).",
  },
  {
    type: "TRUE_FALSE",
    textFr: "Pour une résistance constante, si la tension double, l'intensité du courant double aussi.",
    textAr: "بالنسبة لمقاومة ثابتة، إذا تضاعف التوتر تضاعفت شدة التيار كذلك.",
    payload: { correct: true },
    explanationFr: "U = R·I : I est proportionnel à U.",
    explanationAr: "U = R·I: التيار متناسب مع التوتر.",
  },
  {
    type: "NUMERIC",
    textFr: "Une résistance de 470 Ω est soumise à une tension de 10 V. Calculer l'intensité du courant en mA.",
    textAr: "مقاومة قيمتها 470 Ω خاضعة لتوتر 10 V. احسب شدة التيار بـ mA.",
    payload: { answer: 21.28, tolerancePct: 2, unit: "mA" },
    explanationFr: "I = U/R = 10/470 ≈ 0,02128 A = 21,28 mA.",
    explanationAr: "I = U/R = 10/470 ≈ 0.02128 A = 21.28 mA.",
    points: 2,
  },
  {
    type: "FILL_BLANK",
    textFr: "La loi d'Ohm s'écrit : U = ___ × I",
    textAr: "يُكتب قانون أوم: U = ___ × I",
    payload: { accepted: [["R", "r"]] },
    explanationFr: "U = R × I.",
    explanationAr: "U = R × I.",
  },
  {
    type: "MCQ",
    textFr: "Comment doit-on monter un voltmètre pour mesurer la tension aux bornes d'un dipôle ?",
    textAr: "كيف يُركَّب الفولطمتر لقياس التوتر بين طرفي ثنائي قطب؟",
    payload: { choices: [ch("a", "En série avec le dipôle", "على التوالي مع ثنائي القطب"), ch("b", "En dérivation (parallèle) aux bornes du dipôle", "على التوازي بين طرفي ثنائي القطب"), ch("c", "Peu importe", "لا يهم")], correct: ["b"], multi: false },
    explanationFr: "Le voltmètre se branche en dérivation ; l'ampèremètre en série.",
    explanationAr: "يُركَّب الفولطمتر على التوازي، والأمبيرمتر على التوالي.",
  },
  {
    type: "NUMERIC",
    textFr: "Quelle puissance (en mW) dissipe une résistance de 220 Ω soumise à 12 V ?",
    textAr: "ما الاستطاعة (بـ mW) التي تبددها مقاومة 220 Ω خاضعة لتوتر 12 V؟",
    payload: { answer: 654.5, tolerancePct: 2, unit: "mW" },
    explanationFr: "P = U²/R = 144/220 ≈ 0,6545 W = 654,5 mW.",
    explanationAr: "P = U²/R = 144/220 ≈ 0.6545 W = 654.5 mW.",
    points: 2,
  },
];

export const rcQuestions: SeedQuestion[] = [
  {
    type: "MCQ",
    textFr: "Quelle est l'expression de la constante de temps d'un circuit RC série ?",
    textAr: "ما تعبير ثابت الزمن لدارة RC على التوالي؟",
    payload: { choices: [ch("a", "τ = R × C", "τ = R × C"), ch("b", "τ = R / C", "τ = R / C"), ch("c", "τ = C / R", "τ = C / R"), ch("d", "τ = 1 / (R × C)", "τ = 1 / (R × C)")], correct: ["a"], multi: false },
    explanationFr: "τ = R·C (en secondes si R en Ω et C en F).",
    explanationAr: "τ = R·C (بالثواني إذا كانت R بالأوم وC بالفاراد).",
  },
  {
    type: "TRUE_FALSE",
    textFr: "Après une durée de 5τ, le condensateur est chargé à plus de 99 % de sa charge maximale.",
    textAr: "بعد مدة 5τ يكون المكثف مشحوناً بأكثر من 99% من شحنته القصوى.",
    payload: { correct: true },
    explanationFr: "1 − e⁻⁵ ≈ 0,993.",
    explanationAr: "1 − e⁻⁵ ≈ 0.993.",
  },
  {
    type: "NUMERIC",
    textFr: "Calculer τ (en s) pour R = 4,7 kΩ et C = 470 µF.",
    textAr: "احسب τ (بالثانية) من أجل R = 4.7 kΩ وC = 470 µF.",
    payload: { answer: 2.209, tolerancePct: 2, unit: "s" },
    explanationFr: "τ = 4700 × 470·10⁻⁶ ≈ 2,209 s.",
    explanationAr: "τ = 4700 × 470·10⁻⁶ ≈ 2.209 s.",
    points: 2,
  },
  {
    type: "NUMERIC",
    textFr: "Pour E = 10 V, quelle est la tension Uc (en V) à l'instant t = τ ?",
    textAr: "من أجل E = 10 V، ما قيمة التوتر Uc (بالفولت) عند اللحظة t = τ؟",
    payload: { answer: 6.32, tolerancePct: 2, unit: "V" },
    explanationFr: "Uc(τ) = E(1 − e⁻¹) ≈ 0,632 E = 6,32 V.",
    explanationAr: "Uc(τ) = E(1 − e⁻¹) ≈ 0.632 E = 6.32 V.",
    points: 2,
  },
  {
    type: "FILL_BLANK",
    textFr: "La tension aux bornes d'un condensateur ne peut pas subir de ___ (variation instantanée).",
    textAr: "لا يمكن أن يتغير توتر مكثف ___ (تغيراً لحظياً).",
    payload: { accepted: [["discontinuité", "discontinuite", "saut", "variation brusque", "rupture"]] },
    explanationAr: "التوتر بين طرفي المكثف دالة مستمرة (لا يقفز فجأة).",
    explanationFr: "Uc est une fonction continue du temps.",
  },
  {
    type: "MCQ",
    textFr: "Quelles modifications augmentent la durée de charge du condensateur ? (plusieurs réponses)",
    textAr: "ما التعديلات التي تزيد مدة شحن المكثف؟ (عدة إجابات)",
    payload: { choices: [ch("a", "Augmenter R", "زيادة R"), ch("b", "Augmenter C", "زيادة C"), ch("c", "Augmenter E", "زيادة E"), ch("d", "Diminuer R", "إنقاص R")], correct: ["a", "b"], multi: true },
    explanationFr: "τ = R·C ne dépend pas de E.",
    explanationAr: "τ = R·C لا يتعلق بـ E.",
  },
];

export const diodeQuestions: SeedQuestion[] = [
  {
    type: "MCQ",
    textFr: "Dans quel sens une diode à jonction laisse-t-elle passer le courant ?",
    textAr: "في أي اتجاه يمرّر الثنائي ذو الوصلة التيار؟",
    payload: { choices: [ch("a", "De l'anode vers la cathode", "من المصعد نحو المهبط"), ch("b", "De la cathode vers l'anode", "من المهبط نحو المصعد"), ch("c", "Dans les deux sens", "في الاتجاهين")], correct: ["a"], multi: false },
    explanationFr: "Polarisation directe : anode au potentiel + et cathode au potentiel −.",
    explanationAr: "الاستقطاب المباشر: المصعد بالجهد الأعلى.",
  },
  {
    type: "TRUE_FALSE",
    textFr: "La caractéristique I = f(U) d'une diode est une droite.",
    textAr: "المميّزة I = f(U) لثنائي مستقيمة.",
    payload: { correct: false },
    explanationFr: "Elle est exponentielle : très faible courant sous le seuil puis forte croissance.",
    explanationAr: "هي أسية: تيار ضعيف جداً دون العتبة ثم ارتفاع سريع.",
  },
  {
    type: "NUMERIC",
    textFr: "Une diode (seuil 0,7 V) est en série avec 220 Ω, sous une source de 12 V. Calculer l'intensité (en mA).",
    textAr: "ثنائي (عتبته 0.7 V) على التوالي مع 220 Ω تحت منبع 12 V. احسب شدة التيار (بـ mA).",
    payload: { answer: 51.36, tolerancePct: 3, unit: "mA" },
    explanationFr: "I = (12 − 0,7)/220 ≈ 51,4 mA.",
    explanationAr: "I = (12 − 0.7)/220 ≈ 51.4 mA.",
    points: 2,
  },
  {
    type: "FILL_BLANK",
    textFr: "Une diode au silicium a une tension de seuil d'environ ___ V.",
    textAr: "عتبة الثنائي المصنوع من السيليسيوم حوالي ___ V.",
    payload: { accepted: [["0.7", "0,7", "0.6", "0.65", "0.75"]] },
    explanationFr: "≈ 0,6 à 0,7 V.",
    explanationAr: "≈ 0.6 إلى 0.7 V.",
  },
  {
    type: "MCQ",
    textFr: "Pourquoi place-t-on une résistance en série avec une diode ?",
    textAr: "لماذا نضع مقاومة على التوالي مع الثنائي؟",
    payload: { choices: [ch("a", "Pour limiter le courant et protéger la diode", "لتحديد التيار وحماية الثنائي"), ch("b", "Pour augmenter la tension de seuil", "لزيادة توتر العتبة"), ch("c", "Pour inverser le sens du courant", "لعكس اتجاه التيار")], correct: ["a"], multi: false },
    explanationFr: "Au-delà du seuil, le courant croît exponentiellement : sans résistance la diode est détruite.",
    explanationAr: "بعد العتبة يرتفع التيار أسياً فيتلف الثنائي دون مقاومة.",
  },
  {
    type: "TRUE_FALSE",
    textFr: "Une diode polarisée en inverse laisse passer un courant important.",
    textAr: "الثنائي المستقطب عكسياً يمرّر تياراً كبيراً.",
    payload: { correct: false },
    explanationFr: "En inverse le courant est quasi nul (courant de fuite).",
    explanationAr: "عكسياً يكاد التيار ينعدم (تيار التسرّب).",
  },
];
