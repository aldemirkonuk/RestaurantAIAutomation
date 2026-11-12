# Onboarding: state of the art (2025-2026), short

Most sources here are vendor help pages or vendor blogs. Treat every number as directional. The FIDO figure is the only cross-industry one.

## What the best restaurant products do

- **Menu from a photo or file is now table stakes, and it is asynchronous.**
  - Square lets a seller start a menu from a file, photo or URL. It builds the menu in the background and emails when ready, usually within a day. Square can also import from Toast or Clover via WoFlow, and can generate an AI starter menu from a few questions.
  - The pattern is that the person never waits on a spinner for the read. The read is a job with a notification.
  - Sources: [Square help 6424](https://squareup.com/help/article/6424), [Square help 8318](https://squareup.com/help/article/8318), [Square AU 6424](https://app.squareup.com/help/au/en/article/6424).
- **Toast is consultant-led.** It has a build phase before go-live, and its guides warn that going live before setup is complete breaks day one. The lesson is that "configured" and "live" are separate states, and the product says which one you are in. Sources: [Toast self-service guide](https://support.toasttab.com/en/article/Self-Service-Guide?lang=en_US), [Toast onboarding guide](https://support.toasttab.com/en/article/Remote-Onsite-Onboarding-Guide).
- **Inventory tools front-load the supplier invoice, not a form.** MarketMan sells phone-photo invoice scanning with line-item receiving as the way in. It claims onboarding in 24–48 h, while Toast's integration guide says 4–6 weeks and asks for a list of daily-ordered ingredients first. The useful part is that the first invoice seeds the items, suppliers and prices together. Sources: [MarketMan invoice scanning](https://fr.marketman.com/blog/ai-invoice-scanning-from-marketman-faster-smarter-and-made-for-restaurants), [MarketMan invoice management](https://www.marketman.com/restaurant-invoice-management-system), [Toast–MarketMan guide](https://support.toasttab.com/article/Get-Started-with-the-MarketMan-Integration).

## Sign-up and verification

- **Send a code and a link in the same email.** The code works on any device, and a mail scanner cannot consume it. The link is better on desktop. Sources: [guptadeepak: magic link vs OTP](https://guptadeepak.com/ciam-compass/guides/magic-links-vs-otp/), [Prelude](https://prelude.so/blog/otp-vs-magic-links).
- **Passkeys get the highest sign-in success.** FIDO's 2025 Passkey Index, as cited, reports 93% against 63% for other methods. A common split is magic link or code to activate, passkey for returning users, and one fallback kept. Sources: [MojoAuth success-rate roundup](https://mojoauth.com/blog/login-success-rates-passkeys-otp-magic-links-passwords), [MojoAuth method fit](https://mojoauth.com/blog/magic-links-passkeys-otp-and-social-login-which-passwordless-method-fits-your-application).
- **Conditional Create** (Chrome 136+, Safari 18) silently enrols a passkey right after a password sign-in. It does not work after a federated or passwordless sign-in. It is best-effort and resolves quietly when it cannot run. Sources: [Chrome for Developers](https://developer.chrome.com/docs/identity/webauthn-conditional-create), [Corbado](https://www.corbado.com/blog/conditional-create-passkeys.md).

## Inference over asking

- **Google Places (New) can return more than the address.** Its Place Details also return `internationalPhoneNumber` and `regularOpeningHours` (Enterprise tier) and `utcOffsetMinutes` (Pro tier), so phone, hours and timezone can come from the place pick. The cost is a higher SKU tier. Source: [Places data fields](https://developers.google.com/maps/documentation/places/web-service/data-fields?hl=de).

## Activation discipline

- **Defer everything that is not needed for first value**: profile completion, team invites, integrations, customisation. Source: [fungies 2026 guide](https://fungies.io/saas-user-onboarding-guide-2026-2/).
- **Benchmarks:** Userpilot's 2025 set reports a median activation of about 37% and an average time-to-value of about 1.5 days across B2B SaaS. Vendor blogs cite targets under 15 minutes. Sources: [Userpilot metrics](https://userpilot.com/saas-product-metrics/), [digitalapplied TTV framework](https://www.digitalapplied.com/blog/customer-onboarding-time-to-value-2026-saas-metrics-framework).

## What this means for Mudavym (maps to audit gaps)

1. Make the first menu read a **background job** with a live status and a notification, and **make it current on review** (G1, G7). This matches Square's model.
2. Put a **6-digit code plus a link** in the verify mail, verify without a second click, and **poll** the opening tab (G4).
3. Offer **passkey at sign-up**, and Conditional Create after a password sign-up (G13).
4. Ask Places for **phone, timezone and hours**, and drop the re-asked name and the discarded role (G12).
5. Make **invoice photo** the provider/inventory step, so it seeds suppliers and prices together, instead of a filename "kept for later" (G15).
6. **Activation equals first value:** a current menu with priced stock. A team invite or threshold should not be required (G8).
