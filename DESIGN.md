---
name: Folio
description: A document workbench with a quiet blue frame and a generous paper surface.
colors:
  primary: "#305cce"
  primary-soft: "#e2eafe"
  canvas: "#eef1f7"
  paper: "#ffffff"
  sidebar: "#e6ebf4"
  ink: "#24304b"
  secondary-text: "#566580"
  divider: "#dce2ee"
typography:
  title:
    fontFamily: "Georgia, Times New Roman, serif"
    fontSize: "2.65em"
    fontWeight: 400
    lineHeight: 1.13
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "17px"
    lineHeight: 1.9
  label:
    fontFamily: "Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  control: "6px"
  paper: "10px"
  dialog: "14px"
spacing:
  compact: "8px"
  group: "16px"
  panel: "24px"
components:
  primary-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
---

## Overview
The document is the focal surface. Blue-gray navigation and a white paper inset separate navigation, tools and content without using a dashboard of cards. The product operates as a Windows editor; familiar menus and keyboard behavior take priority over decorative motion. The user delegated design decisions for the 2.0 rebuild.

## Colors
Blue identifies the active outline item, selected view, primary export action and keyboard focus. Dark mode uses slate surfaces (#171e2d canvas, #202a3b paper) and a lighter blue (#a7c0ff) to retain contrast.

## Typography
Segoe UI carries interface labels and document body text. Georgia gives document titles an editorial character. Cascadia Code/Consolas is reserved for editable source and code. Labels use sentence case; no promotional eyebrows.

## Layout
The sidebar is 248px wide, narrowing to 220px below 1150px. The 64px toolbar holds document identity, the Read/Split/Source switch and actions. Reading paper is at most 900px wide, with 64px horizontal padding. Split mode gives source 45% of the workspace. Below 900px navigation becomes a dismissible drawer. The native minimum window is 760×560.

## Elevation & Depth
Tonal surfaces establish the main hierarchy. Only menus, dialogs and notifications use the shared soft shadow, 0 12px 40px #17274626. Visible focus has a 2px blue outline and 3px offset.

## Shapes
Controls use 6px corners, paper and popovers 10px, dialogs 14px. Outline selection is a full background tint. Icons are authored SVG strokes, never decorative emoji.

## Components
Export opens a short action menu. PDF styles use radio options with a small typography preview. Source remains a native textarea for selection and undo. Save status, busy state, cancellation and conflict messages remain visible in the status bar. Settings persist locally.

## Do's and Don'ts
Do preserve keyboard access, bounded content widths, native dialogs and independent source/preview scrolling. Do use the same named action throughout its flow. Don't add ornamental motion or promotional labels to the reading surface. Rendered document callouts retain their semantic styling; they are document content, not application cards.
