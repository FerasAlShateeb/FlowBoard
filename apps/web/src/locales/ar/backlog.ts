/**
 * `backlog` — عرض تخطيط السباقات (WP3.3).
 *
 * المصطلحات والعلامات تتبع المسرد في رأس `locales/ar/common.ts`: «سباق» للـ
 * sprint، و«قائمة الأعمال» للـ backlog، و«نقاط القصة» للـ story points.
 *
 * لا توجد صيغ جمع i18next هنا إطلاقًا: الأعداد تُعرض كقيمة معنونة («المهام:
 * 12») لا كجملة مصرَّفة، وهي الصياغة التي تُقرأ صحيحةً عند كل عدد. حيث لا مفرّ
 * من الجمع (`orgs`، `workflow`، `table`، `calendar`) تُكتب فئات CLDR الستّ
 * كاملة. الأرقام تبقى غربية (`ar-u-nu-latn`) — انظر `lib/lang-policy.ts`.
 */
export default {
  title: 'قائمة الأعمال',
  description: 'خطّط السباقات ورتّب ما هو قادم. اسحب العمل بين الأقسام.',

  actions: {
    newSprint: 'سباق جديد',
    editSprint: 'تعديل السباق',
    startSprint: 'بدء السباق',
    completeSprint: 'إنهاء السباق',
    deleteSprint: 'حذف السباق',
    renameSprint: 'إعادة تسمية السباق',
    sprintMenu: 'إجراءات السباق',
    rowMenu: 'إجراءات المهمة',
    collapse: 'طيّ القسم',
    expand: 'توسيع القسم',
    reorder: 'إعادة ترتيب المهمة',
    moveTo: 'نقل إلى',
    openTask: 'فتح المهمة',
  },

  states: {
    planned: 'مخطَّط',
    active: 'جارٍ',
    completed: 'مكتمل',
  },

  sections: {
    backlog: 'قائمة الأعمال',
    sprintLabel: 'سباق',
    emptySprint: 'لا شيء مخطَّط بعد — اسحب العمل إليه من قائمة الأعمال.',
    emptyBacklog: 'قائمة الأعمال فارغة.',
    emptyBacklogHint: 'أضف مهمة بالأسفل، أو انقل مهمة من أحد السباقات.',
    noMatches: 'لا توجد مهام تطابق هذه التصفية.',
    loadFailed: 'تعذّر تحميل هذا القسم.',
  },

  summary: {
    tasksLabel: 'عدد المهام في هذا القسم',
    pointsLabel: 'نقاط القصة في هذا القسم',
    donePointsLabel: 'نقاط القصة المنجزة',
    points: '{{points}} نقطة',
    donePoints: '{{points}} منجَزة',
    tasks: 'المهام',
    storyPoints: 'نقاط القصة',
  },

  dates: {
    none: 'بلا تواريخ',
    range: '{{start}} – {{end}}',
    startOnly: 'من {{start}}',
    endOnly: 'حتى {{end}}',
  },

  form: {
    createTitle: 'سباق جديد',
    createDescription: 'يبدأ السباق الجديد مخطَّطًا وفارغًا، ويمكنك سحب العمل إليه فورًا.',
    editTitle: 'تعديل السباق',
    editDescription: 'غيّر اسم السباق أو هدفه أو تواريخه المخطَّطة.',
    name: 'الاسم',
    namePlaceholder: 'السباق 4',
    goal: 'الهدف',
    goalPlaceholder: 'ما الذي ينبغي أن يحقّقه هذا السباق؟',
    startDate: 'تاريخ البدء',
    endDate: 'تاريخ الانتهاء',
    datesHint: 'التواريخ المخطَّطة اختيارية — بدء السباق يسأل عن التواريخ الفعلية.',
    created: 'أُنشئ السباق',
    updated: 'حُدِّث السباق',
  },

  start: {
    title: 'بدء {{name}}',
    description:
      'يُسجَّل النطاق أدناه بوصفه التزام هذا السباق، وعليه تُقاس السرعة، ولذلك لا يتغيّر بعد البدء.',
    scope: 'النطاق الملتزَم به',
    empty: 'لا يحتوي هذا السباق على عمل بعد. يمكنك بدؤه وسحب العمل إليه لاحقًا.',
    confirm: 'بدء السباق',
    started: '{{name}} جارٍ الآن',
  },

  complete: {
    title: 'إنهاء {{name}}',
    description:
      'يبقى العمل المنجَز مع السباق ويُسجَّل بوصفه نتيجته، أمّا غير المنجَز فلا بدّ أن ينتقل إلى مكان آخر.',
    done: 'منجَز',
    notDone: 'غير منجَز',
    moveIncompleteTo: 'نقل العمل غير المنجَز إلى',
    toBacklog: 'قائمة الأعمال',
    allDone: 'كل ما في هذا السباق منجَز.',
    confirm: 'إنهاء السباق',
    completed: 'انتهى {{name}}',
  },

  remove: {
    title: 'حذف {{name}}؟',
    body: 'يُحذف السباق ويعود كل ما فيه إلى قائمة الأعمال. لا يمكن التراجع عن ذلك.',
    deleted: 'حُذف السباق',
  },

  quickAdd: {
    label: 'إضافة مهمة إلى قائمة الأعمال',
    placeholder: 'ما الذي ينبغي عمله؟',
    submit: 'إضافة',
    created: 'أُنشئت {{key}}',
  },

  filter: {
    label: 'تصفية قائمة الأعمال',
    placeholder: 'تصفية بالعنوان أو المفتاح…',
    clear: 'مسح التصفية',
  },

  row: {
    points: '{{points}} نقطة',
    pointsLabel: 'نقاط القصة',
    unassigned: 'غير مُسنَد',
    noStatus: 'بلا حالة',
    moveToBacklog: 'قائمة الأعمال',
  },

  empty: {
    title: 'لا سباقات بعد',
    body: 'أنشئ سباقًا لتبدأ التخطيط. حتى ذلك الحين يبقى كل شيء في قائمة الأعمال.',
  },

  // سرد قارئ الشاشة أثناء السحب — انظر تعليق النسخة الإنجليزية: بدونه تعود
  // مكتبة dnd-kit إلى جملها الإنجليزية المدمجة داخل صفحة عربية.
  dnd: {
    instructions:
      'اضغط مسافة لالتقاط المهمة، واستخدم مفاتيح الأسهم لنقلها بين الصفوف والأقسام، ثم اضغط مسافة لإفلاتها. اضغط Escape للإلغاء.',
    picked: 'تم التقاط {{key}} من {{section}}.',
    over: '{{key}} الآن فوق {{section}}، عند الموضع {{position}}.',
    dropped: 'تم إفلات {{key}} في {{section}} عند الموضع {{position}}.',
    cancelled: 'تم الإلغاء. بقيت {{key}} في {{section}}.',
  },
} as const;
