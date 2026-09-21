# CommonMark edge cases

## Code and escaping

Backslash escapes: \*literal asterisk\*, \[literal bracket\], and \# literal hash.

An inline code span containing a backtick: `` code ` tick ``.

Literal HTML in code: `<img src=x onerror=alert(1)>`.

    indented <b>code</b>
    second line

## Lists

3. Numbering starts at three.
4. Next item.

- Tight list item.
- Another tight item.

- A loose list item.

  A second paragraph in that item.

- Another loose item.

## Links

[A link with parentheses](https://example.com/path_(example)).

<https://example.com/autolink>

[Full reference][target]

[Collapsed reference][]

[Shortcut]

## Quotes

> First line.
> Second line.
>
> - A quoted list item.
> - Another quoted item.

## Setext and rules

Setext level one
===============

Setext level two
---------------

***

## Raw HTML

<div class="example">
<p>A block containing <em>safe HTML</em>.</p>
</div>

<DIV class="uppercase-html"><P>Uppercase HTML is standard HTML.</P></DIV>

&copy; &amp; &#169; &lt;literal&gt;

[target]: https://example.com/reference "Reference title"
[Collapsed reference]: https://example.com/collapsed
[Shortcut]: https://example.com/shortcut
