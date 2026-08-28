/**
 * `tasks` — النسخة العربية من لوحة تفاصيل المهمة.
 *
 * البنية مطابقة حرفيًا للملف الإنجليزي: `i18n/locales.test.ts` يقارن المفاتيح
 * في الاتجاهين، فأي مفتاح ناقص هنا يعني تسرّب نص إنجليزي إلى واجهة عربية، وأي
 * مفتاح زائد هو نص ميت لا يصل إليه أي استدعاء لـ `t()`.
 *
 * قسم `activity.*` يحمل جملة واحدة لكل قيمة في التعداد المغلق
 * `activityActionSchema`، وكل جملة تبدأ بـ `{{actor}}` تمامًا كما في الإنجليزية،
 * حتى يبقى عقد الاستيفاء (interpolation) موحّدًا في الطرفين.
 *
 * الأرقام تبقى غربية في كل اللغات (راجع `.agents/docs/i18n.md`)، لذلك لا يُكتب
 * هنا أي رقم عربي‑هندي. والمصطلحات تتبع المسرد في رأس `locales/ar/common.ts`:
 * «المُسنَد إليه» لا «المسؤول» (فالأخيرة دور الـ admin)، و«تسمية» لا «وسم».
 */
export default {
  title: 'مهمة',

  sheet: {
    label: 'تفاصيل المهمة',
    loading: 'جارٍ تحميل المهمة…',
    notFoundTitle: 'هذه المهمة غير موجودة',
    notFoundBody: 'ربما جرى حذفها، أو أن الرابط يخصّ مشروعًا آخر.',
    backToView: 'العودة إلى العرض السابق',
  },

  header: {
    copyLink: 'نسخ رابط المهمة',
    changeType: 'تغيير نوع العنصر',
    changeStatus: 'تغيير الحالة',
    watch: 'متابعة هذه المهمة',
    unwatch: 'إيقاف المتابعة',
    watching: 'تتابعها',
    // قيمة معنونة لا جملة مصرَّفة: «3 متابع» و«11 متابعون» كلاهما خطأ، والصيغة
    // المعنونة تُقرأ صحيحةً عند كل عدد.
    watcherCount: 'المتابعون: {{count}}',
    more: 'إجراءات أخرى',
    delete: 'حذف المهمة',
    deleteTitle: 'حذف {{key}}؟',
    deleteBody: 'ستُزال المهمة ومهامها الفرعية من كل العروض. لا يمكن التراجع عن ذلك.',
    transitionBlocked: 'لا يسمح سير العمل بالانتقال من {{from}} إلى {{to}}.',
    reporterPrefix: 'أبلغ عنها',
  },

  category: {
    todo: 'للتنفيذ',
    in_progress: 'قيد التنفيذ',
    done: 'منجَز',
  },

  fields: {
    heading: 'التفاصيل',
    assignee: 'المُسنَد إليه',
    unassigned: 'غير مُسنَد',
    reporter: 'المُبلِّغ',
    priority: 'الأولوية',
    storyPoints: 'نقاط القصة',
    storyPointsHint: 'الأنصاف مسموحة — 0.5 و1 و2 و3 و5.',
    startDate: 'تاريخ البدء',
    dueDate: 'تاريخ الاستحقاق',
    pickDate: 'اختر تاريخًا',
    clearDate: 'مسح {{field}}',
    overdue: 'متأخرة',
    sprint: 'السباق',
    backlog: 'قائمة الأعمال',
    epic: 'الملحمة',
    noEpic: 'بلا ملحمة',
    labels: 'التسميات',
    noLabels: 'بلا تسميات',
    searchLabels: 'ابحث في التسميات…',
    createLabel: 'إنشاء «{{name}}»',
    noLabelMatches: 'لا تسميات مطابقة',
    // أسماء لا أفعال: الثلاثة عناوينُ حقولٍ تعرض طوابع زمنية، وخلطُ «أُنشئت»
    // بـ«آخر تحديث» في عمود واحد كان يقرأ كأنه سطران من صفحتين مختلفتين.
    created: 'تاريخ الإنشاء',
    updated: 'آخر تحديث',
    resolved: 'تاريخ الإنجاز',
    saving: 'جارٍ الحفظ…',
    readOnly: 'صلاحيتك على هذا المشروع للقراءة فقط.',
  },

  description: {
    heading: 'الوصف',
    empty: 'لا يوجد وصف بعد.',
    add: 'أضف وصفًا',
    edit: 'تحرير الوصف',
    placeholder: 'صِف العمل المطلوب. تنسيق Markdown مدعوم، واكتب @ للإشارة إلى زميل.',
    submitHint: 'Ctrl/⌘ + Enter للحفظ، وEscape للإلغاء.',
  },

  mention: {
    label: 'الإشارة إلى شخص',
    empty: 'لا أحد يطابق ذلك',
    hint: 'اكتب @ للإشارة إلى زميل',
  },

  subtasks: {
    heading: 'المهام الفرعية',
    progress: 'أُنجزت {{done}} من {{total}}',
    empty: 'لا مهام فرعية بعد.',
    add: 'إضافة مهمة فرعية',
    placeholder: 'ما الذي يجب إنجازه؟',
    create: 'إضافة',
    parentHeading: 'المهمة الأم',
    parentHint: 'المهام الفرعية لا تتفرّع بدورها.',
  },

  dependencies: {
    heading: 'الاعتماديات',
    // «حجب» لا «تعطيل»: `errors:self_dependency` و`validation:dependencyDirection`
    // يستعملان الجذر نفسه، وكان الوصف الواحد يظهر بكلمتين حسب مكان قراءته.
    blockedBy: 'محجوبة بـ',
    blocks: 'تحجب',
    empty: 'لا اعتماديات.',
    addBlockedBy: 'إضافة مهمة حاجبة',
    addBlocks: 'إضافة مهمة محجوبة',
    search: 'ابحث بالمفتاح أو العنوان…',
    noMatches: 'لا مهام مطابقة',
    remove: 'إزالة الاعتمادية',
  },

  comments: {
    heading: 'التعليقات',
    empty: 'لا تعليقات بعد. ابدأ النقاش.',
    placeholder: 'اكتب تعليقًا، و@ للإشارة إلى زميل.',
    submit: 'تعليق',
    edited: 'مُعدَّل',
    editLabel: 'تحرير التعليق',
    deleteLabel: 'حذف التعليق',
    deleteTitle: 'حذف هذا التعليق؟',
    deleteBody: 'سيُحذف التعليق لدى الجميع. لا يمكن التراجع عن ذلك.',
  },

  attachments: {
    heading: 'المرفقات',
    empty: 'لا ملفات مرفقة.',
    drop: 'أفلِت الملفات هنا، أو',
    browse: 'تصفّح',
    choose: 'اختر ملفات للإرفاق',
    dropActive: 'أفلِت للرفع',
    uploading: 'جارٍ الرفع…',
    failed: 'فشل الرفع',
    dismiss: 'إخفاء',
    download: 'تنزيل',
    remove: 'حذف المرفق',
    removeTitle: 'حذف {{name}}؟',
    removeBody: 'سيُحذف الملف نهائيًا. لا يمكن التراجع عن ذلك.',
    uploadedBy: 'أضافه {{name}}',
    maxSize: 'الحد الأقصى للملف {{size}}.',
  },

  tabs: {
    comments: 'التعليقات',
    activity: 'السجل',
  },

  activity: {
    heading: 'السجل',
    empty: 'لم يحدث شيء هنا بعد.',
    loadMore: 'عرض المزيد',
    system: 'FlowBoard',

    task: {
      created: 'أنشأ {{actor}} هذه المهمة',
      field_changed: 'غيّر {{actor}} {{field}} من {{from}} إلى {{to}}',
      status_changed: 'نقل {{actor}} هذه المهمة من {{from}} إلى {{to}}',
      assigned: 'أسند {{actor}} هذه المهمة إلى {{to}}',
      moved_sprint: 'نقل {{actor}} هذه المهمة إلى {{to}}',
      ranked: 'أعاد {{actor}} ترتيب هذه المهمة',
      deleted: 'حذف {{actor}} هذه المهمة',
    },
    comment: {
      added: 'علّق {{actor}}',
      edited: 'عدّل {{actor}} تعليقًا',
      deleted: 'حذف {{actor}} تعليقًا',
    },
    attachment: {
      added: 'أرفق {{actor}} الملف {{to}}',
      deleted: 'أزال {{actor}} المرفق {{from}}',
    },
    dependency: {
      added: 'أضاف {{actor}} اعتمادية',
      removed: 'أزال {{actor}} اعتمادية',
    },
    watcher: {
      added: 'بدأ {{actor}} متابعة المهمة',
      removed: 'أوقف {{actor}} متابعة المهمة',
    },
    label: {
      added: 'أضاف {{actor}} التسمية {{to}}',
      removed: 'أزال {{actor}} التسمية {{from}}',
    },
    sprint: {
      created: 'أنشأ {{actor}} سباقًا',
      started: 'بدأ {{actor}} سباقًا',
      completed: 'أنهى {{actor}} سباقًا',
      deleted: 'حذف {{actor}} سباقًا',
    },
    workflow: {
      changed: 'غيّر {{actor}} سير العمل',
    },
    project: {
      created: 'أنشأ {{actor}} المشروع',
      updated: 'حدّث {{actor}} المشروع',
      deleted: 'حذف {{actor}} المشروع',
    },
    member: {
      added: 'أضاف {{actor}} عضوًا إلى المشروع',
      removed: 'أزال {{actor}} عضوًا من المشروع',
    },

    nothing: 'لا شيء',

    field: {
      title: 'العنوان',
      description: 'الوصف',
      type: 'نوع العنصر',
      statusId: 'الحالة',
      priority: 'الأولوية',
      assigneeId: 'المُسنَد إليه',
      storyPoints: 'نقاط القصة',
      startDate: 'تاريخ البدء',
      dueDate: 'تاريخ الاستحقاق',
      sprintId: 'السباق',
      epicId: 'الملحمة',
      parentId: 'المهمة الأم',
      labelIds: 'التسميات',
      unknown: 'أحد الحقول',
    },
  },

  create: {
    title: 'إنشاء مهمة',
    submit: 'إنشاء',
    titleField: 'العنوان',
    titlePlaceholder: 'ملخّص قصير للعمل',
    typeField: 'النوع',
    statusField: 'الحالة',
    assigneeField: 'المُسنَد إليه',
    priorityField: 'الأولوية',
    pointsField: 'نقاط القصة',
    sprintField: 'السباق',
    labelsField: 'التسميات',
    descriptionField: 'الوصف',
    descriptionPlaceholder: 'اختياري. تنسيق Markdown مدعوم.',
  },
} as const;
