# BeforeAfter App — Trade Partner Integration Guide

**Purpose:** everything another team needs to add the BeforeAfter app to their website. Covers both integration paths — mount as a route in a SvelteKit site, or deploy standalone on a subdomain and link to it.

**Last updated:** 2026-07-03

## What the app is

A mobile-first, 100% client-side web app for making before/after photo comparisons. User flow:

1. Take a "before" photo with the phone camera, or upload one from the photo library.
2. Take the "after" photo, using a semi-transparent "ghost" overlay of the before shot to line it up.
3. The pair is saved on-device and can be exported as an animated GIF that either crossfades (dissolve) or wipes (slide) between the two, looping seamlessly.

There is no backend. Nothing is uploaded. All photos live in the browser's IndexedDB on the user's device.

## Where the source files are

Project root: `~/Documents/Claude/Projects/BeforenAfter`

Key files:

- `src/routes/+page.svelte` — main screen and flow (list / before / after modes)
- `src/routes/+layout.svelte` — imports the global stylesheet
- `src/app.css` — global styles (buttons, layout)
- `src/lib/Camera.svelte` — camera capture with the ghost overlay; frames to the phone orientation, requests a high-res stream, crops the capture to the before photo's shape
- `src/lib/Gallery.svelte` — list of saved pairs with GIF export and delete
- `src/lib/db.ts` — local storage via IndexedDB (photos stored as ArrayBuffers to avoid an iOS Safari bug)
- `src/lib/exportGif.ts` — builds the dissolve/slide GIF; caps resolution at 1000px and adapts the frame count to stay under a memory budget so mobile Safari does not crash
- `static/gif.worker.js` — the gif.js web worker (must be served at the site path `/gif.worker.js`)
- `svelte.config.js` — uses `@sveltejs/adapter-node`
- `vite.config.ts` — SvelteKit plus `@vite-pwa/sveltekit` (installable PWA) plus `@vitejs/plugin-basic-ssl` (self-signed HTTPS for local dev)
- `package.json` — deps `idb`, `gif.js`; dev deps `@vite-pwa/sveltekit`, `@sveltejs/adapter-node`, `@vitejs/plugin-basic-ssl`

## Hard constraints (read before integrating)

