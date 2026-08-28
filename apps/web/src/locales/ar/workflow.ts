/**
 * `workflow` بالعربية — نظير `locales/en/workflow.ts` مفتاحًا بمفتاح.
 *
 * المصطلحات والعلامات تتبع المسرد في رأس `locales/ar/common.ts`، وصيغ الجمع
 * تحمل فئات CLDR الستّ كاملة كما هو موضّح في رأس `locales/ar/orgs.ts`.
 */
export default {
  title: 'سير العمل',
  subtitle: 'أعمدة لوحة {{project}}، والانتقالات المسموح بها بينها.',
  readOnly: 'تحتاج إلى صلاحية مسؤول المشروع لتغيير سير العمل هذا.',

  statuses: {
    title: 'الحالات',
    description: 'كل حالة هي عمود في اللوحة. اسحب لإعادة الترتيب.',
    empty: 'لا توجد حالات بعد',
    emptyBody: 'تحتاج اللوحة إلى عمود واحد على الأقل لتستقبل العمل.',
    add: 'إضافة حالة',
    addTitle: 'إضافة حالة',
    addDescription: 'عمود جديد يُضاف في نهاية اللوحة.',
    editName: 'إعادة تسمية الحالة',
    name: 'الاسم',
    namePlaceholder: 'قيد المراجعة',
    category: 'الفئة',
    color: 'اللون',
    wipLimit: 'حدّ العمل الجاري',
    wipLimitNone: 'بلا حدّ',
    wipLimitHint: 'تنبّه اللوحة عندما يتجاوز العمود هذا العدد.',
    reorder: 'إعادة ترتيب الحالة',
    reorderHint: 'اضغط المسافة لالتقاط الحالة، ثم الأسهم للتحريك، ثم المسافة للإفلات.',
    created: 'تمت إضافة الحالة.',
    updated: 'تم تحديث الحالة.',
    reordered: 'تم حفظ ترتيب اللوحة.',
    delete: 'حذف الحالة',
    deleteTitle: 'حذف {{name}}؟',
    deleteBody: 'يختفي العمود من اللوحة. لا بدّ أن تنتقل مهامه إلى مكان آخر أولًا.',
    moveTasksTo: 'نقل مهامه إلى',
    deleted: 'تم حذف الحالة.',
    lastOne: 'يحتاج المشروع إلى حالة واحدة على الأقل.',
    tasksHere_zero: 'لا مهام هنا',
    tasksHere_one: 'مهمة واحدة هنا',
    tasksHere_two: 'مهمتان هنا',
    tasksHere_few: '{{count}} مهام هنا',
    tasksHere_many: '{{count}} مهمة هنا',
    tasksHere_other: '{{count}} مهمة هنا',
  },

  categories: {
    todo: 'للتنفيذ',
    in_progress: 'قيد التنفيذ',
    done: 'منجَز',
    todoHint: 'لم يبدأ العمل. هنا يصل العمل الجديد.',
    in_progressHint: 'العمل جارٍ. يبدأ عندها احتساب زمن الدورة.',
    doneHint: 'انتهى. يُسجّل تاريخ الإنجاز ويُغلق مخطّط الاحتراق.',
  },

  transitions: {
    title: 'الانتقالات',
    description: 'افتراضيًا يمكن نقل المهمة إلى أي حالة. قيّد صفًّا لتسمح فقط بما تحدّده.',
    empty: 'أضف حالة ثانية لتعريف الانتقالات.',
    fromHeader: 'من',
    toHeader: 'إلى',
    restrict: 'تقييد',
    restrictLabel: 'تقييد الانتقالات من {{name}}',
    unrestricted: 'أي حالة',
    unrestrictedHint: 'بلا قيود: يمكن نقل المهمة من هذه الحالة إلى أي حالة أخرى.',
    restrictedHint: 'الحالات المحدّدة فقط هي المتاحة من هنا.',
    allow: 'السماح بالانتقال {{from}} ← {{to}}',
    selfCell: 'الحالة نفسها',
    noTargets: 'اختر هدفًا واحدًا على الأقل، أو ألغِ التقييد.',
    save: 'حفظ الانتقالات',
    saved: 'تم حفظ الانتقالات.',
    unsaved: 'لديك تغييرات غير محفوظة في الانتقالات.',
    reset: 'تجاهل التغييرات',
  },

  // سرد قارئ الشاشة أثناء إعادة ترتيب الحالات — انظر النسخة الإنجليزية.
  dnd: {
    picked: 'تم التقاط {{name}}، الموضع {{position}} من {{total}}.',
    over: '{{name}} الآن عند الموضع {{position}} من {{total}}.',
    dropped: 'تم إفلات {{name}} عند الموضع {{position}} من {{total}}.',
    cancelled: 'تم الإلغاء. بقيت {{name}} عند الموضع {{position}}.',
  },

  rules: {
    transitionBlocked: 'الانتقال {{from}} ← {{to}} غير مسموح في سير العمل هذا.',
    wipReached: 'بلغ {{name}} حدّ العمل الجاري ({{limit}}).',
    wipExceeded: 'تجاوز {{name}} حدّ العمل الجاري ({{count}}/{{limit}}).',
    wipBadge: '{{count}}/{{limit}}',
  },
} as const;
