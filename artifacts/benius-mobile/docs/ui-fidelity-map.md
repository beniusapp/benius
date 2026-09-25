# BENIUS Web → Mobile UI Fidelity Map

The responsive BENIUS web application is the source of truth. Translate each
screen's existing layout and interaction into native React Native controls; do
not impose a single generic mobile-card layout on web screens that use different
patterns. This map documents the current foundation and does not claim the
unbuilt module screens already have native equivalents.

## Responsive reference observed

At a 390 × 844 browser viewport, the public web landing page shows a compact
BENIUS top bar, a centered hero heading, three vertically stacked role-entry
panels, a contact prompt, and a bottom status/footer row on a dark navy
background with blue, green, and purple accents. This public page does not show
an authenticated sidebar, table, tabs, search, filters, or notifications; those
patterns must be derived from their actual authenticated web screens when
available. The current native sign-in screen is a credential form, not a
pixel-level reproduction of this public landing page. This map records the
foundation and remaining differences rather than claiming visual parity.

| BENIUS web pattern | Current native foundation | Fidelity rule / remaining gap |
| --- | --- | --- |
| App shell, header, sidebar/drawer, responsive navigation | Expo Router native stack, safe-area screen wrapper, native back and account actions (`app/_layout.tsx`, `components/Authenticated.tsx`) | Map each future screen to the corresponding responsive web route and workflow. Do not invent a bottom bar or alter navigation. No module navigation is implemented yet. |
| Button variants and actions (`artifacts/benius-web/src/components/ui/button.tsx`) | `Button` in `artifacts/benius-mobile/components/Foundation.tsx` | Preserve the source action label, variant, hierarchy, and disabled/loading behavior. Native touch sizing may differ where platform accessibility requires it. |
| Labeled inputs (`artifacts/benius-web/src/components/ui/input.tsx`, form patterns) | `Field` in `artifacts/benius-mobile/components/Foundation.tsx` | Preserve labels, validation, input mode, and error text. Password/PIN values remain transient and are never persisted. |
| Selects and dropdowns | No shared native select/dropdown primitive yet | When a source web flow uses one, reproduce its options and behavior with an accessible native picker or modal; do not substitute an unrelated control. |
| Cards (`artifacts/benius-web/src/components/ui/card.tsx` and bespoke responsive cards) | `Card` in `artifacts/benius-mobile/components/Foundation.tsx` | Match the specific source screen: generic web cards and bespoke glass/student cards are different patterns, not one universal card. |
| Tables and responsive data lists | Native `FlatList` is used for the session picker | For future tabular screens, preserve source columns, order, labels, and row actions in a responsive list equivalent. No module table is implemented. |
| Tabs (`artifacts/benius-web/src/components/ui/tabs.tsx`) | No reusable native tabs yet | Preserve the source tab labels, selected state, and horizontal overflow behavior when a matching screen is built. |
| Dialogs and confirmations | Native `Alert.alert` is used for sign-out confirmation | Use a native confirmation for equivalent simple actions; richer web dialogs need a native modal with the same content and actions. No reusable rich dialog exists yet. |
| Toasts | No reusable native toast exists | Do not silently replace a web toast with a different workflow. A future native equivalent must preserve message, severity, and dismissal behavior. |
| Alerts and offline/error messages | Inline accessible `State` and offline banner in `components/Foundation.tsx` | Preserve severity, message, retry action, and accessibility announcement. |
| Badges and status labels | Session status currently uses inline text and color | Future badges must retain source wording and meaning; no shared native Badge primitive exists. |
| Loading, empty, and error states | `State` in `components/Foundation.tsx`; session skeleton, empty and retry states in `components/Authenticated.tsx` | Keep the same state meaning and recovery action as the corresponding web screen. |
| Typography, colors, spacing, icons | `artifacts/benius-mobile/constants/colors.ts`, Architects Daughter font in `artifacts/benius-mobile/app/_layout.tsx`, Feather icons | Reuse web tokens and font roles; Feather icons are the native semantic equivalents of web Lucide icons. Preserve page-specific spacing and palette rather than forcing one style across all web modules. |
| Search and filters | No mobile module search/filter flows yet | Reproduce the corresponding web controls and filter behavior only when that module is authorized; do not invent filters in the foundation. |

The web application has more than one responsive visual pattern (including
shared component-library screens and bespoke student/teacher surfaces). The
current Expo foundation shares core brand tokens and interaction primitives,
but is not pixel parity with every web screen. Native tabs, rich dialogs,
toasts, badges, selects, module tables, search, and filters remain unimplemented.