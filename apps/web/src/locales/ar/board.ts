/**
 * `board` بالعربية — نظير `locales/en/board.ts` مفتاحًا بمفتاح.
 *
 * الإنجليزية تملك شكل المفاتيح (`i18n/i18next.d.ts` يشتق أنواعه منها) وهي لغة
 * الرجوع، فأي مفتاح ناقص هنا يظهر بالإنجليزية — و`i18n/locales.test.ts` يمنع
 * ذلك. لا توجد صيغ جمع i18next في هذه المساحة إطلاقًا: الأعداد تُعرض رقمًا
 * مجردًا مع اسم وصفي («البطاقات: 12»)، وهي صياغة تُقرأ صحيحةً عند كل عدد.
 *
 * الأرقام تبقى غربية (`ar-u-nu-latn`) — انظر `lib/lang-policy.ts`، والمصطلحات
 * تتبع المسرد في رأس `locales/ar/common.ts`.
 */
export default {
  title: 'اللوحة',
  description: 'اسحب البطاقات بين الأعمدة لتحريك العمل عبر سير العمل.',

  states: {
    noColumnsTitle: 'لا توجد أعمدة في هذا المشروع',
    noColumnsBody: 'تحتاج اللوحة إلى حالة واحدة على الأقل. أضِف الحالات من إعدادات سير العمل.',
    emptyTitle: 'لا شيء على اللوحة بعد',
    emptyBody: 'أضِف أول بطاقة إلى أحد الأعمدة وستظهر هنا.',
    noMatchesTitle: 'لا توجد بطاقات تطابق عوامل التصفية',
    noMatchesBody: 'خفّف أحد عوامل التصفية أو امسحها كلها لعرض اللوحة كاملة.',
    loading: 'جارٍ تحميل اللوحة…',
  },

  column: {
    count: 'البطاقات: {{count}}',
    add: 'أضِف بطاقة إلى {{status}}',
    empty: 'لا توجد بطاقات',
    dropHere: 'أفلِت هنا',
    region: 'عمود {{status}}',
  },

  wip: {
    badge: '{{count}}/{{limit}}',
    label: 'العمل الجاري: {{count}} من حدٍّ قدره {{limit}}',
    atLimit: 'عند حد العمل الجاري',
    over: 'تجاوز حد العمل الجاري',
    none: 'لا يوجد حد للعمل الجاري',
  },

  card: {
    open: 'افتح {{key}}',
    points: '{{points}} نقطة',
    pointsLabel: 'نقاط القصة: {{points}}',
    due: 'الاستحقاق {{date}}',
    overdue: 'متأخرة، كان استحقاقها {{date}}',
    moreLabels: '+{{count}}',
    labelsLabel: 'التسميات: {{names}}',
    unassigned: 'لم تُسنَد إلى أحد',
    assignedTo: 'مُسنَدة إلى {{name}}',
    hasDescription: 'تحتوي على وصف',
    comments: 'التعليقات: {{count}}',
    attachments: 'المرفقات: {{count}}',
  },

  quickAdd: {
    open: 'أضِف بطاقة',
    label: 'بطاقة جديدة في {{status}}',
    placeholder: 'ما العمل المطلوب؟',
    hint: 'Enter للإضافة، Escape للإلغاء',
    submit: 'أضِف البطاقة',
    cancel: 'إلغاء',
    created: 'تم إنشاء {{key}}',
    readOnly: 'تحتاج صلاحية الكتابة على هذا المشروع لإضافة بطاقات.',
  },

  filters: {
    label: 'عوامل تصفية اللوحة',
    searchPlaceholder: 'ابحث في البطاقات…',
    searchLabel: 'ابحث في البطاقات بالعنوان أو المفتاح',
    assignee: 'المُسنَد إليه',
    type: 'النوع',
    priority: 'الأولوية',
    labels: 'التسميات',
    unassigned: 'غير مُسنَد',
    optionSearch: 'ابحث…',
    noOptions: 'لا توجد خيارات',
    noMatches: 'لا توجد نتائج مطابقة',
    clearAll: 'مسح عوامل التصفية',
    activeLabel: 'عوامل التصفية النشطة: {{count}}',
    remove: 'أزِل عامل تصفية {{name}}',
    queryChip: 'بحث: {{value}}',
    selected: 'المحدَّد: {{count}}',
  },

  swimlanes: {
    label: 'المسارات',
    none: 'بدون مسارات',
    assignee: 'التجميع حسب المُسنَد إليه',
    epic: 'التجميع حسب الملحمة',
    priority: 'التجميع حسب الأولوية',
    noAssignee: 'غير مُسنَد',
    noEpic: 'خارج أي ملحمة',
    epicName: 'ملحمة {{key}}',
    collapse: 'اطوِ مسار {{name}}',
    expand: 'افتح مسار {{name}}',
    count: 'البطاقات في هذا المسار: {{count}}',
    addRow: 'أضِف بطاقة',
  },

  drop: {
    blocked: 'هذا النقل غير مسموح به',
    transition: 'سير العمل لا يسمح بالنقل من {{from}} إلى {{to}}',
    wip: 'بلغ {{status}} حدّه الأقصى: {{limit}} بطاقة',
  },

  dnd: {
    instructions:
      'اضغط مسافة لالتقاط البطاقة، واستخدم مفاتيح الأسهم لنقلها بين البطاقات والأعمدة، ثم اضغط مسافة لإفلاتها. اضغط Escape للإلغاء.',
    picked: 'تم التقاط {{key}} من {{status}}.',
    over: '{{key}} الآن فوق {{status}}.',
    dropped: 'تم إفلات {{key}} في {{status}}.',
    cancelled: 'تم الإلغاء. بقيت {{key}} في {{status}}.',
    blocked: 'لا يمكن إفلات {{key}} في {{status}}.',
  },
} as const;
