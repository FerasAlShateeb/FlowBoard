// Organization contracts: the top of FlowBoard's hierarchy
// (Organizations -> Teams -> Projects), its two-level membership, and the invite
// rows that let someone in.
//
// Role resolution across the whole product is a strict widening chain:
// global admin > org admin > project role. An org admin is implicitly a project
// admin on every project in the org, which is why project endpoints never need
// an explicit org-admin row.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { booleanQuery, isoDateTime, slugSchema, uuid } from './common';
import { projectRoleSchema } from './projects.schema';
import { emailSchema, nameSchema, userSummarySchema } from './users.schema';
import {
  VM_EXACTLY_ONE_OF_USER_ID_EMAIL,
  VM_PROJECT_ROLE_REQUIRED,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
} from './validation-messages';

/**
 * Organization membership role. `admin` may edit the org, manage members and
 * invites, and administer every project inside it; `member` may see the org and
 * whichever projects they hold a project role on.
 */
export const orgRoleSchema = z.enum(['admin', 'member']);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/** An organization row. `slug` is the `/o/:orgSlug` route segment. */
export const orgSchema = z.object({
  id: uuid,
  name: nameSchema,
  slug: slugSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Org = z.infer<typeof orgSchema>;

/**
 * `GET /orgs` row — an org plus the caller's own role in it, which is what the
 * org switcher and every client-side permission check read.
 */
export const orgWithRoleSchema = orgSchema.extend({
  role: orgRoleSchema,
  memberCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
});
export type OrgWithRole = z.infer<typeof orgWithRoleSchema>;

/**
 * Whose organizations a `GET /orgs` call is asking about.
 *
 * There is exactly ONE option, and that is the point: omitted, the endpoint
 * answers "the orgs you can see", which for a global admin is every org in the
 * deployment. `scope=member` narrows it to "the orgs you are actually a member
 * of" — the server half of view-as-member, so an admin who has switched into a
 * member's view sees the same switcher a member would, not a filtered copy of
 * the admin list. Client-side filtering would be a lie the moment a page
 * refetched.
 *
 * An enum rather than a boolean because `scope=member` is one value of a
 * question ("whose?"), and the next answer — `scope=org-admin`, say — must be
 * addable without inverting a flag.
 */
export const orgListScopeSchema = z.enum(['member']);
export type OrgListScope = z.infer<typeof orgListScopeSchema>;

/**
 * `GET /orgs?q=&scope=&includeDeleted=` — the switcher's search, the view-as
 * narrowing, and the admin Organizations page's archived toggle, on one
 * endpoint.
 *
 * `q` matters past roughly twenty organizations, where the combobox stops being
 * able to render the whole list and starts asking the server. `includeDeleted`
 * is GLOBAL-ADMIN ONLY — soft-deleted orgs are what the restore flow acts on,
 * and a member must never be able to enumerate them; the service enforces that,
 * because a schema cannot know who is asking.
 */
export const orgListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  scope: orgListScopeSchema.optional(),
  includeDeleted: booleanQuery.optional(),
});
export type OrgListQuery = z.infer<typeof orgListQuerySchema>;

/**
 * A row of the ADMIN organizations table (`GET /orgs?includeDeleted=1` under a
 * global admin).
 *
 * Extends {@link orgSchema} rather than {@link orgWithRoleSchema} on purpose: a
 * global admin administers organizations they are not a member of, so `role`
 * has no honest value here — carrying a synthetic `'admin'` would make the
 * client's permission checks agree with a fiction.
 *
 * `deletedAt` is the whole reason this shape exists. The table shows archived
 * organizations behind a toggle so they can be RESTORED, which means the row
 * has to say whether it is archived and when — a list that silently omitted
 * them would leave restore with nothing to act on.
 */
export const orgAdminRowSchema = orgSchema.extend({
  deletedAt: isoDateTime.nullable(),
  memberCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
});
export type OrgAdminRow = z.infer<typeof orgAdminRowSchema>;

/**
 * `GET /orgs/:orgId`, `POST /orgs`, `PATCH /orgs/:orgId` — one org, read on its
 * own page rather than picked out of a list.
 *
 * The only difference from a list row is `teamCount`, and it lives here rather
 * than on {@link orgWithRoleSchema} for a reason: the org switcher renders every
 * org the caller belongs to, and counting teams per row is a subquery per row
 * for a number the switcher never shows. The org HOME page shows all three
 * counts, and it reads exactly one org.
 */
export const orgDetailSchema = orgWithRoleSchema.extend({
  teamCount: z.number().int().nonnegative(),
});
export type OrgDetail = z.infer<typeof orgDetailSchema>;

/**
 * A row of `GET /orgs/:orgId/members`. Carries the email alongside the user
 * summary because the members table shows it and the invite form matches on it —
 * this is the one place the address is legitimately org-visible.
 */
