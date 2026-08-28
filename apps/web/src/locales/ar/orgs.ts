/**
 * `orgs` بالعربية — نظير `locales/en/orgs.ts` مفتاحًا بمفتاح.
 *
 * المصطلحات والعلامات تتبع المسرد في رأس `locales/ar/common.ts`.
 *
 * ═══ صيغ الجمع ═════════════════════════════════════════════════════════════
 *
 * حيثما استعملت الإنجليزية زوج `_one`/`_other` تحمل العربية **الفئات الستّ
 * كاملة** كما تعرّفها CLDR: `_zero` و`_one` و`_two` و`_few` (3–10) و`_many`
 * (11–99) و`_other` (100 فما فوق والكسور). الاكتفاء بـ `_one`/`_other` كان
 * يعني أن i18next لا يجد صيغةً لفئة العدد فيسقط إلى النص الإنجليزي: «11 members»
 * داخل جملة عربية. تمييز العدد في العربية ليس تفصيلًا تجميليًا — «3 أعضاء» و«11
 * عضوًا» و«100 عضو» ثلاث صيغ لا تُختصر في واحدة.
 *
 * `i18n/locales.test.ts` يسمح بهذا التفاوت وحده: مفتاح عربي زائد مقبول فقط إذا
 * كان لاحقةَ جمعٍ لمفتاح جمعٍ موجود في الإنجليزية.
 */
