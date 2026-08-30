/**
 * `common` بالعربية — نظير `locales/en/common.ts` مفتاحًا بمفتاح.
 *
 * English owns the key SHAPE (`i18n/i18next.d.ts` types against it); this file
 * is never typed against, and any key it is missing simply falls back to
 * English. The reverse must never happen.
 *
 * ═══ مسرد المصطلحات (THE GLOSSARY) ═════════════════════════════════════════
 *
 * هذا المسرد ملزِم لكل ملفات `locales/ar/**`. سببه أن المصطلح الواحد كان يُترجم
 * بثلاث كلمات مختلفة في ثلاث مساحات أسماء (label = تسمية/وسم/تصنيف، و
 * assignee = المسؤول/المُسنَد إليه)، وهو ما يجعل المنتج يبدو وكأن ثلاثة أشخاص
 * كتبوه. أي مصطلح جديد يُضاف هنا أولًا، ثم يُستخدم.
 *
 *   task              مهمة              subtask         مهمة فرعية
 *   epic              ملحمة             story           قصة
 *   bug               خلل               issue type      نوع العنصر
 *   board             اللوحة            card            بطاقة
 *   column            عمود              status          حالة
 *   workflow          سير العمل         transition      انتقال
 *   backlog           قائمة الأعمال     sprint          سباق
 *   story points      نقاط القصة        velocity        السرعة
 *   label             تسمية             ‹لا وسم ولا تصنيف›
 *   assignee          المُسنَد إليه      unassigned      غير مُسنَد
 *   reporter          المُبلِّغ           watcher         متابِع
 *   due date          تاريخ الاستحقاق   start date      تاريخ البدء
 *   key (PROJ-12)     المفتاح           ‹لا رمز›
 *   filter            عامل التصفية      search          بحث
 *   dependency        اعتمادية          blocks / blocked by   تحجب / محجوبة بـ
 *   admin             مسؤول             global admin    مسؤول عام
 *   project lead      قائد المشروع      ‹لا مسؤول — الكلمة محجوزة للـ admin›
 *   member            عضو               viewer          مُطّلِع
 *   organization      مؤسسة             team            فريق
 *   theme             سمة               notification    إشعار
 *   to do / in progress / done      للتنفيذ / قيد التنفيذ / منجَز
 *   sprint completed  مكتمل
 *
 * ═══ إضافات الجولة الثانية (W3.2) ══════════════════════════════════════════
 *
 * سطوح الجولة الثانية — وحدة تحكّم الإدارة، ولوحات التحليلات الأربع، ودرج
 * السمات — أدخلت نحو ستمئة مفتاح جديد ومعها معجم كامل لم يكن موجودًا. كان
 * نصفه موزّعًا على رأس كل ملف على حدة (`ar/analytics.ts` مثلًا)، وهذه هي
 * النسخة المُلزِمة الوحيدة؛ ما في رؤوس الملفات شرحٌ لها لا بديل عنها.
 *
 *   ── الإدارة والتثبيت ─────────────────────────────────────────────────────
 *   instance          التثبيت            instance settings  إعدادات التثبيت
 *   platform          المنصّة             deployment        التثبيت
 *   organization mode وضع المؤسسات       single-org mode    وضع المؤسسة الواحدة
 *   default org       المؤسسة الافتراضية  slug              المُعرّف
 *   archive / restore أرشفة / استعادة    archived           مؤرشفة
 *   anonymize         طمس الهوية         provision          إنشاء مستخدم
 *   membership        عضوية              memberships        العضويات
 *   deactivate        تعطيل              force logout       تسجيل الخروج من كل الأجهزة
 *   telemetry         القياس عن بُعد      event              حدث
 *
 *   ── التحليلات ────────────────────────────────────────────────────────────
 *   analytics         التحليلات          metric             مقياس
 *   drill-down        التفصيل            bucket             فترة
 *   engagement        التفاعل            work               الإنجاز
 *   traffic           حركة الطلبات        growth             النمو
 *   active users      المستخدمون النشطون  sign-up            تسجيل
 *   stickiness        معدّل الالتصاق       cycle time         زمن الدورة
 *   error rate        معدّل الأخطاء        latency            زمن الاستجابة
 *   percentile        مئين                endpoint           نقطة النهاية
 *   invite            دعوة                acceptance rate    معدّل القبول
 *   time range        المدى الزمني        share              الحصّة
 *
 *   ── الواجهة المشتركة ─────────────────────────────────────────────────────
 *   Theme Studio      استوديو السمات      density            الكثافة
 *   breadcrumb        مسار التنقّل         facet              عامل التصفية
 *   panel / dialog    نافذة               palette (ألوان)    لوحة الألوان
 *
 * أربع ملاحظات تخصّ هذه الدفعة:
 *
 *   - أسماء اللوحات الأربع («التفاعل» و«الإنجاز» و«حركة الطلبات» و«النمو»)
 *     مرجعها `common:nav.analytics*` أعلاه، وتتكرّر حرفيًا في `ar/analytics.ts`:
 *     عنوان الصفحة ورابط العودة إليها لا يجوز أن يختلفا.
 *   - «استوديو السمات» اسم واحد لسطح واحد. كانت لوحة الأوامر تسمّيه «استوديو
 *     المظهر»، فبدا شيئين.
 *   - **«اللوحة» محجوزة للوحة الكانبان وحدها** (W3.2). كانت الكلمة نفسها
 *     تترجم `panel` في `settings` و`palette` في `theme` و«مجموعة الاختصارات»
 *     في `palette`، فصار في المنتج أربعة أشياء مختلفة باسم واحد — وهو الاسم
 *     الذي يعرفه المستخدم لشيء خامس. `panel` صار «نافذة»، و`palette` اللونية
 *     «لوحة الألوان» كاملةً لا «اللوحة».
 *   - **`deployment` و`instance` كلاهما «التثبيت»، و`platform` وحدها
 *     «المنصّة»** (W3.2). `en/analytics.ts` يقول `deployment` حيث يقول
 *     `en/admin.ts` ‏`instance` — وهما في العربية شيء واحد. كانت
 *     `ar/analytics.ts` تقول «المنصّة» في المواضع الستة، فبدت التحليلات وكأنها
 *     تصف منتجًا آخر غير الذي تصفه صفحة «إعدادات التثبيت».
 *
 * أربع قواعد أسلوبية تسري على الملفات كلها:
 *
 *   1. **الأرقام غربية دائمًا** (`ar-u-nu-latn` — انظر `lib/lang-policy.ts`)،
 *      حتى داخل النص المتصل: «آخر 7 أيام» لا «آخر ٧ أيام». الخلط بين
 *      «٧» في جملة و«7» في العمود المجاور لها هو أسوأ من أيّهما وحده.
 *   2. **العلامات عربية**: الفاصلة «،» والفاصلة المنقوطة «؛» وعلامة الاستفهام
 *      «؟» — لا `,` ولا `?`. الاستثناء الوحيد فاصل الآلاف داخل رقم غربي.
 *   3. **`FlowBoard` علامة تجارية لا تُنقل حرفيًا**: لا «فلوبورد» في أي نص.
 *   4. **العدد المتغيّر لا يُلحق به معدود مثبَّت** (W3.2). تمييز العدد في
 *      العربية يتغيّر ستّ مرّات، فجملة مثل «أُزيل من {{orgs}} مؤسسات» تصحّ
 *      لثلاثة وتخطئ لواحد ولاثنين ولأحد عشر. الحلّان المسموحان اثنان فقط:
 *
 *        أ. **مفتاح جمع كامل** حين يصل العدد رقمًا: تُكتب الفئات الست
 *           (`_zero` و`_one` و`_two` و`_few` و`_many` و`_other`) ويُمرَّر
 *           `count` من موضع الاستدعاء. يفرض هذا `i18n/locales.test.ts`.
 *        ب. **صيغة محايدة للعدد** حين يصل العدد نصًّا منسَّقًا مسبقًا
 *           (‏`1,204`) فلا يستطيع i18next تصريفه: «{{n}} من الأحداث»، أو
 *           وضع الرقم بعد نقطتين — «النشطون خلال آخر 30 يومًا: {{n}}».
 *
 *      لا ثالث لهما. الصيغة التي «تصحّ غالبًا» تخطئ في أول شاشة يراها المستخدم
 *      على تثبيت صغير، وهي بالضبط الحالة التي تُقرأ فيها هذه الأرقام أولًا.
 */
