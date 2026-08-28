/**
 * `table` بالعربية — نظير `locales/en/table.ts` مفتاحًا بمفتاح.
 *
 * ثلاث ملاحظات في الترجمة:
 *  - الأرقام تبقى لاتينية (`1–25 من 312`) لأن الجدول شبكة `tabular-nums`
 *    ومفاتيح المهام معرّفات لاتينية تُقرأ إلى جانبها — انظر `lib/lang-policy`.
 *  - نصوص إمكانية الوصول (`grid.sortTo.*`) تصف الإجراء لا الحالة، تمامًا كما في
 *    الإنجليزية، لأن `aria-sort` هو من يعلن الحالة.
 *  - المصطلحات تتبع المسرد في رأس `locales/ar/common.ts`: «عوامل التصفية» لا
 *    «المرشّحات» (فـ«مرشّح» تعني candidate أيضًا)، و«تسمية» لا «وسم».
 */
export default {
  title: 'الجدول',
  subtitle: 'كل مهام {{project}}، قابلة للتحرير في مكانها.',

  columns: {
    key: 'المفتاح',
    title: 'العنوان',
    type: 'النوع',
    status: 'الحالة',
    priority: 'الأولوية',
    assignee: 'المُسنَد إليه',
    points: 'النقاط',
    sprint: 'السباق',
    labels: 'التسميات',
    startDate: 'تاريخ البدء',
    dueDate: 'تاريخ الاستحقاق',
    updatedAt: 'آخر تحديث',
  },

  grid: {
    label: 'المهام',
    openTask: 'فتح {{key}}',
    saving: 'جارٍ الحفظ',
    sortTo: {
      asc: 'ترتيب تصاعدي',
      desc: 'ترتيب تنازلي',
      none: 'إلغاء الترتيب',
    },
    empty: 'لا توجد مهام بعد',
    emptyBody: 'أنشئ أول مهمة وستظهر هنا.',
    noMatches: 'لا توجد مهام تطابق عوامل التصفية هذه',
    noMatchesBody: 'ألغِ أحد عوامل التصفية أو وسّع البحث لترى المزيد.',
    readOnly: 'صلاحيتك في هذا المشروع للقراءة فقط، لذا لا يمكن تحرير الخلايا.',
  },

  editors: {
    title: 'تحرير العنوان',
    type: 'تحرير النوع',
    status: 'تحرير الحالة',
    priority: 'تحرير الأولوية',
    assignee: 'تحرير المُسنَد إليه',
    points: 'تحرير نقاط القصة',
    sprint: 'تحرير السباق',
    labels: 'تحرير التسميات',
    noLabels: 'لا توجد تسميات في هذا المشروع بعد.',
    pickDate: 'اختر تاريخًا',
    clearDate: 'مسح التاريخ',
  },

  toolbar: {
    searchLabel: 'البحث في المهام',
    searchPlaceholder: 'ابحث بالعنوان أو المفتاح…',
    filters: 'عوامل التصفية',
    clearFilters: 'مسح عوامل التصفية',
    columns: 'الأعمدة',
    columnsCount: '{{shown}} من {{total}}',
    export: 'تصدير CSV',
    exporting: 'جارٍ التحضير…',
    exportHint:
      'يُنزّل كل مهمة تطابق عوامل التصفية الحالية، بالأعمدة الظاهرة فقط، وبحدّ أقصى {{cap}} صفًّا.',
    // فئات CLDR الستّ كاملة — انظر رأس `locales/ar/orgs.ts`. الاكتفاء بـ
    // `_one`/`_other` كان يترك i18next بلا صيغة لـ zero/two/few/many فيسقط إلى
    // «Exported 11 tasks.» داخل إشعار عربي.
    exported_zero: 'لم تُصدَّر أي مهمة.',
    exported_one: 'تم تصدير مهمة واحدة.',
    exported_two: 'تم تصدير مهمتين.',
    exported_few: 'تم تصدير {{count}} مهام.',
    exported_many: 'تم تصدير {{count}} مهمة.',
    exported_other: 'تم تصدير {{count}} مهمة.',
    exportEmpty: 'لا شيء لتصديره بعوامل التصفية هذه.',
    exportCapped: 'صُدِّرت أول {{cap}} مهمة — ضيّق عوامل التصفية للحصول على البقية.',
    exportFailed: 'تعذّر إتمام التصدير.',
  },

  filters: {
    status: 'الحالة',
    type: 'النوع',
    priority: 'الأولوية',
    assignee: 'المُسنَد إليه',
    label: 'التسمية',
    sprint: 'السباق',
    unassigned: 'غير مُسنَد',
    backlog: 'قائمة الأعمال',
    active: 'عوامل التصفية المفعّلة',
    searchChip: 'بحث: {{value}}',
    clearOne: 'إلغاء عامل تصفية {{name}}',
    clearSearch: 'مسح البحث',
    empty: 'لا توجد خيارات بعد.',
    countBadge: '{{count}}',
  },

  config: {
    title: 'الأعمدة',
    description: 'اختر ما يظهر، واسحب لإعادة الترتيب.',
    reset: 'إعادة الضبط الافتراضي',
    toggle: 'إظهار عمود {{name}}',
    locked: 'عمود المفتاح ظاهر دائمًا.',
    reorder: 'إعادة ترتيب {{name}}',
    reorderHint: 'اضغط المسافة لالتقاط العمود، ثم الأسهم للتحريك، ثم المسافة للإفلات.',

    // سرد قارئ الشاشة أثناء سحب الأعمدة — انظر النسخة الإنجليزية.
    dnd: {
      picked: 'تم التقاط {{name}}، العمود {{position}} من {{total}}.',
      over: '{{name}} الآن العمود {{position}} من {{total}}.',
      dropped: 'تم إفلات {{name}} ليكون العمود {{position}} من {{total}}.',
      cancelled: 'تم الإلغاء. بقي {{name}} في الموضع {{position}}.',
    },
  },

  footer: {
    range: '{{from}}–{{to}} من {{total}}',
    empty: 'لا توجد مهام',
    rowsPerPage: 'صفوف في الصفحة',
    previous: 'الصفحة السابقة',
    next: 'الصفحة التالية',
    page: 'الصفحة {{page}} من {{pages}}',
  },
} as const;