export default {
  picker: {
    title: 'اختر مؤسسة',
    subtitle: 'أنت عضو في أكثر من مؤسسة. اختر أين تريد العمل.',
    empty: 'لست عضوًا في أي مؤسسة بعد',
    emptyBody: 'اطلب من أحد المسؤولين دعوتك، أو أنشئ مؤسسة إن كانت لديك الصلاحية.',
    members_zero: 'لا أعضاء',
    members_one: 'عضو واحد',
    members_two: 'عضوان',
    members_few: '{{count}} أعضاء',
    members_many: '{{count}} عضوًا',
    members_other: '{{count}} عضو',
    projects_zero: 'لا مشاريع',
    projects_one: 'مشروع واحد',
    projects_two: 'مشروعان',
    projects_few: '{{count}} مشاريع',
    projects_many: '{{count}} مشروعًا',
    projects_other: '{{count}} مشروع',
  },

  home: {
    title: 'المشاريع',
    subtitle: 'كل ما يمكنك فتحه في {{org}}.',
    empty: 'لا توجد مشاريع بعد',
    emptyBody: 'أنشئ أول مشروع لتبدأ تخطيط العمل.',
    emptyBodyViewer: 'يستطيع مسؤول المؤسسة إنشاء أول مشروع من هنا.',
    searchPlaceholder: 'تصفية المشاريع…',
    noMatches: 'لا يوجد مشروع مطابق',
    // «قائد» لا «مسؤول»: كلمة «مسؤول» محجوزة لدور الـ admin في المسرد، وكانت
    // الشاشة الواحدة تعرضها بالمعنيين معًا.
    lead: 'القائد',
    noLead: 'بلا قائد',
    open: 'فتح اللوحة',
  },

  createProject: {
    trigger: 'مشروع جديد',
    title: 'إنشاء مشروع',
    description: 'لكل مشروع لوحته وسير عمله وقائمة أعماله وتسمياته الخاصة.',
    name: 'الاسم',
    namePlaceholder: 'منصّة المدفوعات',
    key: 'المفتاح',
    keyHint: 'يسبق كل مهمة: {{key}}-1 و{{key}}-2 …',
    keyPlaceholder: 'PAY',
    projectDescription: 'الوصف',
    descriptionPlaceholder: 'الغرض من هذا المشروع (اختياري)',
    lead: 'قائد المشروع',
    team: 'الفريق المالك',
    none: 'بلا',
    submit: 'إنشاء المشروع',
    success: 'تم إنشاء المشروع {{key}}.',
  },

  members: {
    title: 'الأعضاء',
    subtitle: 'من يستطيع رؤية {{org}}، وما الذي يستطيع فعله.',
    empty: 'لا يوجد أعضاء بعد',
    emptyBody: 'ادعُ شخصًا للبدء.',
    searchPlaceholder: 'ابحث في الأعضاء…',
    columnMember: 'العضو',
    columnEmail: 'البريد الإلكتروني',
    columnRole: 'الدور',
    columnJoined: 'تاريخ الانضمام',
    columnActions: 'إجراءات',
    joinedOn: 'انضمّ في {{date}}',
    removeTitle: 'إزالة {{name}}؟',
    removeBody: 'سيفقد الوصول إلى هذه المؤسسة وكل مشاريعها. يبقى عمله كما هو.',
    removed: 'تمت إزالة {{name}}.',
    // «تم تغيير دور فلان إلى X» لا «فلان أصبح X»: الدور يُستوفى اسمًا مجرّدًا
    // («مسؤول»)، ولا سبيل إلى نصبه داخل خبرِ «أصبح» عبر الاستيفاء.
    roleChanged: 'تم تغيير دور {{name}} إلى {{role}}.',
    you: 'أنت',
    lastAdmin: 'تحتاج المؤسسة إلى مسؤول واحد على الأقل.',
  },

  invites: {
    title: 'الدعوات المعلّقة',
    subtitle: 'روابط صدرت ولم تُستخدم بعد.',
    empty: 'لا توجد دعوات معلّقة',
    trigger: 'دعوة أشخاص',
    dialogTitle: 'دعوة إلى {{org}}',
    dialogDescription: 'شارك الرابط المُنشأ. يستطيع كل من يملكه الانضمام بالدور أدناه.',
    email: 'تقييد ببريد إلكتروني',
    emailPlaceholder: 'اتركه فارغًا لرابط قابل للمشاركة',
    emailHint: 'عند تعبئته، لن يستطيع استخدام الرابط سوى ذلك العنوان.',
    orgRole: 'الدور في المؤسسة',
    project: 'منح صلاحية على مشروع',
    projectRole: 'الدور في المشروع',
    expiresIn: 'تنتهي خلال',
    days_zero: 'لا أيام',
    days_one: 'يوم واحد',
    days_two: 'يومان',
    days_few: '{{count}} أيام',
    days_many: '{{count}} يومًا',
    days_other: '{{count}} يوم',
    submit: 'إنشاء الدعوة',
    created: 'تم إنشاء رابط الدعوة.',
    copyLink: 'نسخ رابط الدعوة',
    linkCopied: 'تم نسخ رابط الدعوة.',
    // «إبطال» لا «إلغاء»: «إلغاء» هي Cancel في `common:actions`، وظهورهما معًا
    // في القائمة نفسها يجعل الزرّين يبدوان الزرّ نفسه.
    revoke: 'إبطال',
    revokeTitle: 'إبطال هذه الدعوة؟',
    revokeBody: 'يتوقّف الرابط عن العمل فورًا، ولن يستطيع أحد الانضمام به.',
    revoked: 'تم إبطال الدعوة.',
    expiresOn: 'تنتهي في {{date}}',
    expired: 'منتهية',
    anyone: 'أي شخص يملك الرابط',
    invitedBy: 'دعاه {{name}}',
    invitedByUnknown: 'دعاه مسؤول سابق',
  },

  teams: {
    title: 'الفرق',
    subtitle: 'جمّع الأشخاص للتصفية والتقارير. الفرق لا تمنح صلاحيات.',
    empty: 'لا توجد فرق بعد',
    emptyBody: 'تتيح لك الفرق تجميع الأعضاء ومنح المشروع فريقًا مالكًا.',
    create: 'فريق جديد',
    createTitle: 'إنشاء فريق',
    editTitle: 'إعادة تسمية الفريق',
    name: 'الاسم',
    namePlaceholder: 'المنصّة',
    description: 'الوصف',
    descriptionPlaceholder: 'مسؤوليات هذا الفريق (اختياري)',
    created: 'تم إنشاء الفريق.',
    updated: 'تم تحديث الفريق.',
    deleteTitle: 'حذف {{name}}؟',
    deleteBody: 'يختفي الفريق من التصفية والتقارير. يحتفظ أعضاؤه بصلاحياتهم.',
    deleted: 'تم حذف الفريق.',
    members_zero: 'لا أعضاء',
    members_one: 'عضو واحد',
    members_two: 'عضوان',
    members_few: '{{count}} أعضاء',
    members_many: '{{count}} عضوًا',
    members_other: '{{count}} عضو',
    manageMembers: 'إدارة الأعضاء',
    membersTitle: 'أعضاء {{name}}',
    membersDescription: 'اختر جميع أعضاء هذا الفريق. الحفظ يستبدل القائمة بالكامل.',
    membersSaved: 'تم حفظ قائمة الفريق.',
    noMembers: 'لا أحد في هذا الفريق بعد',
  },

  settings: {
    title: 'إعدادات المؤسسة',
    subtitle: 'الاسم والعنوان ودورة حياة {{org}}.',
    identity: 'الهوية',
    identityDescription: 'كيف تُسمّى هذه المؤسسة ويُشار إليها.',
    name: 'الاسم',
    slug: 'العنوان',
    slugHint: 'يُستخدم في كل رابط: ‎/o/{{slug}}',
    saved: 'تم تحديث المؤسسة.',
    dangerZone: 'منطقة الخطر',
    dangerDescription: 'حذف المؤسسة يزيل مشاريعها ولوحاتها وسجلّها.',
    delete: 'حذف المؤسسة',
    deleteTitle: 'حذف {{name}}؟',
    deleteBody: 'كل مشروع ولوحة ومهمة وتعليق في هذه المؤسسة سيُحذف معها. لا يمكن التراجع.',
    deleteConfirmHint: 'اكتب اسم المؤسسة للتأكيد.',
    deleted: 'تم حذف المؤسسة.',
    deleteRestricted: 'لا يستطيع حذف المؤسسة سوى مسؤول عام.',
  },

  roles: {
    admin: 'مسؤول',
    member: 'عضو',
    viewer: 'مُطّلِع',
    adminHint: 'تحكّم كامل، بما في ذلك الإعدادات والعضوية.',
    memberHint: 'يستطيع إنشاء العمل وتعديله.',
    viewerHint: 'قراءة فقط.',
  },
} as const;
