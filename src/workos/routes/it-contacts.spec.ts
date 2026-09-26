import { describe, it, expect, beforeEach } from 'bun:test';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('IT contacts', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: ReturnType<typeof createTestApp>['store'];
  let organizationId: string;

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  beforeEach(async () => {
    const testApp = createTestApp();
    app = testApp.app;
    store = testApp.store;
    const org = await json(await req('/organizations', { method: 'POST', body: JSON.stringify({ name: 'Acme' }) }));
    organizationId = org.id;
  });

  const create = (email: string) =>
    req(`/organizations/${organizationId}/it_contacts`, { method: 'POST', body: JSON.stringify({ email }) });
  const invite = (contactId: string, intents: unknown = ['sso']) =>
    req(`/organizations/${organizationId}/it_contacts/${contactId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ intents }),
    });

  it('creates a contact with the spec shape', async () => {
    const res = await create('it@acme.com');
    expect(res.status).toBe(201);
    const contact = await json(res);
    expect(contact.object).toBe('it_contact');
    expect(contact.id).toMatch(/^it_contact_/);
    expect(contact.email).toBe('it@acme.com');
    // The owning organization is addressed by route, not carried on the resource.
    expect(contact.organization_id).toBeUndefined();
  });

  it('lists contacts oldest first in a list envelope', async () => {
    const first = await json(await create('first@acme.com'));
    const second = await json(await create('second@acme.com'));
    getWorkOSStore(store).itContacts.updateSilent(second.id, { created_at: '2020-01-01T00:00:00.000Z' });

    const res = await req(`/organizations/${organizationId}/it_contacts`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.object).toBe('list');
    expect(body.list_metadata).toEqual({ before: null, after: null });
    expect(body.data.map((c: any) => c.id)).toEqual([second.id, first.id]);
  });

  it('rejects a duplicate email within the organization, case-insensitively', async () => {
    expect((await create('dupe@acme.com')).status).toBe(201);
    const conflict = await create('DUPE@acme.com');
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).code).toBe('it_contact_already_exists');
  });

  it('allows the same email in a different organization', async () => {
    await create('shared@acme.com');
    const other = await json(await req('/organizations', { method: 'POST', body: JSON.stringify({ name: 'Other' }) }));
    const res = await req(`/organizations/${other.id}/it_contacts`, {
      method: 'POST',
      body: JSON.stringify({ email: 'shared@acme.com' }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects a missing or malformed email', async () => {
    const post = (body: unknown) =>
      req(`/organizations/${organizationId}/it_contacts`, { method: 'POST', body: JSON.stringify(body) });
    expect((await post({})).status).toBe(422);
    expect((await post({ email: '   ' })).status).toBe(422);
    expect((await post({ email: 'not-an-email' })).status).toBe(422);
  });

  it('invites a contact and records the invitation', async () => {
    const contact = await json(await create('it@acme.com'));
    const res = await invite(contact.id, ['sso', 'directory_sync']);
    expect(res.status).toBe(204);

    // None of the invitation state is on the wire; the spec documents no such fields.
    const stored = getWorkOSStore(store).itContacts.get(contact.id)!;
    expect(stored.invited_at).not.toBeNull();
    expect(stored.invite_intents).toEqual(['sso', 'directory_sync']);
    expect(stored.invite_setup_link).toContain(contact.id);
    const listed = (await json(await req(`/organizations/${organizationId}/it_contacts`))).data[0];
    expect(Object.keys(listed).sort()).toEqual(['created_at', 'email', 'id', 'object', 'updated_at']);
  });

  it('allows only one active invitation per organization', async () => {
    const first = await json(await create('first@acme.com'));
    const second = await json(await create('second@acme.com'));

    expect((await invite(first.id)).status).toBe(204);
    // Another contact, and the same contact again, are the same conflict.
    const conflict = await invite(second.id);
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).code).toBe('it_contact_invitation_already_active');

    // Revoking frees the slot.
    expect(
      (await req(`/organizations/${organizationId}/it_contacts/${first.id}/revoke`, { method: 'POST' })).status,
    ).toBe(204);
    expect((await invite(second.id)).status).toBe(204);
  });

  it('re-invites the holder to refresh their link, leaving the count at one', async () => {
    const first = await json(await create('first@acme.com'));
    const second = await json(await create('second@acme.com'));
    await invite(first.id, ['sso']);
    const before = getWorkOSStore(store).itContacts.get(first.id)!.invite_setup_link;

    // The organization still has exactly one invitation, so this is a resend, not a conflict.
    expect((await invite(first.id, ['directory_sync'])).status).toBe(204);
    const after = getWorkOSStore(store).itContacts.get(first.id)!;
    expect(after.invite_intents).toEqual(['directory_sync']);
    expect(after.invite_setup_link).toBe(before);
    // And the slot is still taken against anyone else.
    expect((await invite(second.id)).status).toBe(409);
  });

  it("revokes the organization's invitation through a contact that does not hold it", async () => {
    const holder = await json(await create('holder@acme.com'));
    const other = await json(await create('other@acme.com'));
    await invite(holder.id);

    // No route reports which contact holds the invitation, so revoking through any of them
    // has to clear it — otherwise the caller gets a 204 and stays wedged.
    const res = await req(`/organizations/${organizationId}/it_contacts/${other.id}/revoke`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(getWorkOSStore(store).itContacts.get(holder.id)?.invited_at).toBeNull();
    expect((await invite(other.id)).status).toBe(204);
  });

  it('revokes with no active invitation as a no-op, without touching the record', async () => {
    const contact = await json(await create('it@acme.com'));
    const before = getWorkOSStore(store).itContacts.get(contact.id)!.updated_at;

    const res = await req(`/organizations/${organizationId}/it_contacts/${contact.id}/revoke`, { method: 'POST' });
    expect(res.status).toBe(204);
    const after = getWorkOSStore(store).itContacts.get(contact.id)!;
    expect(after.invited_at).toBeNull();
    // Nothing changed, so nothing was written.
    expect(after.updated_at).toBe(before);
  });

  it('rejects invalid intents', async () => {
    const contact = await json(await create('it@acme.com'));
    expect((await invite(contact.id, [])).status).toBe(422);
    expect((await invite(contact.id, 'sso')).status).toBe(422);
    expect((await invite(contact.id, ['nonsense'])).status).toBe(422);
    expect((await invite(contact.id, ['sso', 'sso'])).status).toBe(422);
  });

  it('deleting a contact frees the organization invitation slot', async () => {
    const first = await json(await create('first@acme.com'));
    const second = await json(await create('second@acme.com'));
    await invite(first.id);

    const del = await req(`/organizations/${organizationId}/it_contacts/${first.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(getWorkOSStore(store).itContacts.get(first.id)).toBeUndefined();
    expect((await invite(second.id)).status).toBe(204);
  });

  it('404s an unknown organization, contact, or a contact from another organization', async () => {
    const contact = await json(await create('it@acme.com'));
    const other = await json(await req('/organizations', { method: 'POST', body: JSON.stringify({ name: 'Other' }) }));

    expect((await req('/organizations/org_nope/it_contacts')).status).toBe(404);
    expect(
      (await req(`/organizations/${organizationId}/it_contacts/it_contact_nope`, { method: 'DELETE' })).status,
    ).toBe(404);
    // Addressable only through its own organization.
    expect((await req(`/organizations/${other.id}/it_contacts/${contact.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('drops contacts with the organization', async () => {
    const contact = await json(await create('it@acme.com'));
    expect((await req(`/organizations/${organizationId}`, { method: 'DELETE' })).status).toBe(204);
    expect(getWorkOSStore(store).itContacts.get(contact.id)).toBeUndefined();
  });
});
