/**
 * `calendar` بالعربية — نظير `locales/en/calendar.ts` مفتاحًا بمفتاح.
 *
 * أسماء الأيام والأشهر وأرقام الأيام لا تُترجم هنا: تولّدها `Intl` من
 * `getIntlLocale()` داخل `components/calendar/calendar-dates.ts`. الأرقام تبقى
 * غربية (`ar-u-nu-latn`) — انظر `lib/lang-policy.ts`.
 *
 * الاتجاه: الشبكة تنعكس تلقائيًا عبر الخصائص المنطقية، ويبدأ الأسبوع من السبت
 * في العربية (`weekStartFor`).
 */
export default {
  title: 'التقويم',

  views: {
    label: 'طريقة عرض التقويم',
    month: 'شهر',
    week: 'أسبوع',
  },

  nav: {
    previous: 'الفترة السابقة',
    next: 'الفترة التالية',
    today: 'اليوم',
  },

  // فئات CLDR الستّ كاملة لكل مفتاح جمع — انظر رأس `locales/ar/orgs.ts`.
  grid: {
    more_zero: 'لا مزيد',
    more_one: '+{{count}} أخرى',
    more_two: '+{{count}} أخرى',
    more_few: '+{{count}} أخرى',
    more_many: '+{{count}} أخرى',
    more_other: '+{{count}} أخرى',
  },

  chip: {
    due: 'الاستحقاق {{date}}',
    starts: 'يبدأ {{date}}',
    undated: 'بلا تواريخ',
    points_zero: 'بلا نقاط',
    points_one: 'نقطة واحدة',
    points_two: 'نقطتان',
    points_few: '{{count}} نقاط',
    points_many: '{{count}} نقطة',
    points_other: '{{count}} نقطة',
  },

  actions: {
    moveTo: 'نقل إلى…',
  },

  states: {
    empty: 'لا شيء مجدول هنا',
    emptyBody:
      'لا توجد مهمة تبدأ أو تستحق في هذه الفترة. اسحب مهمة من لوحة غير المجدولة، أو انتقل إلى شهر آخر.',
  },

  tray: {
    title: 'غير مجدولة',
    hide: 'إخفاء غير المجدولة',
    empty: 'كل المهام لها تواريخ',
    emptyBody: 'تتجمّع هنا المهام التي لا تحمل تاريخ بدء أو استحقاق.',
    scheduleToday: 'جدولة لليوم',
    hint: 'اسحب مهمة إلى أحد الأيام لجدولتها.',
  },

  toast: {
    rescheduled: 'تمت إعادة جدولة {{key}}',
  },

  a11y: {
    day: '{{date}}',
    showWeek: 'عرض أسبوع {{date}}',
    weekGrid: 'مهام هذا الأسبوع',
    resizeStart: 'اسحب لتغيير تاريخ البدء',
    resizeEnd: 'اسحب لتغيير تاريخ الاستحقاق',
  },

  // سرد قارئ الشاشة أثناء إعادة الجدولة بالسحب — انظر النسخة الإنجليزية.
  dnd: {
    instructions:
      'اضغط مسافة لالتقاط المهمة، واستخدم مفاتيح الأسهم لتحريكها عبر التقويم، ثم اضغط مسافة لإفلاتها على أحد الأيام. اضغط Escape للإلغاء.',
    picked: 'تم التقاط {{key}}.',
    over: '{{key}} الآن فوق {{day}}.',
    dropped: 'تم إفلات {{key}} على {{day}}.',
    cancelled: 'تم الإلغاء. بقيت تواريخ {{key}} كما هي.',
  },
} as const;
