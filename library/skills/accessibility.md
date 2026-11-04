# Accessibility

Use when creating or changing user interface: pages, components, forms, dialogs, menus or charts. Models usually miss these unless told.

Build it, then check it against this list as a separate pass. Prefer native elements to re-implementing them.

- **Names:** every control has an accessible name from a visible label. Images have alt text, or empty alt when decorative. An icon button needs a name.
- **Structure:** one main landmark and a sensible heading order, with lists and tables marked as such.
- **Keyboard:** everything works by keyboard in a logical order, with a visible focus. No traps. Use a real `button` or `a`, not a clickable `div`.
- **Forms:** each input has a label. Errors are tied to their field with text and announced. Required state is exposed.
- **Dialogs and menus:** focus moves in, stays in, and returns on close. Escape closes. Roles and states match the behaviour, and a wrong ARIA role is worse than none.
- **Dynamic content:** status changes are announced through a live region. Loading state is exposed.
- **Colour and motion:** contrast of at least 4.5:1 for text and 3:1 for large text and controls. Colour is never the only signal. Respect reduced motion.
- **Zoom:** usable at 200% and on a narrow screen, with no horizontal scrolling for text.

Run an automated checker if you can. It catches a fraction of problems, so say what still needs a person with a screen reader.
