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
 * ثلاث قواعد أسلوبية تسري على الملفات كلها:
 *
 *   1. **الأرقام غربية دائمًا** (`ar-u-nu-latn` — انظر `lib/lang-policy.ts`)،
 *      حتى داخل النص المتصل: «آخر 7 أيام» لا «آخر ٧ أيام». الخلط بين
 *      «٧» في جملة و«7» في العمود المجاور لها هو أسوأ من أيّهما وحده.
 *   2. **العلامات عربية**: الفاصلة «،» والفاصلة المنقوطة «؛» وعلامة الاستفهام
 *      «؟» — لا `,` ولا `?`. الاستثناء الوحيد فاصل الآلاف داخل رقم غربي.
 *   3. **`FlowBoard` علامة تجارية لا تُنقل حرفيًا**: لا «فلوبورد» في أي نص.
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
    adminUsers: 'المستخدمون',
    adminTelemetry: 'القياسات',
    adminTelemetryEvents: 'أحداث القياس',
    adminTelemetryRequests: 'تحليلات الطلبات',
    collapseSidebar: 'طيّ الشريط الجانبي',
    expandSidebar: 'توسيع الشريط الجانبي',
    openMenu: 'فتح قائمة التنقّل',
    switchOrg: 'تبديل المؤسسة',
    noOrganization: 'لا توجد مؤسسة',
    userMenu: 'قائمة الحساب',
    breadcrumb: 'مسار التنقّل',
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

  stub: {
    body: 'هذه الشاشة قادمة في مرحلة لاحقة.',
    wave: 'مُخطّط لها في {{wave}}',
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
