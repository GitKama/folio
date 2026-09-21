export const demoDocument = {
  name: 'Welcome to Folio.md',
  path: null,
  baseUrl: null,
  content: String.raw`---
title: Welcome to Folio
description: A quieter place to read your Markdown.
tags: [Markdown, Field notes, Getting started]
---

# A clear view of your Markdown.

A thoughtful space for documents, ideas, and all the details in between. Open a file and settle in — your outline, diagrams, and equations come along.

> [!TIP] Make yourself at home
> Drop a Markdown file anywhere, use **Open document**, or press **Ctrl + O**. Try **Split** to see how these pages are written.

## The useful details

Markdown comes in many dialects. Folio brings the common ones together, with a **format selector** when a document needs a more specific interpretation.

| In your document | Here in Folio |
| :--- | :--- |
| **Everyday writing** | Headings, links, lists, quotes, and images |
| **Structured thinking** | Tables, checklists, footnotes, and front matter |
| **Technical detail** | Highlighted code, equations, and diagrams |
| **Connected notes** | Wiki links, callouts, and extended syntax |

The outline on the left follows the shape of your document. Search with **Ctrl + F**, choose a comfortable text size, or switch to a darker page after hours.

## Ideas, connected

A little structure can make a complicated thought feel simple.

~~~mermaid
flowchart LR
  A[An idea] --> B[A rough draft]
  B --> C[A clearer view]
  C --> D[Something worth sharing]
~~~

> [!NOTE] A format for the document
> **Automatic** enables a broad set of familiar extensions. **CommonMark** and **GitHub** provide more focused interpretations. **Extended** and **Obsidian** help with documents that go a little further.

## Room for the technical

Code deserves to be easy to read, too.

~~~typescript
interface ReadingSession {
  document: string;
  distractions: 0;
}

const session: ReadingSession = {
  document: 'something-worth-reading.md',
  distractions: 0,
};

console.log('A little more clarity.');
~~~

Equations can sit naturally in a sentence — $E = mc^2$ — or have a little space of their own:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## Small things, considered

- [x] A comfortable reading width
- [x] An outline that stays within reach
- [x] Light and dark themes
- [x] Standalone HTML and PDF export
- [ ] Your next good idea

You can add a footnote without interrupting the thought.[^detail] Or use ==a little emphasis==, H~2~O, x^2^, and ~~a change of plan~~ in extended formats.

Term
: A definition list makes a useful home for a short explanation.

<details>
<summary>One more useful detail</summary>

HTML details blocks work here as well. This one keeps an extra thought nearby until you need it.

</details>

## Ready when you are

Bring a README, a research note, a journal, or a long-forgotten draft. Give it a little room to breathe.

---

[^detail]: Good tools leave room for the details without letting them get in the way.
`,
};