1. **Requires HTTPS.** The camera uses `getUserMedia`, which only works in a secure context (HTTPS, or `localhost`). Over plain HTTP, or a bare LAN IP, the camera will not start.
2. **The gif.js worker path matters.** `gif.js` loads its worker from `/gif.worker.js`. Wherever the app is served, that file must be reachable at that exact path, or the `workerScript` value in `exportGif.ts` must be updated to match.
3. **Storage is per-origin.** IndexedDB is scoped to the origin serving the app. If you deploy on a separate subdomain, its saved pairs are separate from the main site's origin. This is expected for a standalone deploy.
4. **Memory budget on mobile.** `exportGif.ts` caps resolution at 1000px and reduces frame count for large images on purpose. Do not remove these guards or mobile Safari can crash during export.
5. **Svelte version and syntax.** The app targets Svelte 5. The source components in this folder use legacy syntax (`export let`, `createEventDispatcher`, `on:` events). Runes-converted copies of the three components also exist (see [Reference implementation](#reference-implementation)) if the target project enforces runes.

## Dependencies

**Runtime** (needed wherever the app runs):

- `idb ^8.0.3`
- `gif.js ^0.2.0`

**Dev / build** (only needed for the standalone deploy, not for a route mount):

- `@sveltejs/adapter-node`
- `@vite-pwa/sveltekit` (installable PWA; optional)
- `@vitejs/plugin-basic-ssl` (self-signed HTTPS for local dev only)

## Integration path A: target is SvelteKit (mount as a route)

Recommended when the destination site is also SvelteKit. One site, one deploy. The camera works because the host site already serves HTTPS.

1. Copy the four lib files into a namespaced subfolder in the target, for example `src/lib/beforeafter/`: `Camera.svelte`, `Gallery.svelte`, `db.ts`, `exportGif.ts`.
2. In `Gallery.svelte` (and any file that imports the others), update the `$lib` import paths to the new subfolder, for example `$lib/beforeafter/db` and `$lib/beforeafter/exportGif`.
3. Create the route `src/routes/beforeafter/+page.svelte` using the contents of the source `src/routes/+page.svelte`, with its imports pointed at `$lib/beforeafter/...`.
4. Copy `static/gif.worker.js` into the target's `static/` so it is served at `/gif.worker.js`.
5. Add `idb` and `gif.js` to the target's `package.json` dependencies, then install with the target's package manager. If the target's production build uses a frozen lockfile (for example `bun install --frozen-lockfile` or `npm ci`), commit the updated lockfile so it matches `package.json`, or the build will fail.
6. Do **not** copy the PWA or basic-ssl Vite plugins unless the target explicitly wants them. They are for the standalone dev setup; the host site already provides HTTPS in production.
7. **Scope the CSS.** The source `app.css` sets aggressive global `button` and `body` rules. Do **not** import it globally into the target. Instead wrap the route markup in a container (for example `<div class="ba-app">`) and rewrite those rules as `.ba-app { ... }` and `.ba-app :global(button) { ... }` inside the route's `<style>`. Because the wrapper carries Svelte's scope hash, the `:global()` rules reach the child components' buttons but do not leak into the rest of the site.

## Integration path B: target is not SvelteKit (Next.js, React, WordPress, static HTML, Squarespace, etc.)

Recommended when the destination is any non-SvelteKit stack. The camera needs its own secure context and does not iframe cleanly, so deploy the app standalone and link to it rather than embedding.

1. Deploy this project as-is on its own subdomain, for example `ba.yourdomain.com`.
2. Build and run it: `npm install`, then `npm run build`, then `node build`. It uses `@sveltejs/adapter-node` and serves on port 3000.
3. Put it behind an HTTPS reverse proxy (nginx, Caddy, or your platform's TLS) so the camera works.
4. Confirm `/gif.worker.js` is reachable at the subdomain root (adapter-node serves the `static/` folder, so it will be).
5. From the main site, link or redirect to the subdomain (a normal anchor or button). Do not iframe it.

## Verification checklist (run after either path)

- [ ] Page loads over HTTPS (or localhost during dev).
- [ ] "New before/after (camera)" prompts for camera permission and starts the stream.
- [ ] Taking the before photo, then the after photo, shows the ghost overlay and the opacity slider works.
- [ ] "GIF Dissolve" and "GIF Slide" each download a looping `.gif`.
- [ ] "Upload before photo" accepts a library image and proceeds to the after step.
- [ ] "Delete" removes a saved pair.
- [ ] Saved pairs persist across a page reload (IndexedDB).

## Common gotchas

- **Camera silently does nothing:** you are on HTTP or a LAN IP, not a secure context. Use HTTPS or localhost.
- **GIF export throws a worker error:** `/gif.worker.js` is not served at the site root, or the `workerScript` path in `exportGif.ts` does not match where you placed it.
- **Site styling breaks after integration:** the app's global `app.css` was imported globally. Scope it (see path A, step 7).
- **Production build fails on install:** the lockfile does not include `idb` / `gif.js`. Regenerate and commit it.
- **Runes-only target rejects the components:** use the runes-converted versions (see below).

## Reference implementation

This app was integrated into the FAIT SvelteKit site (`~/Documents/Claude/Projects/FAIT`) using path A. That repo contains a working, runes-converted copy of all three components and the route, which can be used as a template if the target project enforces Svelte 5 runes:

- `src/lib/beforeafter/Camera.svelte`, `Gallery.svelte`, `db.ts`, `exportGif.ts`
- `src/routes/beforeafter/+page.svelte` (includes the `.ba-app` scoped-CSS pattern)

**Runes conversion summary,** if you need to redo it: replace `export let` with `$props()`, replace `createEventDispatcher` with a callback prop (for example `oncaptured`), replace reactive `let` with `$state`, replace the `$:` reactive block with `$effect` (whose cleanup revokes the object URL), and replace `on:click` / `on:change` with `onclick` / `onchange`.
