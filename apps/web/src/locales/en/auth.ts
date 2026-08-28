/**
 * `auth` — the sign-in surface and the invite-acceptance flow.
 *
 * FlowBoard has NO self-registration (plan §Accounts): accounts are
 * admin-provisioned or created by redeeming an invite link. So there is no
 * "create an account" copy here, and the login page must not imply one exists.
 *
 * `errors.*` are keyed by the API's stable envelope `error.code`, lower-cased.
 * `LoginPage` maps `ApiError.code` through this map and falls back to
 * `errors.unknown`, which is what keeps English server messages off the screen.
 */
export default {
  login: {
    title: 'Sign in to FlowBoard',
    subtitle: 'Plan, track, and ship — with your team.',
    email: 'Email',
    emailPlaceholder: 'you@company.com',
    password: 'Password',
    passwordPlaceholder: 'Your password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    noAccount: 'No account? Ask an administrator for an invite.',
    success: 'Welcome back.',
  },

  // Field-level validation copy lives in the `validation` namespace, keyed by
  // `@flowboard/shared`'s message constants — the sign-in form validates with
  // the shared `loginInputSchema`, so its errors are the shared ones.

  errors: {
    invalid_credentials: 'That email and password do not match.',
    account_disabled: 'This account has been deactivated. Contact an administrator.',
    rate_limited: 'Too many attempts. Wait a minute and try again.',
    network: 'Could not reach the server. Check your connection and try again.',
    unknown: 'Sign-in failed. Please try again.',
  },

  /**
   * The invite landing page (`/invite/:token`) — public, and the ONLY way an
   * account comes into existence besides admin provisioning.
   *
   * It renders one of two forms, decided by the preview's `requiresAccount`
   * flag: `register.*` for a stranger creating their account, `attach.*` for
   * someone already signed in adding an organization to theirs.
   */
  invite: {
    title: 'Join {{organization}}',
    subtitle: '{{name}} invited you to collaborate on FlowBoard.',
    accept: 'Accept invitation',
    expired: 'This invitation has expired.',
    expiredBody: 'Ask whoever invited you for a fresh link.',
    invalid: 'This invitation link is not valid.',
    invalidBody: 'Check that you copied the whole link, or ask for a new one.',
    used: 'This invitation has already been used.',
    usedBody: 'If the account is yours, sign in instead.',
    loading: 'Checking your invitation…',
    asRole: 'You will join as',
    withProject: 'Also joining {{project}} as',
    expiresOn: 'Valid until {{date}}',
    lockedTo: 'Issued to {{email}}',
    goToSignIn: 'Sign in',

    register: {
      title: 'Create your account',
      description: 'Pick a name and a password. Your email comes from the invitation.',
      name: 'Your name',
      namePlaceholder: 'Ada Lovelace',
      password: 'Choose a password',
      passwordPlaceholder: 'At least 8 characters',
      submit: 'Create account and join',
      success: 'Welcome to {{organization}}.',
    },

    attach: {
      title: 'Join as {{name}}',
      description: 'You are signed in. Accepting adds this organization to your account.',
      submit: 'Join {{organization}}',
      switchAccount: 'Not you? Sign out first.',
      success: 'You joined {{organization}}.',
    },
  },

  session: {
    restoring: 'Restoring your session…',
    signedOut: 'You are signed out.',
    /** Shown in place of an admin page when the account is not a global admin. */
    adminOnly: 'Administrators only',
    adminOnlyBody: 'This area is reserved for global administrators.',
  },
} as const;
