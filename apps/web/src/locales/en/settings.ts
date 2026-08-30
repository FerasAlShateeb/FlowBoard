/**
 * `settings` — the two settings surfaces that are not the workflow editor:
 * the signed-in user's own profile (`/me`) and a project's General / Members /
 * Labels tabs.
 *
 * The workflow tab has its own namespace (`workflow`) because it is the largest
 * editor in the product and shares nothing with these.
 */
export default {
  /** `/me` — profile and credentials. */
  profile: {
    title: 'My profile',
    subtitle: 'How you appear to your team, and how you sign in.',
    account: 'Account',
    accountDescription: 'Your name and picture appear on every task you touch.',
    name: 'Display name',
    namePlaceholder: 'Ada Lovelace',
    email: 'Email',
    emailHint: 'Your sign-in address. Only an administrator can change it.',
    avatarUrl: 'Avatar URL',
    avatarPlaceholder: 'https://example.com/you.png',
    avatarHint: 'Leave empty to show your initials.',
    locale: 'Language',
    localeHint:
      'Saved to your account, so it follows you to another device. The topbar switch only changes this browser.',
    saved: 'Profile updated.',
    globalAdmin: 'Global administrator',
    memberSince: 'Member since {{date}}',
  },

  /**
   * The Motion card on `/me` — `lib/motion-policy`'s user-facing switch.
   *
   * The hints carry the whole argument for the three-way choice, so they are
   * copy, not decoration: "Full" has to say that it wins over the OS, and
   * "Reduced" has to promise that nothing disappears — otherwise the setting
   * reads as "hide things", which is exactly what it does not do.
   */
  motion: {
    title: 'Motion',
    subtitle: 'How much the interface moves when it changes.',
    label: 'Animation',
    options: {
      full: {
        label: 'Full',
        hint: 'Menus, panels and page changes animate. This is the default, even if your system asks for less.',
      },
      reduced: {
        label: 'Reduced',
        hint: 'Movement is removed. Nothing is hidden — loading placeholders and busy indicators stay.',
      },
      system: {
        label: 'Follow system',
        hint: 'Use this device’s own “reduce motion” accessibility setting, and follow it if it changes.',
      },
    },
    deviceNote: 'Saved to this browser, not to your account.',
  },

  /** The change-password card on `/me`. */
  password: {
    title: 'Password',
    description: 'Changing your password signs you out everywhere else.',
    current: 'Current password',
    next: 'New password',
    confirm: 'Confirm new password',
    mismatch: 'Those passwords do not match.',
    submit: 'Change password',
    changed: 'Password changed.',
  },

  /** Project settings → General. */
  project: {
    title: 'General',
    subtitle: 'Identity and ownership for {{project}}.',
    identity: 'Identity',
    identityDescription: 'How this project is named and who owns it.',
    name: 'Name',
    key: 'Key',
    keyHint: 'Baked into every task key, so it cannot be changed.',
    description: 'Description',
    descriptionPlaceholder: 'What this project is for (optional)',
    lead: 'Project lead',
    team: 'Owning team',
    none: 'None',
    saved: 'Project updated.',
    dangerZone: 'Danger zone',
    dangerDescription: 'Deleting a project removes its board, backlog and every task on it.',
    delete: 'Delete project',
    deleteTitle: 'Delete {{name}}?',
    deleteBody:
      'Every task, comment and attachment in this project goes with it. This cannot be undone.',
    deleted: 'Project deleted.',
    readOnly: 'You need project admin rights to change these settings.',
  },

  /** Project settings → Members. */
  members: {
    title: 'Members',
    subtitle: 'Who can open {{project}}, and what they may do.',
    empty: 'No members yet',
    emptyBody: 'Add someone from the organization to give them access.',
    add: 'Add member',
    addTitle: 'Add a project member',
    addDescription: 'Pick someone from the organization and choose what they may do here.',
    person: 'Person',
    role: 'Role',
    added: '{{name}} was added.',
    roleChanged: '{{name}} is now a {{role}}.',
    removeTitle: 'Remove {{name}} from this project?',
    removeBody: 'They lose access to this project. Organization admins keep theirs regardless.',
    removed: '{{name}} was removed.',
    columnMember: 'Member',
    columnRole: 'Role',
    columnJoined: 'Joined',
    inheritedNote: 'Organization admins can always administer this project.',
  },

  /** Project settings → Labels. */
  labels: {
    title: 'Labels',
    subtitle: 'The tag vocabulary for {{project}}. Labels are per project.',
    empty: 'No labels yet',
    emptyBody: 'Labels help you slice a board — “needs design”, “tech debt”, “customer”.',
    create: 'New label',
    createTitle: 'Create a label',
    editTitle: 'Edit label',
    name: 'Name',
    namePlaceholder: 'tech-debt',
    color: 'Color',
    colorPick: 'Pick colour {{name}}',
    created: 'Label created.',
    updated: 'Label updated.',
    deleteTitle: 'Delete {{name}}?',
    deleteBody: 'The label is removed from every task that carries it.',
    deleted: 'Label deleted.',
  },

  /** Colour names for the label swatch picker (accessible names, not copy). */
  colors: {
    slate: 'Slate',
    red: 'Red',
    orange: 'Orange',
    amber: 'Amber',
    green: 'Green',
    teal: 'Teal',
    blue: 'Blue',
    indigo: 'Indigo',
    violet: 'Violet',
    pink: 'Pink',
  },
} as const;