export default {
  /** اسم المنتج علامة تجارية — لا يُترجم أبدًا. */
  brand: 'FlowBoard',

  actions: {
    save: 'حفظ',
    cancel: 'إلغاء',
    close: 'إغلاق',
    delete: 'حذف',
    edit: 'تعديل',
    create: 'إنشاء',
    search: 'بحث',
    filter: 'تصفية',
    retry: 'إعادة المحاولة',
    back: 'رجوع',
    next: 'التالي',
    confirm: 'تأكيد',
    copy: 'نسخ',
    copied: 'تم النسخ',
    reload: 'إعادة التحميل',
    signIn: 'تسجيل الدخول',
    signOut: 'تسجيل الخروج',
    add: 'إضافة',
    remove: 'إزالة',
    apply: 'تطبيق',
    clear: 'مسح',
    saveChanges: 'حفظ التغييرات',
    saving: 'جارٍ الحفظ…',
    manage: 'إدارة',
    open: 'فتح',
    refresh: 'تحديث',
    more: 'إجراءات إضافية',
    done: 'تم',
  },

  states: {
    loading: 'جارٍ التحميل…',
    empty: 'لا يوجد شيء بعد',
    error: 'حدث خطأ ما',
    errorBody: 'تعذّر التحميل. حاول مرة أخرى بعد قليل.',
    noResults: 'لا توجد نتائج مطابقة',
    offline: 'يبدو أنك غير متصل بالإنترنت',
  },

  confirm: {
    title: 'هل أنت متأكد؟',
    deleteTitle: 'حذف {{name}}؟',
    deleteBody: 'لا يمكن التراجع عن هذا الإجراء.',
    discardTitle: 'تجاهل التغييرات؟',
    discardBody: 'ستفقد تعديلاتك.',
    typeToConfirm: 'اكتب {{value}} للتأكيد',
  },

  picker: {
    search: 'ابحث عن شخص…',
    empty: 'لا أحد يطابق ذلك',
    unassigned: 'غير مُسنَد',
    selectPerson: 'اختر شخصًا',
    clearSelection: 'مسح الاختيار',
  },

  errorState: {
    title: 'تعذّر التحميل',
    retry: 'إعادة المحاولة',
  },

  nav: {
    sidebarLabel: 'التنقّل الرئيسي',
    projectSection: 'المشروع',
    workspaceSection: 'مساحة العمل',
    adminSection: 'الإدارة',
    analyticsSection: 'التحليلات',
    home: 'الرئيسية',
    board: 'اللوحة',
    backlog: 'قائمة الأعمال',
    roadmap: 'خارطة الطريق',
    table: 'الجدول',
    calendar: 'التقويم',
    dashboard: 'لوحة المعلومات',
    projectSettings: 'إعدادات المشروع',
    general: 'عام',
    workflow: 'سير العمل',
    labels: 'التسميات',
    task: 'المهمة',
    invite: 'الدعوة',
    organization: 'المؤسسة',
    teams: 'الفرق',
    members: 'الأعضاء',
    orgSettings: 'إعدادات المؤسسة',
    notifications: 'الإشعارات',
    profile: 'ملفي الشخصي',
    theme: 'السمة',
    adminOverview: 'نظرة عامة',
    adminOrgs: 'المؤسسات',
    adminProjects: 'المشاريع',
    adminUsers: 'المستخدمون',
    adminSettings: 'إعدادات التثبيت',
    analyticsEngagement: 'التفاعل',
    analyticsWork: 'الإنجاز',
    analyticsTraffic: 'حركة الطلبات',
    analyticsGrowth: 'النمو',
    adminTelemetry: 'القياس عن بُعد',
    adminTelemetryEvents: 'أحداث القياس',
    adminTelemetryRequests: 'تحليلات الطلبات',
    collapseSidebar: 'طيّ الشريط الجانبي',
    expandSidebar: 'توسيع الشريط الجانبي',
    openMenu: 'فتح قائمة التنقّل',
    userMenu: 'قائمة الحساب',
    breadcrumb: 'مسار التنقّل',

    // مبدّل المؤسسات — مربّع بحث لا قائمة منسدلة.
    switchOrg: 'تبديل المؤسسة',
    noOrganization: 'لا توجد مؤسسة',
    organizations: 'المؤسسات',
    searchOrganizations: 'ابحث عن مؤسسة…',
    noOrganizationsFound: 'لا توجد مؤسسات مطابقة',
    allOrganizations: 'كل المؤسسات',
    manageOrganizations: 'إدارة المؤسسات',
    createOrganization: 'مؤسسة جديدة',

    // «العرض كعضو» — معاينة المسؤول للمنتج من دون وحدة التحكّم الخاصة به.
    viewAsMember: 'العرض كعضو',
    viewAsAdmin: 'عرض المسؤول',
    viewingAsMember: 'تُعاين الآن كعضو',
    backToAdminView: 'العودة إلى عرض المسؤول',
    exitMemberView: 'العودة إلى عرض المسؤول',
    viewAsBlockedBody:
      'الإدارة مخفيّة أثناء معاينتك لـ FlowBoard كعضو. عُد إلى عرض المسؤول لفتح هذه الصفحة.',
  },

  appearance: {
    toggleDark: 'التبديل إلى الوضع الداكن',
    toggleLight: 'التبديل إلى الوضع الفاتح',
  },

  language: {
    label: 'اللغة',
    hint: 'تبدّل لغة الواجهة واتجاه النص. تُحفظ على هذا الجهاز.',
    changed: 'اللغة: {{name}}',
    english: 'English',
    arabic: 'العربية',
  },

  ui: {
    calendar: {
      previousMonth: 'الانتقال إلى الشهر السابق',
      nextMonth: 'الانتقال إلى الشهر التالي',
      chooseMonth: 'اختيار الشهر',
      chooseYear: 'اختيار السنة',
    },
    command: {
      placeholder: 'اكتب أمرًا أو ابحث…',
      empty: 'لا توجد نتائج.',
    },
  },

  grid: {
    density: {
      label: 'الكثافة',
      comfortable: 'مريحة',
      compact: 'متراصة',
    },
    range: {
      label: 'المدى الزمني',
      custom: 'مخصّص',
    },
  },

  appError: {
    title: 'حدث خطأ ما',
    description:
      'واجهت هذه الصفحة خطأً غير متوقع. عادةً ما تحلّ إعادة التحميل المشكلة — وإن تكرّر الأمر فعُد إلى البداية.',
    updating: 'جارٍ التحديث إلى أحدث إصدار…',
    reload: 'إعادة التحميل',
    home: 'العودة إلى الرئيسية',
  },

  notFound: {
    title: 'الصفحة غير موجودة',
    description: 'هذا الرابط لا يؤدي إلى أي صفحة في FlowBoard.',
  },

  // The single task vocabulary — see the English file for why it lives here.
  taskType: {
    epic: 'ملحمة',
    story: 'قصة',
    task: 'مهمة',
    bug: 'خلل',
    subtask: 'مهمة فرعية',
  },

  priority: {
    lowest: 'الأدنى',
    low: 'منخفضة',
    medium: 'متوسطة',
    high: 'عالية',
    highest: 'الأعلى',
  },

  taskTypeLabel: 'النوع: {{type}}',
  priorityLabel: 'الأولوية: {{priority}}',
} as const;
