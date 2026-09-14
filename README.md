# Stick It Out

Local working tree for the Stick It Out site and **Lessons** subscription product.

**Local path:** `C:\Users\epicn\Documents\sites\Stickitout`

## Product

- **Lessons membership:** Monthly / biannual / annual plans (Stripe Payment Links + Customer Portal when wired). Surfaces: `membership.html`, `membership-checkout.html`, `membership-welcome.html`, `account.html`, `portal.html`. Plan config: `js/membership-commerce.js`.
- **Book (separate):** One-time PDF purchase via `payment.html` / `unlock.html`.

## Notes

- This repo is the source of truth for the Stick It Out system (site + membership checkout + member portal).
- A Blaze demo mirror may exist under `Blaze/demos/stickitout/` for portfolio showcase only.
- Do not commit SFTP credentials (`.vscode/sftp.json` is gitignored).
