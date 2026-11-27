# Design system

Based on Apple's fluid-interface principles (WWDC *Designing Fluid Interfaces*), translated for the web.
Rule of thumb: if it adds typing or delay without helping the executive sell, it does not go in.

## Foundations
- **Brand:** violet (`brand`). Neutral slate for text and borders. System font stack (no web font).
- **Shape:** controls `rounded-xl`, cards and sheets `rounded-2xl` / `rounded-3xl`. Soft shadows (`shadow-card`, `shadow-float`, `shadow-sheet`), never heavy borders.
- **Type:** tracking follows size. Headings are tight (`tracking-tight`, `.display`), body stays at 0. Inputs are 16px on phones so iOS does not zoom.
- **Primitives only in `components/ui/`:** no API calls, no business logic. Destructive confirmations use `ui/delete-dialog.tsx`. Every list has loading, empty and error states.

## Response and feedback
- Feedback starts on press, not release: use `.pressable` (scale 0.97 in 110 ms) on anything tappable.
- Latency is a bug. No artificial timers, no waiting on animations to accept input.
- Tap targets are at least 40 px. `touch-action: manipulation` removes the tap delay.

## Motion
- **Springs, not durations,** for anything the user touches. Default is critically damped (`bounce: 0`, about 0.4 s). Add bounce (about 0.2) only after a flick that carried momentum.
- **Interruptible:** animate from the live on-screen value (a `motionValue`), never from the target. A closing sheet can be grabbed and reversed.
- **Velocity hand-off:** pass the finger's release velocity to the spring. Decide dismiss or return from the projected end point (`project(v)` in `ui/sheet.tsx`), not from where the finger stopped.
- **Rubber-band** at edges instead of hard stops.
- Enter and leave along the same path (sheets rise from the bottom and leave through the bottom).
- Only animate `transform` and `opacity`.
- CSS keyframes (`animate-rise`, `animate-float`) are for decoration only, never for gesture-driven things.

## Materials
- Floating chrome (top bar, bottom nav) uses `.material`: translucent with blur, content scrolls underneath, hairline edge instead of a thick border.
- Forms live on solid white surfaces. Never stack one translucent layer on another.
- Modal tasks dim with a scrim. Sheets are the one modal pattern (`ui/sheet.tsx`): bottom sheet on phones, centred dialog on desktop.

## Accessibility (built into the CSS, not per screen)
- `prefers-reduced-motion`: slides and springs become short fades; loops stop.
- `prefers-reduced-transparency` and `prefers-contrast: more`: materials turn solid with defined edges.
- Visible `:focus-visible` ring on every control. Colour is never the only signal (stage badges carry text).

## Sign-in screens (`components/auth/`)
- `AuthShell`: split layout (product art left, a compact banner on phones, form right).
- `Illustration`: original SVG scenes per screen (`login`, `code`, `forgot`, `reset`); extend `ArtVariant` to add one.
- `OtpInput`: six boxes that act as one field (paste, SMS/email autofill, backspace, arrows).
- Flows: one-time code (default) or password. Forgot password reuses the one-time code, then sets a new password, so it works for mobile-only users.

## Scrollbars
Thin (10 px track, slim thumb), light slate and nearly invisible until you point at the area (`globals.css`). Firefox gets the standard thin scrollbar in the same colours. Scrolling is smooth for the page, `main` and dialogs, and a dialog never scrolls the page behind it. Reduced motion turns smooth scrolling off.

## Placeholders
Every text field has a plain prompt and never an example value. `InputField` and `TextareaField` build it from the label ("Company" shows "Enter company name", "Confirm new password" shows "Re-enter new password"); free-text boxes say "Write a note" or "Write your message". Date and time pickers, read-only fields and the code boxes have none. A new field gets its placeholder automatically.

## Pickers, dialogs, menu
- **Date and time:** the browser's own controls are not used. `ui/date-picker.tsx` (calendar, Monday first, Today shortcut, past dates disabled when a minimum is set) and `ui/time-picker.tsx` (hour, minute, AM/PM and quick times) open in a `ui/popover.tsx` that sits in `document.body`, so a scrolling dialog never clips it. Dates are plain year-month-day (`lib/date-parts.ts`), never time-zone shifted.
- **Dialog header:** every dialog uses `ui/dialog-header.tsx`: an icon in a tinted square on the left, the action as the title, the lead or person as a subtitle, a soft tinted background. Pass `icon` and `tone` to `Sheet` or `Modal`.
- **Top bar:** the module name is small and quiet (`text-base`, semibold).
- **Menu:** the sidebar collapses to icons only (`tofaa-menu-collapsed` in localStorage). One round arrow sits on its right border, halfway down, in both states. In icon mode each item shows its name in a tooltip on hover and keyboard focus.
- **Lead cards:** the pipeline card (`crm/board-card.tsx`) and the lead card (`crm/lead-card.tsx`, three per row on Leads) show photo, contact, phone, city, value, source, next step and owner, so most work can start without opening the lead.

## Pitfall: `.pressable` and transforms
`.pressable` shrinks an element to 97% on press by setting `transform: scale(0.97)`. That replaces any other transform on the same element, including Tailwind's `-translate-*` and `rotate-*`. Never put `pressable` on an element positioned with a translate or rotate: position it with `top`/`left`/`margin` instead (the sidebar toggle does), or put the press effect on an inner element.

## Type scale

One set of text sizes for every screen (defined in `globals.css`). Sizes below are on desktop, where the whole app draws at 95% (set on `html` in `globals.css`). Use these classes, not ad-hoc `text-[15px]` or `text-2xl`:

| Class | Size | Use |
|---|---|---|
| `t-title` | 18px on phones, 21px on desktop, bold | The record's name: lead, client |
| `t-section` | 15px, semibold | Card headings |
| `t-body` | 13.8px | Normal text and values |
| `t-meta` | 13px, slate-500 | Dates, owners, secondary lines |
| `t-caption` | 12.4px | Labels above values, chips, stepper labels |

Rules that keep text from overlapping, including at Windows 125% scaling:
- Buttons never wrap their label (`whitespace-nowrap` in Button). Keep labels short: "Meeting", not "Schedule meeting".
- In a row, the text block gets `min-w-0 flex-1` and truncates. Pills, menus and times get `shrink-0`.
- Steppers give every step a minimum width and scroll sideways. Labels wrap to two lines at most.
