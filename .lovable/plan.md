

# Render Markdown in Chat Messages

## Problem
The AI assistant returns rich markdown (headers, bold text, numbered lists, blockquotes, tables, code blocks), but the `ChatMessage` component renders everything as a plain `<p>` tag with `whitespace-pre-wrap`. All that structure is lost.

## Solution
Install `react-markdown` (with `remark-gfm` for tables/strikethrough support) and update the `ChatMessage` component to render assistant messages as parsed markdown with proper styling.

## Changes

### 1. Install dependencies
- `react-markdown` -- renders markdown as React components
- `remark-gfm` -- adds GitHub Flavored Markdown (tables, task lists, strikethrough)

### 2. Update `src/components/chat/ChatMessage.tsx`
- Import `ReactMarkdown` and `remarkGfm`
- For **user** messages: keep the current plain text rendering (users don't write markdown)
- For **assistant** messages: render through `ReactMarkdown` with custom component styling
- Style the markdown elements to match the existing design system:
  - **Headings** (`##`, `###`): Use the Playfair Display font, proper sizing, and earthy color accents
  - **Bold text** (`**text**`): Rendered with `font-semibold` 
  - **Numbered/bulleted lists**: Proper indentation and spacing with styled markers
  - **Blockquotes** (`>`): Left border accent in the sage/terracotta palette, subtle background
  - **Tables**: Clean bordered table with alternating row shading
  - **Code blocks**: Monospace font with a subtle background
  - **Horizontal rules** (`---`): Styled divider between sections
  - **Links**: Terracotta-colored with underline on hover
  - **Source references** (bold file names): Naturally highlighted through bold rendering

### 3. Update `src/index.css`
- Add a `.prose-chat` utility class scoping the markdown typography styles inside chat bubbles so they don't conflict with the rest of the app

## Technical Details

```text
ChatMessage component flow:

  role === 'user'
    --> plain <p> tag (unchanged)

  role === 'assistant'
    --> <ReactMarkdown remarkPlugins={[remarkGfm]}>
          with custom components map:
            h2 -> styled heading with border-bottom
            h3 -> styled subheading  
            p  -> paragraph with spacing
            ul/ol -> styled lists
            li -> list items with proper markers
            blockquote -> accent-bordered callout box
            table/thead/tbody/tr/th/td -> styled table
            strong -> semibold text
            a -> colored link
            hr -> styled divider
            code -> inline or block code styling
```

### Files modified:
- `src/components/chat/ChatMessage.tsx` -- add markdown rendering for assistant messages
- `src/index.css` -- add `.prose-chat` styles for markdown inside chat bubbles

### Files unchanged:
- `src/pages/Chat.tsx` -- no changes needed
- No backend changes

