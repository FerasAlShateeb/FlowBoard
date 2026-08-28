/**
 * `auth` بالعربية — نظير `locales/en/auth.ts`.
 *
 * المصطلحات والعلامات تتبع المسرد في رأس `locales/ar/common.ts`.
 */
export default {
  login: {
    title: 'تسجيل الدخول إلى FlowBoard',
    subtitle: 'خطّط وتابِع وأطلِق — مع فريقك.',
    email: 'البريد الإلكتروني',
    emailPlaceholder: 'you@company.com',
    password: 'كلمة المرور',
    passwordPlaceholder: 'كلمة المرور الخاصة بك',
    submit: 'تسجيل الدخول',
    submitting: 'جارٍ تسجيل الدخول…',
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
    noAccount: 'لا تملك حسابًا؟ اطلب دعوة من أحد المسؤولين.',
    success: 'أهلًا بعودتك.',
  },

  // رسائل التحقّق من الحقول موجودة في مساحة `validation`.

  errors: {
    invalid_credentials: 'البريد الإلكتروني وكلمة المرور غير متطابقين.',
    account_disabled: 'تم تعطيل هذا الحساب. تواصل مع أحد المسؤولين.',
    rate_limited: 'محاولات كثيرة جدًا. انتظر دقيقة ثم أعد المحاولة.',
    network: 'تعذّر الوصول إلى الخادم. تحقّق من اتصالك وأعد المحاولة.',
    unknown: 'فشل تسجيل الدخول. يُرجى المحاولة مرة أخرى.',
  },

  invite: {
    title: 'الانضمام إلى {{organization}}',
    subtitle: 'دعاك {{name}} للتعاون على FlowBoard.',
    accept: 'قبول الدعوة',
    expired: 'انتهت صلاحية هذه الدعوة.',
    expiredBody: 'اطلب رابطًا جديدًا ممّن دعاك.',
    invalid: 'رابط الدعوة هذا غير صالح.',
    invalidBody: 'تأكّد من نسخ الرابط كاملًا، أو اطلب رابطًا جديدًا.',
    used: 'سبق استخدام هذه الدعوة.',
    usedBody: 'إن كان الحساب لك فسجّل الدخول بدلًا من ذلك.',
    loading: 'جارٍ التحقّق من دعوتك…',
    asRole: 'ستنضمّ بصفة',
    withProject: 'وتنضمّ أيضًا إلى {{project}} بصفة',
    expiresOn: 'صالحة حتى {{date}}',
    lockedTo: 'صادرة إلى {{email}}',
    goToSignIn: 'تسجيل الدخول',

    register: {
      title: 'أنشئ حسابك',
      description: 'اختر اسمًا وكلمة مرور. بريدك الإلكتروني يأتي من الدعوة.',
      name: 'اسمك',
      // اسم مثال لاتيني مقصود: الأسماء في FlowBoard تُكتب بأي أبجدية، والحقل
      // نفسه يعرضها بـ `dir="auto"` فلا ينكسر ترتيبها داخل صفحة عربية.
      namePlaceholder: 'Ada Lovelace',
      password: 'اختر كلمة مرور',
      // الأرقام غربية دائمًا — انظر القاعدة (1) في مسرد `ar/common.ts`.
      passwordPlaceholder: '8 أحرف على الأقل',
      submit: 'إنشاء الحساب والانضمام',
      success: 'أهلًا بك في {{organization}}.',
    },

    attach: {
      title: 'الانضمام باسم {{name}}',
      description: 'أنت مسجّل الدخول بالفعل. القبول يضيف هذه المؤسسة إلى حسابك.',
      submit: 'الانضمام إلى {{organization}}',
      switchAccount: 'لست أنت؟ سجّل الخروج أولًا.',
      success: 'انضممت إلى {{organization}}.',
    },
  },

  session: {
    restoring: 'جارٍ استعادة جلستك…',
    signedOut: 'تم تسجيل خروجك.',
    adminOnly: 'للمسؤولين فقط',
    adminOnlyBody: 'هذه المنطقة مخصّصة للمسؤولين العامّين.',
  },
} as const;
