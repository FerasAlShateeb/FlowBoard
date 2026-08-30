/**
 * `analytics` بالعربية — نظير `locales/en/analytics.ts` مفتاحًا بمفتاح. انظر
 * الملف الإنجليزي لمعرفة ما تملكه مساحة الأسماء هذه ولماذا هي منفصلة عن
 * `admin`.
 *
 * ═══ المصطلحات المضافة إلى مسرد `locales/ar/common.ts` ═════════════════════
 *
 *   analytics        التحليلات          metric           مقياس
 *   drill-down       التفصيل            bucket           فترة
 *   engagement       التفاعل            growth           النمو
 *   traffic          حركة الطلبات       endpoint         نقطة النهاية
 *   active users     المستخدمون النشطون sign-up          تسجيل
 *   stickiness       معدّل الالتصاق      cycle time       زمن الدورة
 *   error rate       معدّل الأخطاء       percentile       مئين
 *   invite           دعوة               acceptance rate  معدّل القبول
 *
 * المصطلحات الأربعة الأولى في شريط التنقّل (`common:nav.analytics*`) هي
 * المرجع: «التفاعل» و«الإنجاز» و«حركة الطلبات» و«النمو» — تتكرّر هنا حرفيًا،
 * فعنوان الصفحة ورابط العودة إليها لا يجوز أن يختلفا.
 *
 * والقواعد الثلاث من المسرد سارية: الأرقام غربية دائمًا، والعلامات عربية
 * («،» و«؛» و«؟»)، و`FlowBoard` لا تُنقل حرفيًا.
 */
