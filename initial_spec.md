ou are building a production-grade greenfield web application on Cloudflare Workers.

Stack requirements (non-negotiable):
- Cloudflare Workers runtime
- TypeScript
- Hono as the web framework
- Google OAuth 2.0 (authorization code flow) for user authentication
- Wrangler configuration
- Appropriate bindings (start with KV for sessions; add D1 if useful for app data)
- Environment secrets for Google client ID / secret

Scope:
Create a complete, well-structured, production-ready scaffold for a complex multi-feature application. Do not hard-code a single narrow domain — make it a solid, extensible foundation that can later support multiple features (user accounts, protected resources, CRUD data, background work, etc.). Focus on architecture, auth, security, DX, and patterns that scale.

Please implement:

1. Project scaffolding
   - Proper TypeScript + Wrangler setup
   - Hono app with clean route organization (e.g. modules for auth, api, health)
   - Typed Env bindings
   - Local development experience (wrangler dev / Vite if appropriate)

2. Google OAuth authentication (full flow)
   - Login route that redirects to Google
   - Callback route that exchanges the code, validates the ID token, and creates a session
   - Secure session handling (HttpOnly, Secure, SameSite cookies; optionally backed by KV)
   - Logout
   - Middleware that protects routes and attaches the current user
   - Clear instructions in comments or a README for setting up the Google Cloud OAuth client (redirect URI, secrets, etc.)

3. Application structure
   - Example protected API routes
   - A simple authenticated “me” endpoint
   - Error handling, request logging, and CORS setup suitable for a real app
   - Basic rate-limiting or security headers where sensible
   - OpenAPI/Swagger or typed route documentation if easy to add

4. Quality bar
   - Strong TypeScript types throughout
   - Sensible file organization and naming
   - Comments explaining non-obvious auth/session decisions
   - README with setup, environment variables, local run, and deploy steps
   - At least a few meaningful tests (auth flow or core routes) if the environment supports them

5. Cloudflare-native practices
   - Use bindings instead of external REST calls where possible
   - Compatible with current Workers compatibility date
   - Ready for `wrangler deploy`

Start by scaffolding the full project, implementing the Google OAuth flow end-to-end, and establishing the protected route patterns. After that, make reasonable assumptions and continue building out a solid multi-feature foundation (data models, additional routes, admin-style endpoints, etc.) so the result is immediately useful and easy to extend. Prefer thorough, production-oriented code over minimal demos.

When you finish the initial scaffold, summarize what was built and list clear next steps or extension points.
