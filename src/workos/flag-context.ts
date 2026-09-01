import type { WorkOSFeatureFlag } from './entities.js';
import type { WorkOSStore } from './store.js';

/** Same `environment_<name>` convention Vault objects are scoped by. */
export function environmentIdFor(environment?: string): string {
  return `environment_${environment ?? 'test'}`;
}

/**
 * `access_type` summarises a flag's reach in one word, the way the dashboard shows it:
 * `all` when the default value carries every resource, `some` when only targets are on,
 * `none` when the flag reaches nobody (disabled, or enabled with neither).
 */
export function flagAccessType(ws: WorkOSStore, flag: WorkOSFeatureFlag): 'none' | 'some' | 'all' {
  if (!flag.enabled) return 'none';
  if (flag.default_value) return 'all';
  return ws.flagTargets.findBy('flag_slug', flag.slug).length > 0 ? 'some' : 'none';
}

/**
 * The base `context` every flag webhook carries. `client_id` is the emulator's standing
 * placeholder — it has no environment/client identity to report — and the actor is always
 * the API surface, since the emulator serves no dashboard or admin portal.
 */
export function flagEventContext(): Record<string, unknown> {
  return {
    client_id: 'workos-emulate',
    actor: { id: 'api_key_emulator', source: 'api', name: 'Emulator API key' },
  };
}

/**
 * The targeting half of a `flag.rule_updated` context. Only that event defines `access_type`
 * and `configured_targets`, so the other three flag events must not carry them.
 */
export function flagRuleState(ws: WorkOSStore, flag: WorkOSFeatureFlag): Record<string, unknown> {
  const targets = ws.flagTargets.findBy('flag_slug', flag.slug);
  return {
    access_type: flagAccessType(ws, flag),
    configured_targets: {
      organizations: targets
        .filter((t) => t.resource_type === 'organization')
        .map((t) => ({ id: t.resource_id, name: ws.organizations.get(t.resource_id)?.name ?? t.resource_id })),
      users: targets
        .filter((t) => t.resource_type === 'user')
        .map((t) => ({ id: t.resource_id, email: ws.users.get(t.resource_id)?.email ?? '' })),
    },
  };
}

/**
 * The full `flag.rule_updated` context. `previous_attributes` is required on this event, so
 * the caller has to capture `flagRuleState` before mutating the targets and hand it back here.
 */
export function flagRuleUpdatedContext(
  ws: WorkOSStore,
  flag: WorkOSFeatureFlag,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...flagEventContext(),
    ...flagRuleState(ws, flag),
    previous_attributes: {
      data: { enabled: flag.enabled, default_value: flag.default_value },
      context: previous,
    },
  };
}