export const orgMemberSchema = z.object({
  orgId: uuid,
  user: userSummarySchema,
  email: emailSchema,
  role: orgRoleSchema,
  joinedAt: isoDateTime,
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

/**
 * A row of `GET /orgs/:orgId/users` — the org directory that feeds assignee
 * pickers and the @mention autocomplete. Same shape as a member row minus the
 * join metadata nobody renders in a picker.
 */
export const orgUserSchema = z.object({
  user: userSummarySchema,
  email: emailSchema,
  role: orgRoleSchema,
});
export type OrgUser = z.infer<typeof orgUserSchema>;

/**
 * `POST /orgs` — global-admin surface (FlowBoard has no self-service org
 * creation).
 *
 * `adminUserId` names the account that becomes the new org's FIRST ADMIN.
 * Omitted, it is the caller — which is what a web client that does not know
 * about the field gets, and what "the creator becomes its first admin" means.
 * It exists because a global admin provisioning an org for somebody else is the
 * normal case, and the alternative (create → add member → promote) is three
 * requests where either of the last two can fail and leave an ownerless org.
 */
export const createOrgInputSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  adminUserId: uuid.optional(),
});
export type CreateOrgInput = z.infer<typeof createOrgInputSchema>;

/** `PATCH /orgs/:orgId` — rename or re-slug; at least one field required. */
export const updateOrgInputSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateOrgInput = z.infer<typeof updateOrgInputSchema>;

/**
 * `POST /orgs/:orgId/members` — add an EXISTING account to the org. Bringing in
 * someone with no account is the invite flow's job, not this one's.
 *
 * IDENTIFIED BY `userId` **XOR** `email`, exactly one of the two. The members
 * screen matches on the address an admin already has in an email thread, and
 * resolving it client-side would need a lookup endpoint that leaks whether an
 * address has an account. Accepting BOTH is refused rather than tie-broken: a
 * request whose two halves disagree has no correct answer.
 */
export const addMemberInputSchema = z
  .object({
    userId: uuid.optional(),
    email: emailSchema.optional(),
    role: orgRoleSchema.default('member'),
  })
  .refine((value) => (value.userId === undefined) !== (value.email === undefined), {
    message: VM_EXACTLY_ONE_OF_USER_ID_EMAIL,
    path: ['userId'],
  });
export type AddMemberInput = z.infer<typeof addMemberInputSchema>;

/** `PATCH /orgs/:orgId/members/:userId` — promote or demote. */
export const updateMemberInputSchema = z.object({
  role: orgRoleSchema,
});
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;

/**
 * Where an invite is in its life.
 *
 * Carried explicitly rather than re-derived from `expiresAt`, because a client
 * would have to trust its own clock to compute "expired" and could not
 * distinguish "already accepted" at all — and those are different remedies
 * ("ask for a new link" versus "you already have access, sign in").
 */
export const inviteStatusSchema = z.enum(['pending', 'accepted', 'expired']);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

/**
 * An invite row as an org admin sees it (`GET /orgs/:orgId/invites`).
 *
 * `email` is `null` for a shareable link and set to lock the invite to one
 * address. `projectId`/`projectRole` are the optional direct project grant, so a
 * single link can drop someone straight into a project as a viewer.
 */
export const inviteSchema = z.object({
  id: uuid,
  orgId: uuid,
  email: emailSchema.nullable(),
  orgRole: orgRoleSchema,
  projectId: uuid.nullable(),
  projectRole: projectRoleSchema.nullable(),
  /** The URL-safe secret; only ever returned to the admin who created it. */
  token: z.string().min(8),
  expiresAt: isoDateTime,
  acceptedAt: isoDateTime.nullable(),
  /**
   * NULLABLE: `invites.invited_by_id` is `ON DELETE SET NULL`, so an invite
   * outlives the admin who minted it. Widening here is the honest mapping —
   * narrowing the column would make deactivating an admin delete their
   * outstanding links.
   */
  createdBy: userSummarySchema.nullable(),
  createdAt: isoDateTime,
});
export type Invite = z.infer<typeof inviteSchema>;

/** `POST /orgs/:orgId/invites` — mint an invite link. */
export const createInviteInputSchema = z
  .object({
    email: emailSchema.nullable().default(null),
    orgRole: orgRoleSchema.default('member'),
    projectId: uuid.nullable().default(null),
    projectRole: projectRoleSchema.nullable().default(null),
    /** Link lifetime; the row is rejected after this many days. */
    expiresInDays: z.number().int().min(1).max(90).default(7),
  })
  .refine((value) => value.projectId === null || value.projectRole !== null, {
    message: VM_PROJECT_ROLE_REQUIRED,
    path: ['projectRole'],
  });
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;
