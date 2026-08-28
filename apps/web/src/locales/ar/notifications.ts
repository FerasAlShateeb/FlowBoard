/**
 * `notifications` بالعربية — نظير `locales/en/notifications.ts` مفتاحًا بمفتاح.
 *
 * الإنجليزية تملك شكل المفاتيح وهي لغة الرجوع، و`i18n/locales.test.ts` يمنع أي
 * اختلاف في المفاتيح بين الملفين.
 *
 * قاعدة الصياغة: كل سطر جملة واحدة تسمّي الفاعل والشيء ("علّق أحمد على
 * FLOW-142")، وتبدأ بالفعل كما تقتضي العربية — لا ترجمة حرفية لترتيب الكلمات
 * الإنجليزي. مفتاح المهمة (`{{task}}`) يبقى لاتينيًا لأنه معرّف، ويُغلّف في
 * الواجهة بعنصر `dir="ltr"` حتى لا ينكسر ترتيبه داخل السطر العربي.
 *
 * لا توجد صيغ جمع i18next هنا: للعربية ست فئات جمع مقابل اثنتين للإنجليزية،
 * فالأعداد تُعرض رقمًا مجردًا مع اسم وصفي.
 */
export default {
  title: 'الإشعارات',
  description: 'كل ما جرى على العمل الذي تتابعه.',

  bell: {
    label: 'الإشعارات',
    unreadLabel: 'الإشعارات، غير المقروءة: {{count}}',
    // أرقام غربية كبقية المنتج — الشارة نفسها `dir="ltr"` فلا ينقلب الترتيب.
    overflow: '99+',
    heading: 'الإشعارات',
    viewAll: 'عرض الكل',
    empty: 'لا جديد',
  },

  tabs: {
    all: 'الكل',
    unread: 'غير المقروءة',
  },

  actions: {
    markAllRead: 'تعليم الكل كمقروء',
    markRead: 'تعليم كمقروء',
    loadMore: 'تحميل المزيد',
    open: 'فتح {{task}}',
  },

  groups: {
    today: 'اليوم',
    yesterday: 'أمس',
  },

  sentence: {
    task_assigned: 'أسند {{actor}} إليك المهمة {{task}}',
    mentioned: 'أشار {{actor}} إليك في {{task}}',
    status_changed: 'نقل {{actor}} المهمة {{task}} إلى حالة جديدة',
    comment_added: 'علّق {{actor}} على {{task}}',
    sprint_started: 'بدأ {{actor}} السباق {{sprint}}',
    sprint_completed: 'أنهى {{actor}} السباق {{sprint}}',
    due_soon: 'يقترب تاريخ استحقاق {{task}}',
  },

  fallback: {
    someone: 'أحدهم',
    aTask: 'مهمة',
    aSprint: 'سباق',
  },

  states: {
    loading: 'جارٍ تحميل الإشعارات…',
    emptyTitle: 'لا توجد إشعارات بعد',
    emptyBody: 'حين يُسند إليك أحدهم عملًا أو يشير إليك أو يعلّق على مهمة تتابعها، سيظهر ذلك هنا.',
    emptyUnreadTitle: 'لا يوجد ما لم تقرأه',
    emptyUnreadBody: 'قرأت كل الإشعارات.',
    errorTitle: 'تعذّر تحميل إشعاراتك',
  },

  unread: 'غير مقروء',
  markedAllRead: 'تم تعليم كل الإشعارات كمقروءة.',
} as const;
