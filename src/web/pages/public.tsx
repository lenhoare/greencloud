/** Pages visible without signing in. */

const LOGIN_ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  state_mismatch: "Your sign-in attempt expired or was started in another tab. Please try again.",
  oauth_failed: "Google sign-in failed. Please try again.",
  email_unverified: "Your Google account's email address isn't verified.",
  not_allowed: "This Google account isn't allowed to use this app. Ask an administrator to add you.",
  account_disabled: "This account has been disabled. Contact an administrator.",
};

export function LandingPage({ appName }: { appName: string }) {
  return (
    <section class="hero">
      <h1>{appName}</h1>
      <p class="lead">Organise work into projects, track items, and share with your team.</p>
      <a href="/login" class="btn btn-primary btn-lg">Get started</a>
    </section>
  );
}

export function LoginPage({ error, returnTo }: { error?: string | undefined; returnTo: string }) {
  const message = error ? (LOGIN_ERRORS[error] ?? "Sign-in failed. Please try again.") : null;
  return (
    <section class="card narrow center">
      <h1>Sign in</h1>
      {message && (
        <div class="flash flash-error" role="alert">
          {message}
        </div>
      )}
      <p class="muted">Use your Google account to continue.</p>
      {/* hx-boost=false: this must be a real navigation, since it redirects to accounts.google.com. */}
      <a href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`} class="btn btn-google btn-lg" hx-boost="false">
        <GoogleLogo /> Sign in with Google
      </a>
    </section>
  );
}

export function ErrorPage({ status, message, requestId }: { status: number; message: string; requestId?: string }) {
  return (
    <section class="card narrow center">
      <p class="error-code">{status}</p>
      <h1>{status === 404 ? "Page not found" : status === 403 ? "Not allowed" : "Something went wrong"}</h1>
      <p class="muted">{message}</p>
      {requestId && <p class="muted small">Reference: {requestId}</p>}
      <a href="/" class="btn">Go home</a>
    </section>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
