import { type RouteContext, WorkOSApiError, notFound, parseJsonBody, validationError } from '../../core/index.js';
import type { WorkOSItContact } from '../entities.js';
import { emailsMatch, formatItContact, requireEmailField } from '../helpers.js';
import { getWorkOSStore } from '../store.js';

/** The Admin Portal features an invitation may grant, per `InviteItContactDto`. */
const INVITE_INTENTS = ['sso', 'directory_sync', 'log_streams', 'domain_verification', 'bring_your_own_key'] as const;

export function itContactRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  const requireOrganization = (organizationId: string) => {
    const org = ws.organizations.get(organizationId);
    if (!org) throw notFound('Organization');
    return org;
  };

  /** A contact is only addressable through its own organization; another org's is not found. */
  const requireContact = (organizationId: string, contactId: string): WorkOSItContact => {
    requireOrganization(organizationId);
    const contact = ws.itContacts.get(contactId);
    if (!contact || contact.organization_id !== organizationId) throw notFound('ItContact');
    return contact;
  };

  const activeInvitation = (organizationId: string) =>
    ws.itContacts.findBy('organization_id', organizationId).find((contact) => contact.invited_at !== null);

  app.get('/organizations/:organizationId/it_contacts', (c) => {
    const organizationId = c.req.param('organizationId');
    requireOrganization(organizationId);
    const contacts = ws.itContacts
      .findBy('organization_id', organizationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    // The spec gives this route no pagination parameters, so the whole set is one page and
    // both cursors are null — the envelope is still `list`, which the SDKs deserialize.
    return c.json({
      object: 'list',
      data: contacts.map(formatItContact),
      list_metadata: { before: null, after: null },
    });
  });

  app.post('/organizations/:organizationId/it_contacts', async (c) => {
    const organizationId = c.req.param('organizationId');
    requireOrganization(organizationId);
    const body = await parseJsonBody(c);

    // `requireShape`, because this creates a contact from the address rather than looking one
    // up: a stored typo is an invitation that can never reach anyone.
    const email = requireEmailField(body.email, { requireShape: true });

    // Scoped to the organization: the same address may be an IT contact of several. Matched
    // through `emailsMatch` rather than the collection's email index, because uniqueness is
    // case-insensitive while the address is stored as the caller spelled it.
    const taken = ws.itContacts
      .findBy('organization_id', organizationId)
      .some((existing) => emailsMatch(existing.email, email));
    if (taken) {
      throw new WorkOSApiError(
        409,
        'The email address is already an IT contact of the organization.',
        'it_contact_already_exists',
      );
    }

    const contact = ws.itContacts.insert({
      object: 'it_contact',
      organization_id: organizationId,
      email,
      invited_at: null,
      invite_intents: null,
      invite_setup_link: null,
    });
    return c.json(formatItContact(contact), 201);
  });

  app.delete('/organizations/:organizationId/it_contacts/:contactId', (c) => {
    const contact = requireContact(c.req.param('organizationId'), c.req.param('contactId'));
    // "Remove an IT contact ... and revoke the contact's active setup links" — deleting the
    // record drops its invitation with it, which frees the organization's single active slot.
    ws.itContacts.delete(contact.id);
    return c.body(null, 204);
  });

  app.post('/organizations/:organizationId/it_contacts/:contactId/invite', async (c) => {
    const organizationId = c.req.param('organizationId');
    const contact = requireContact(organizationId, c.req.param('contactId'));
    const body = await parseJsonBody(c);

    const intents = body.intents;
    if (!Array.isArray(intents) || intents.length === 0) {
      throw validationError('intents is required and must be a non-empty array', [
        { field: 'intents', code: 'required' },
      ]);
    }
    const invalid = intents.filter((i) => typeof i !== 'string' || !INVITE_INTENTS.includes(i as never));
    if (invalid.length > 0) {
      throw validationError(`intents must be one of: ${INVITE_INTENTS.join(', ')}`, [
        { field: 'intents', code: 'invalid' },
      ]);
    }
    if (new Set(intents).size !== intents.length) {
      throw validationError('intents must not contain duplicates', [{ field: 'intents', code: 'invalid' }]);
    }

    // "An organization can have at most one active invitation" — so a second contact conflicts,
    // but re-inviting the one that already holds it refreshes their link and leaves the count
    // at one, which is the resend a caller reaches for when the first email goes astray.
    const active = activeInvitation(organizationId);
    if (active && active.id !== contact.id) {
      throw new WorkOSApiError(
        409,
        'Another IT contact invitation is already active for the organization.',
        'it_contact_invitation_already_active',
      );
    }

    // The setup link the invitation would have emailed. Nothing delivers it and no route
    // serves it; it exists so the invitation has the artifact production would have created.
    const baseUrl = new URL(c.req.url).origin;
    // Silent, like the emulator's other non-serialized stamps (`last_used_at`,
    // `last_sign_in_at`): none of this reaches the wire, so `updated_at` must not move and
    // claim the resource changed.
    ws.itContacts.updateSilent(contact.id, {
      invited_at: new Date().toISOString(),
      invite_intents: intents as string[],
      invite_setup_link: `${baseUrl}/portal/setup/${contact.id}`,
    });
    return c.body(null, 204);
  });

  app.post('/organizations/:organizationId/it_contacts/:contactId/revoke', (c) => {
    const organizationId = c.req.param('organizationId');
    requireContact(organizationId, c.req.param('contactId'));
    // The spec revokes "the organization's active Admin Portal invitation", not this contact's:
    // there is at most one, and no route reports which contact holds it, so revoking through a
    // contact that does not hold it still has to clear it — otherwise a caller who cannot know
    // whom to address gets a 204 and stays wedged behind a 409 on the next invite.
    const active = activeInvitation(organizationId);
    if (active) {
      ws.itContacts.updateSilent(active.id, { invited_at: null, invite_intents: null, invite_setup_link: null });
    }
    return c.body(null, 204);
  });
}
