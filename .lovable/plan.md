

## Add File Attachment Indicator to User Messages

**What you'll see**: A small chip showing the uploaded file name (with a paperclip icon) displayed just above the user's message bubble, similar to how messaging apps show attachments.

### Plan

1. **Track file name per message** (`src/hooks/useChatThreads.tsx`)
   - Add `file_name?: string` to the `Message` interface
   - When inserting the user message into the DB and local state, include `file.name` if a file was attached
   - Check if the `chat_messages` table already has a `file_name` column; if not, add one via migration

2. **Add migration** (if needed)
   - Add nullable `file_name` column to `chat_messages` table

3. **Update ChatMessage component** (`src/components/chat/ChatMessage.tsx`)
   - Add `fileName?: string` to `ChatMessageProps`
   - For user messages with a `fileName`, render a small attachment chip above the message text:
     ```
     [📎 proposal.pdf]
     "What is this contract about?"
     ```
   - Style: muted background pill with paperclip icon and truncated file name

4. **Pass file name through** (`src/pages/Chat.tsx`)
   - Pass `fileName={message.file_name}` to each `<ChatMessage>`

### Technical Details

- The attachment chip will use the existing `Paperclip` icon from lucide-react (already imported in ChatInput)
- Styled as a small `inline-flex` pill with `bg-white/20` (on user bubble) with truncated text
- The `sendMessage` function already has access to `file.name` — just need to persist it alongside the message

