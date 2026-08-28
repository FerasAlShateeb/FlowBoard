/**
 * `orgs` — everything above a project: the organization picker, the org home
 * project grid, membership and invites, and teams.
 *
 * Project SETTINGS copy lives in `settings`; the workflow editor has its own
 * `workflow` namespace. The split follows the pages, so a Wave-3 agent adding a
 * string knows which file it belongs in without reading either.
 */
export default {
  /** The signed-in landing page: pick an organization, or be sent to the last one. */
  picker: {
    title: 'Choose an organization',
    subtitle: 'You belong to more than one. Pick where you want to work.',
    empty: 'You are not a member of any organization yet',
    emptyBody: 'Ask an administrator to invite you, or create one if you may.',
    members_one: '{{count}} member',
    members_other: '{{count}} members',
    projects_one: '{{count}} project',
    projects_other: '{{count}} projects',
  },

  /** Org home — the project grid. */
  home: {
    title: 'Projects',
    subtitle: 'Everything you can open in {{org}}.',
    empty: 'No projects yet',
    emptyBody: 'Create the first project to start planning work.',
    emptyBodyViewer: 'An organization admin can create the first project here.',
    searchPlaceholder: 'Filter projects…',
    noMatches: 'No project matches that filter',
    lead: 'Lead',
    noLead: 'No lead',
    open: 'Open board',
  },

  /** The create-project dialog, opened from org home by an org admin. */
  createProject: {
    trigger: 'New project',
    title: 'Create a project',
    description: 'A project owns its own board, workflow, backlog and labels.',
    name: 'Name',
    namePlaceholder: 'Payments platform',
    key: 'Key',
    keyHint: 'Prefixes every task: {{key}}-1, {{key}}-2 …',
    keyPlaceholder: 'PAY',
    projectDescription: 'Description',
    descriptionPlaceholder: 'What this project is for (optional)',
    lead: 'Project lead',
    team: 'Owning team',
    none: 'None',
    submit: 'Create project',
    success: 'Project {{key}} created.',
  },

  /** Org members table + role management. */
  members: {
    title: 'Members',
    subtitle: 'Who can see {{org}}, and what they may do.',
    empty: 'No members yet',
    emptyBody: 'Invite someone to get started.',
    searchPlaceholder: 'Search members…',
    columnMember: 'Member',
    columnEmail: 'Email',
    columnRole: 'Role',
    columnJoined: 'Joined',
    columnActions: 'Actions',
    joinedOn: 'Joined {{date}}',
    removeTitle: 'Remove {{name}}?',
    removeBody:
      'They lose access to this organization and every project inside it. Their work stays.',
    removed: '{{name}} was removed.',
    roleChanged: '{{name}} is now an {{role}}.',
    you: 'You',
    lastAdmin: 'An organization needs at least one admin.',
  },

  /** Invitations: the create dialog and the pending list. */
  invites: {
    title: 'Pending invitations',
    subtitle: 'Links that have been issued but not yet redeemed.',
    empty: 'No pending invitations',
    trigger: 'Invite people',
    dialogTitle: 'Invite to {{org}}',
    dialogDescription: 'Share the generated link. Anyone holding it can join with the role below.',
    email: 'Lock to email address',
    emailPlaceholder: 'Leave empty for a shareable link',
    emailHint: 'When set, only that address can redeem the link.',
    orgRole: 'Organization role',
    project: 'Grant access to a project',
    projectRole: 'Project role',
    expiresIn: 'Expires in',
    days_one: '{{count}} day',
    days_other: '{{count}} days',
    submit: 'Create invitation',
    created: 'Invitation link created.',
    copyLink: 'Copy invitation link',
    linkCopied: 'Invitation link copied.',
    revoke: 'Revoke',
    revokeTitle: 'Revoke this invitation?',
    revokeBody: 'The link stops working immediately. Anyone holding it can no longer join.',
    revoked: 'Invitation revoked.',
    expiresOn: 'Expires {{date}}',
    expired: 'Expired',
    anyone: 'Anyone with the link',
    invitedBy: 'Invited by {{name}}',
    invitedByUnknown: 'Invited by a former administrator',
  },

  /** Teams: cards plus the member-set editor. */
  teams: {
    title: 'Teams',
    subtitle: 'Group people for filtering and reporting. Teams do not grant access.',
    empty: 'No teams yet',
    emptyBody: 'Teams let you group members and give a project an owning team.',
    create: 'New team',
    createTitle: 'Create a team',
    editTitle: 'Rename team',
    name: 'Name',
    namePlaceholder: 'Platform',
    description: 'Description',
    descriptionPlaceholder: 'What this team is responsible for (optional)',
    created: 'Team created.',
    updated: 'Team updated.',
    deleteTitle: 'Delete {{name}}?',
    deleteBody: 'The team disappears from filters and reports. Its members keep their access.',
    deleted: 'Team deleted.',
    members_one: '{{count}} member',
    members_other: '{{count}} members',
    manageMembers: 'Manage members',
    membersTitle: 'Members of {{name}}',
    membersDescription: 'Pick everyone on this team. Saving replaces the whole roster.',
    membersSaved: 'Team roster saved.',
    noMembers: 'No one on this team yet',
  },

  /** Org settings: identity and the danger zone. */
  settings: {
    title: 'Organization settings',
    subtitle: 'Name, address and lifecycle for {{org}}.',
    identity: 'Identity',
    identityDescription: 'How this organization is named and addressed.',
    name: 'Name',
    slug: 'Address',
    slugHint: 'Used in every link: /o/{{slug}}',
    saved: 'Organization updated.',
    dangerZone: 'Danger zone',
    dangerDescription: 'Deleting an organization removes its projects, boards and history.',
    delete: 'Delete organization',
    deleteTitle: 'Delete {{name}}?',
    deleteBody:
      'Every project, board, task and comment in this organization goes with it. This cannot be undone.',
    deleteConfirmHint: 'Type the organization name to confirm.',
    deleted: 'Organization deleted.',
    deleteRestricted: 'Only a global administrator can delete an organization.',
  },

  /** Shared role vocabulary — used by badges, selects and toasts. */
  roles: {
    admin: 'Admin',
    member: 'Member',
    viewer: 'Viewer',
    adminHint: 'Full control, including settings and membership.',
    memberHint: 'Can create and change work.',
    viewerHint: 'Read-only.',
  },
} as const;
