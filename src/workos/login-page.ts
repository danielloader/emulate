export interface LoginPageOptions {
  title: string;
  subtitle?: string;
  emailHint?: string;
  formAction: string;
  hiddenFields: Record<string, string>;
}

/** One organization a user may finish signing in to. */
export interface SelectableOrganization {
  id: string;
  name: string;
}

export interface OrganizationSelectPageOptions {
  /** Who is signing in, so it is obvious whose organizations these are. */
  email: string;
  organizations: SelectableOrganization[];
  formAction: string;
  hiddenFields: Record<string, string>;
}

export interface DeviceVerifyPageOptions {
  title: string;
  message: string;
}

// The emulator auto-approves device authorization with the first seeded user, so this page is a
// static confirmation rather than a user_code entry form. It matches the login page styling so a
// CLI that opens verification_uri in a browser lands on something that looks like WorkOS.
export function renderDeviceVerifyPage(options: DeviceVerifyPageOptions): string {
  const { title, message } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — WorkOS Emulate</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
    .card{background:#fff;border-radius:8px;padding:40px;width:400px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    .badge{display:inline-block;background:#6366f1;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;margin-bottom:16px;letter-spacing:.5px}
    h1{font-size:22px;font-weight:600;margin-bottom:8px}
    .sub{color:#6b7280;font-size:14px;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">WORKOS EMULATE</div>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(message)}</p>
  </div>
</body>
</html>`;
}

export function renderLoginPage(options: LoginPageOptions): string {
  const { title, subtitle, emailHint, formAction, hiddenFields } = options;

  const hiddenInputs = Object.entries(hiddenFields)
    .filter(([, v]) => v != null)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — WorkOS Emulate</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
    .card{background:#fff;border-radius:8px;padding:40px;width:400px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    .badge{display:inline-block;background:#6366f1;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;margin-bottom:16px;letter-spacing:.5px}
    h1{font-size:22px;font-weight:600;margin-bottom:8px}
    .sub{color:#6b7280;font-size:14px;margin-bottom:24px}
    label{display:block;font-size:14px;font-weight:500;margin-bottom:6px}
    input[type="email"]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;outline:none}
    input[type="email"]:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
    button{width:100%;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;margin-top:16px}
    button:hover{background:#4f46e5}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">WORKOS EMULATE</div>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(subtitle ?? 'Enter your email to continue.')}</p>
    <form method="POST" action="${esc(formAction)}">
        ${hiddenInputs}
        <label for="email">Email</label>
        <input type="email" id="email" name="email" value="${esc(emailHint ?? '')}" required autofocus>
        <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * The screen hosted AuthKit shows when a user belongs to more than one organization: a row per
 * organization, picked before anything is minted.
 *
 * Rendered during authorize rather than at the token exchange, because that is where production
 * asks. The code then carries the organization and the client's exchange succeeds. Without this
 * step the emulator answers the exchange with `organization_selection_required`, which is an
 * API-level response a browser client has no way to act on: it surfaces mid-callback as a failed
 * exchange, and the user is simply stuck.
 *
 * Each row is a submit button carrying its own organization id, so picking is one click and the
 * page still needs no JavaScript.
 */
export function renderOrganizationSelectPage(options: OrganizationSelectPageOptions): string {
  const { email, organizations, formAction, hiddenFields } = options;

  const hiddenInputs = Object.entries(hiddenFields)
    .filter(([, v]) => v != null)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join('\n        ');

  const rows = organizations
    .map(
      (org) => `          <button class="org" type="submit" name="organization_id" value="${esc(org.id)}">
            <span>${esc(org.name)}</span><span class="chevron" aria-hidden="true">&rsaquo;</span>
          </button>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Select an organization — WorkOS Emulate</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
    .card{background:#fff;border-radius:8px;padding:40px;width:400px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    .badge{display:inline-block;background:#6366f1;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;margin-bottom:16px;letter-spacing:.5px}
    h1{font-size:22px;font-weight:600;margin-bottom:8px}
    .sub{color:#6b7280;font-size:14px;margin-bottom:24px}
    .orgs{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
    .org{display:flex;align-items:center;justify-content:space-between;width:100%;padding:14px 16px;background:#fff;border:none;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:left;cursor:pointer}
    .org:last-child{border-bottom:none}
    .org:hover{background:#f9fafb}
    .org:focus-visible{outline:2px solid #6366f1;outline-offset:-2px}
    .chevron{color:#9ca3af;font-size:18px;line-height:1}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">WORKOS EMULATE</div>
    <h1>Select an organization</h1>
    <p class="sub">${esc(email)} belongs to more than one organization.</p>
    <form method="POST" action="${esc(formAction)}">
        ${hiddenInputs}
        <div class="orgs">
${rows}
        </div>
    </form>
  </div>
</body>
</html>`;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
