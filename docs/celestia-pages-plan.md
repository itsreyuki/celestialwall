# Celestia Pages

## Current architecture

- Node.js CommonJS application using Express 4, static HTML/CSS/JavaScript, and no UI framework.
- Routing is centralized in `server.js`: `/auth`, `/api`, `/api/music`, static `public/`, `/music`, then a catch-all that serves the wall.
- PostgreSQL is accessed with `pg` and SQL helpers in `db.js`; schema setup currently runs at server startup. There is no ORM or migration framework.
- Discord OAuth uses Passport plus `express-session`; the persisted user identity is Discord `discord_id`, with username, global name, avatar, and guild-membership state.
- Music uploads use Multer, FFmpeg conversion, and Supabase Storage via server-side service-role credentials, with a local-development fallback. Reuse this server-side storage pattern for Pages assets; do not expose storage credentials.
- Styling is custom CSS with Cairo/Space Grotesk and the existing dark gold/violet design system. Reuse shared styles and asset branding.
- APIs are Express JSON endpoints. Socket.IO exists for wall/music realtime only; Pages does not need it in V1.
- Deployment is Render with GitHub-based deployment and Supabase PostgreSQL/Storage. No analytics system or analytics tables exist.

## Proposed model

- `celestia_pages`: one page per Discord user in V1. Fields: `id`, `user_id`, unique lowercase `slug`, `display_name`, `bio`, `visibility`, `published`, `published_at`, `views_count`, `reactions_enabled`, `remix_enabled`, `entrance_enabled`, `config` JSONB, `created_at`, and `updated_at`.
- `config` uses `configVersion: 1` and a strict server-side schema. It holds approved values only for background, profile card, avatar/banner assets, typography presets, social links, music, decorations, stickers, images, widgets, entrance, cursor, effects, tabs, mobile overrides, and layer order.
- Initial limits: 24 total visual elements, 12 image assets, 12 links, 6 widgets, 5 tabs, 3 active effects, 500-character bio, 120-character display name, and 500-character text per element. Asset URLs must be server-issued Pages Storage URLs.
- Keep queryable social data in `page_reactions` and `page_remixes`. Keep lightweight atomic `views_count` updates only; do not add event-level analytics.
- Add Zod in the data-model phase solely for configuration validation and safe parsing; it substantially reduces bespoke validation code for this nested, versioned schema. Use JSDoc types in the current JavaScript codebase.

## Routing and components

- Public page URLs are `celes.lol/{slug}`. Add an explicit one-segment public-page route before the existing catch-all. Reserve `api`, `auth`, `assets`, `vendor`, `uploads`, `music`, `health`, `pages`, and other system paths; reject these as slugs.
- Dashboard/editor route: `/pages`; public renderer endpoint: `GET /api/pages/:slug`; authenticated owner endpoints: `GET/POST/PATCH /api/pages/me`; asset upload endpoint: `POST /api/pages/assets`.
- Social endpoints stay separate under `/api/pages/:slug/...` for reactions and remix operations.
- Core client pieces: public renderer, authenticated editor/dashboard, controlled configuration form, asset picker/uploader, and shared page preview. No custom HTML, JavaScript, or free-form CSS is accepted.

## Delivery phases

1. Data model, strict configuration schema, repository helpers, and validation tests.
2. Authenticated page CRUD, slug protection, and secure Pages asset uploads.
3. Editor/dashboard and live preview using preset-based customization controls.
4. Public renderer at `/{slug}`, publishing/visibility, and atomic page-view counter.
5. Optional social features: reactions and remixes.

## Risks and compatibility

- The current global JSON request limit is 10 KB; review and raise it conservatively for validated Page configuration payloads if the defined limits require it.
- Render local disk is ephemeral, so production Pages assets must use Supabase Storage.
- The public slug route must remain after explicit system routes and enforce the reserved-slug list to avoid routing conflicts.
- All public rendering must build DOM from validated configuration values and escaped text, never user-provided HTML/CSS/JavaScript.