export default {
  title: 'التحليلات',

  card: {
    details: 'التفاصيل',
    openBreakdown: 'فتح تفصيل {{label}}',
  },

  domains: {
    engagement: 'التفاعل',
    work: 'الإنجاز',
    traffic: 'حركة الطلبات',
    growth: 'النمو',
  },

  intervals: {
    hour: 'ساعة',
    day: 'يوم',
    week: 'أسبوع',
    month: 'شهر',
  },

  units: {
    hours: 'ساعة',
  },

  chart: {
    summary: '{{title}} — {{buckets}} من الفترات. {{series}}',
    summarySeries: '{{label}}: الأحدث {{latest}}، والذروة {{peak}}.',
    empty: {
      title: 'لا شيء في هذا المدى',
      message: 'كل فترة في المدى المحدَّد تساوي صفرًا. جرّب مدى أوسع.',
    },
  },

  autoRefresh: {
    label: 'تحديث تلقائي',
    hint: 'إعادة قراءة هذه الصفحة كل 30 ثانية.',
  },

  series: {
    activeUsers: 'المستخدمون النشطون',
    signups: 'التسجيلات',
    stickiness: 'معدّل الالتصاق',
    events: 'الأحداث',
    tasksCreated: 'أُنشئت',
    tasksCompleted: 'اكتملت',
    cycleTime: 'زمن الدورة',
    points: 'النقاط',
    requests: 'الطلبات',
    errors: 'الأخطاء',
    errorRate: 'معدّل الأخطاء',
    milliseconds: 'زمن الاستجابة',
    responses: 'الاستجابات',
    orgs: 'المؤسسات',
    invitesSent: 'مُرسَلة',
    invitesAccepted: 'مقبولة',
    tasks: 'المهام',
  },

  columns: {
    bucket: 'الفترة',
    utcHour: 'الساعة (UTC)',
    activeUsers: 'المستخدمون النشطون',
    signups: 'التسجيلات',
    stickiness: 'معدّل الالتصاق',
    eventType: 'الحدث',
    // المعرّف البرمجي بجانب الاسم المترجَم — انظر النسخة الإنجليزية.
    eventTypeId: 'معرّف الحدث',
    events: 'الأحداث',
    share: 'الحصّة',
    tasksCreated: 'أُنشئت',
    tasksCompleted: 'اكتملت',
    cycleTime: 'زمن الدورة',
    points: 'النقاط',
    project: 'المشروع',
    projectKey: 'المفتاح',
    org: 'المؤسسة',
    orgSlug: 'المعرّف',
    requests: 'الطلبات',
    errors: 'الأخطاء',
    errorRate: 'معدّل الأخطاء',
    percentile: 'المئين',
    duration: 'المدّة',
    method: 'الطريقة',
    path: 'المسار',
    avg: 'المتوسط',
    statusClass: 'الفئة',
    responses: 'الاستجابات',
    members: 'الأعضاء',
    projects: 'المشاريع',
    tasks: 'المهام',
    lastActivity: 'آخر نشاط',
    orgsCreated: 'المؤسسات',
    invitesSent: 'مُرسَلة',
    invitesAccepted: 'مقبولة',
  },

  filters: {
    eventType: 'نوع الحدث',
    org: 'المؤسسة',
    method: 'الطريقة',
    statusClass: 'فئة الحالة',
  },

  metrics: {
    engagement: {
      dau: {
        title: 'المستخدمون النشطون يوميًا',
        subtitle: 'عدد الأشخاص المختلفين الذين سجّلوا أي نشاط في كل فترة.',
      },
      signups: {
        title: 'التسجيلات',
        subtitle: 'الحسابات المُنشأة في كل فترة.',
      },
      stickiness: {
        title: 'معدّل الالتصاق',
        subtitle: 'النشطون يوميًا مقسومون على النشطين شهريًا — أي نسبة القاعدة التي تحضر.',
      },
      'activity-by-hour': {
        title: 'النشاط بحسب الساعة',
        subtitle: 'متى ينشط هذا التثبيت فعلًا، بتوقيت UTC.',
      },
      'events-by-type': {
        title: 'الأحداث بحسب النوع',
        subtitle: 'ماذا فعل المستخدمون، بحسب نوع الحدث المسجَّل.',
      },
    },
    work: {
      'tasks-created': {
        title: 'المهام المُنشأة',
        subtitle: 'كل مهمة فُتحت في كل مشاريع هذا التثبيت.',
      },
      'tasks-completed': {
        title: 'المهام المكتملة',
        subtitle: 'المهام التي بلغت حالة منجَز في كل فترة.',
      },
      'cycle-time': {
        title: 'زمن الدورة',
        subtitle: 'متوسط الساعات من فتح المهمة إلى إنجازها.',
      },
      'points-completed': {
        title: 'النقاط المنجَزة',
        subtitle: 'نقاط القصة المُسلَّمة في كل فترة.',
      },
      'by-project': {
        title: 'الإنجاز بحسب المشروع',
        subtitle: 'كل مشروع تحرّك في هذا المدى، وبأي قدر.',
      },
    },
    traffic: {
      requests: {
        title: 'الطلبات',
        subtitle: 'طلبات HTTP التي خدمتها الواجهة البرمجية في كل فترة.',
      },
      errors: {
        title: 'الأخطاء',
        subtitle: 'استجابات 4xx و5xx في كل فترة.',
      },
      'error-rate': {
        title: 'معدّل الأخطاء',
        subtitle: 'حصّة الاستجابات الفاشلة من حركة الفترة.',
      },
      latency: {
        title: 'زمن الاستجابة',
        subtitle: 'سلّم المئينات على المدى كاملًا، بالمللي ثانية.',
      },
      'top-endpoints': {
        title: 'أكثر نقاط النهاية ازدحامًا',
        subtitle: 'بحسب عدد الطلبات، مع متوسط المدّة وحصّة الأخطاء لكل منها.',
      },
      'status-breakdown': {
        title: 'فئات الحالة',
        subtitle: 'كيف تتوزّع استجابات المدى على 2xx و3xx و4xx و5xx.',
      },
    },
    growth: {
      'orgs-created': {
        title: 'المؤسسات المُنشأة',
        subtitle: 'المؤسسات الجديدة في كل فترة.',
      },
      'invites-sent': {
        title: 'الدعوات المُرسَلة',
        subtitle: 'الدعوات الصادرة في كل فترة.',
      },
      'invites-accepted': {
        title: 'الدعوات المقبولة',
        subtitle: 'الدعوات التي تحوّلت إلى عضوية.',
      },
      'by-org': {
        title: 'المؤسسات',
        subtitle: 'كل مؤسسة في هذا التثبيت، مع حجمها وآخر نشاط فيها.',
      },
    },
  },

  engagement: {
    title: 'التفاعل',
    subtitle: 'من الحاضر، وكم مرّة، ومتى.',
    loadError: 'تعذّر تحميل أرقام التفاعل.',
    empty: {
      title: 'لا نشاط في هذا المدى',
      message: 'لم يُسجَّل أي شيء في المدى المحدَّد. جرّب مدى أوسع.',
    },
    kpis: {
      dau: 'النشطون يوميًا',
      dauCaption: 'أحدث فترة.',
      mau: 'النشطون شهريًا',
      mauCaption: 'الأشخاص المختلفون خلال آخر 30 يومًا.',
      signups: 'التسجيلات',
      signupsCaption: 'الإجمالي في المدى المحدَّد.',
      stickiness: 'معدّل الالتصاق',
      stickinessCaption: 'النشطون يوميًا مقسومون على النشطين شهريًا.',
    },
    charts: {
      dau: {
        title: 'المستخدمون النشطون يوميًا',
        subtitle: 'عدد الأشخاص المختلفين في كل {{interval}}.',
      },
      signups: {
        title: 'التسجيلات',
        subtitle: 'الحسابات الجديدة في كل {{interval}}.',
      },
      activityByHour: {
        title: 'النشاط بحسب الساعة',
        subtitle: 'كل أحداث المدى، موزّعة على ساعات اليوم بتوقيت UTC.',
      },
      eventsByType: {
        title: 'الأحداث بحسب النوع',
        subtitle: 'مزيج الأحداث على المدى كاملًا.',
      },
    },
  },

  work: {
    title: 'الإنجاز',
    subtitle: 'ما يُسلّمه هذا التثبيت، عبر كل مشاريعه.',
    loadError: 'تعذّر تحميل أرقام الإنجاز.',
    empty: {
      title: 'لا عمل في هذا المدى',
      message: 'لم تُفتح أي مهمة ولم تُنجَز أي مهمة في المدى المحدَّد.',
    },
    kpis: {
      created: 'المهام المُنشأة',
      createdCaption: 'الإجمالي في المدى المحدَّد.',
      completed: 'المهام المكتملة',
      completedCaption: 'الإجمالي في المدى المحدَّد.',
      completionRate: 'معدّل الإنجاز',
      completionRateCaption: 'المكتملة مقسومة على المُنشأة في هذا المدى.',
      points: 'النقاط المنجَزة',
      pointsCaption: 'نقاط القصة المُسلَّمة في هذا المدى.',
    },
    charts: {
      flow: {
        title: 'المُنشأة مقابل المكتملة',
        subtitle: 'السلسلتان في كل {{interval}} — واتّساع الفجوة يعني قائمة أعمال متضخّمة.',
      },
      cycleTime: {
        title: 'زمن الدورة',
        subtitle: 'متوسط ساعات الإنجاز في كل {{interval}}.',
        /**
         * كل زوج داخل عازل اتجاهي (`FSI`…`PDI`) — W3.2.
         *
         * القيمة تصل مركّبة («190 ساعة»): رقم غربي ثم كلمة عربية. داخل فقرة
         * اتجاهها RTL كانت خوارزمية bidi تفصل التسمية اللاتينية `p50` عن قيمتها
         * فيظهر السطر «190 p50 ساعة» — ثلاثة مئينات وثلاث قيم بلا اقتران
         * واضح، وهو أسوأ من عدم عرضها. علامة RLM التي كانت هنا سبّبت المشكلة
         * لا حلّها.
         *
         * `\u2068` (FIRST STRONG ISOLATE) يفتح مقطعًا يأخذ اتجاهه من أول حرف
         * قويّ فيه — وهو `p` — فيُرسم «p50 190 ساعة» وحدةً واحدة من اليسار،
         * و`\u2069` (POP DIRECTIONAL ISOLATE) يغلقه فتعود الفقرة إلى RTL
         * وتُرتَّب المقاطع الثلاثة من اليمين: p50 أولًا. الفاصل «·» يبقى خارج
         * العوازل لأنه محايد بين مقطعين معزولين.
         *
         * تُكتب العوازل بالهروب (`\u2068`) لا بالحرف نفسه: كلاهما محرف غير
         * مرئي، وحرفٌ لا يُرى في ملف مصدر هو حرفٌ يحذفه أحدهم بلا قصد.
         */
        percentiles: '\u2068p50 {{p50}}\u2069 · \u2068p90 {{p90}}\u2069 · \u2068p95 {{p95}}\u2069',
        percentilesEmpty: 'لم يُنجَز أي شيء في هذا المدى.',
      },
      points: {
        title: 'النقاط المنجَزة',
        subtitle: 'نقاط القصة المُسلَّمة في كل {{interval}}.',
      },
      byProject: {
        title: 'أبرز المشاريع',
        subtitle: 'المشاريع العشرة الأكثر إنجازًا في هذا المدى.',
      },
    },
  },

  traffic: {
    title: 'حركة الطلبات',
    subtitle: 'واجهة HTTP: الحجم والإخفاقات وزمن الاستجابة.',
    loadError: 'تعذّر تحميل أرقام حركة الطلبات.',
    empty: {
      title: 'لا حركة في هذا المدى',
      message: 'لم يُخدَم أي طلب في المدى المحدَّد. جرّب مدى أوسع.',
    },
    kpis: {
      requests: 'الطلبات',
      requestsCaption: 'الإجمالي في المدى المحدَّد.',
      errors: 'الأخطاء',
      errorsCaption: 'استجابات 4xx و5xx.',
      errorRate: 'معدّل الأخطاء',
      errorRateCaption: 'الاستجابات الفاشلة من مجموع الاستجابات.',
      p95: 'المئين 95',
      p95Caption: 'التجربة البطيئة التي يشتكي منها المستخدمون.',
    },
    charts: {
      requests: {
        title: 'الطلبات',
        subtitle: 'الحجم في كل {{interval}}.',
      },
      errors: {
        title: 'الأخطاء',
        subtitle: 'استجابات 4xx و5xx في كل {{interval}}.',
      },
      errorRate: {
        title: 'معدّل الأخطاء',
        subtitle: 'حصّة الإخفاق في كل {{interval}} — وارتفاعها هنا انحدارٌ دائمًا.',
      },
      latency: {
        title: 'زمن الاستجابة',
        subtitle: 'سلّم المئينات على المدى كاملًا.',
        aria: 'مئينات زمن الاستجابة للمدى المحدَّد',
      },
      topEndpoints: {
        title: 'أكثر نقاط النهاية ازدحامًا',
        subtitle: 'بحسب عدد الطلبات.',
        aria: 'أكثر نقاط النهاية ازدحامًا في المدى المحدَّد',
      },
      statusBreakdown: {
        title: 'فئات الحالة',
        subtitle: 'كل استجابات المدى، بحسب الفئة.',
      },
    },
  },

  growth: {
    title: 'النمو',
    subtitle: 'المؤسسات، وكيف ينضمّ الناس إليها.',
    loadError: 'تعذّر تحميل أرقام النمو.',
    empty: {
      title: 'لا شيء لعرضه بعد',
      message: 'لم تُنشأ أي مؤسسة ولم تُرسَل أي دعوة.',
    },
    kpis: {
      orgs: 'المؤسسات المُنشأة',
      orgsCaption: 'الإجمالي في المدى المحدَّد.',
      invitesSent: 'دعوات مُرسَلة',
      invitesSentCaption: 'الإجمالي في المدى المحدَّد.',
      invitesAccepted: 'دعوات مقبولة',
      invitesAcceptedCaption: 'الدعوات التي تحوّلت إلى عضوية.',
      acceptanceRate: 'معدّل القبول',
      acceptanceRateCaption: 'المقبولة مقسومة على المُرسَلة في هذا المدى.',
    },
    charts: {
      orgs: {
        title: 'المؤسسات المُنشأة',
        subtitle: 'المؤسسات الجديدة في كل {{interval}}.',
      },
      invites: {
        title: 'الدعوات',
        subtitle: 'المُرسَلة مقابل المقبولة في كل {{interval}}.',
      },
      byOrg: {
        title: 'المؤسسات',
        subtitle: 'كل مؤسسة في هذا التثبيت — على مدى العمر كلّه لا على المدى المحدَّد.',
        aria: 'كل مؤسسة في هذا التثبيت',
      },
    },
  },

  detail: {
    title: 'المقياس',
    loadError: 'تعذّر تحميل هذا التفصيل.',
    perInterval: 'في كل {{interval}}.',
    chartEmpty: {
      title: 'لا شيء في هذا المدى',
      message: 'كل فترة في المدى المحدَّد تساوي صفرًا.',
    },
    tableEmpty: 'لا صفوف تطابق عوامل التصفية هذه.',
    tableAria: 'تفصيل {{title}}',
    export: 'تصدير CSV',
    exportError: 'تعذّر كتابة ملف التصدير.',
    notFound: {
      title: 'مقياس غير معروف',
      subtitle: 'هذا الرابط لا يشير إلى أي شيء تقيسه وحدة التحكّم.',
      emptyTitle: 'لا يوجد تفصيل بهذا الاسم',
      emptyMessage: 'لا يوجد مقياس باسم «{{metric}}» في لوحة {{domain}}.',
      back: 'العودة إلى التحليلات',
    },
  },

  ops: {
    events: {
      aria: 'أحداث القياس',
      export: 'تصدير CSV',
      exportError: 'تعذّر كتابة ملف التصدير.',
      typeFacet: 'نوع الحدث',
    },
    requests: {
      note: 'انتقل حجم الطلبات وزمن الاستجابة وأكثر نقاط النهاية ازدحامًا إلى لوحة حركة الطلبات، حيث تتشارك مدى زمنيًا واحدًا مع بقية وحدة التحكّم.',
      link: 'فتح لوحة حركة الطلبات',
    },
  },
} as const;
