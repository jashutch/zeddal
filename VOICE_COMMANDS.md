# Zeddal Voice Commands

## Wikilink Commands

Zeddal can automatically convert voice commands into Obsidian wikilinks `[[...]]` format.

### Syntax Options

**Option 1: Alias links (display text different from target)**
```
"I read about zeddal link Tesla to Tesla Inc yesterday"
→ "I read about [[Tesla Inc|Tesla]] yesterday"
```
This creates a link to "Tesla Inc" but displays as "Tesla" in your note.

**Option 2: Simple links (with "zeddal" prefix)**
```
"I need to review my notes on zeddal link Tesla Model S"
→ "I need to review my notes on [[Tesla Model S]]"
```

**Option 3: Phrase linking**
```
"Connect this to zeddal link project planning"
→ "Connect this to [[project planning]]"
```

**Option 4: Sentence-start shorthand**
```
"Link productivity and time management are important."
→ "[[productivity]] and time management are important."
```

### Examples

**Alias link (different display and target):**
```
Voice: "I spoke with zeddal link Elon to Elon Musk about innovation"
Output: "I spoke with [[Elon Musk|Elon]] about innovation"
       (Links to "Elon Musk" note, displays as "Elon")
```

**Single word:**
```
Voice: "This relates to zeddal link Python programming"
Output: "This relates to [[Python]] programming"
```

**Multi-word phrase:**
```
Voice: "See my notes on zeddal link electric vehicles for more details"
Output: "See my notes on [[electric vehicles]] for more details"
```

**Multiple links in one note:**
```
Voice: "The zeddal link Tesla Model S uses zeddal link lithium batteries
       which are discussed in zeddal link battery technology"

Output: "The [[Tesla Model S]] uses [[lithium batteries]]
         which are discussed in [[battery technology]]"
```

**Combining alias and simple links:**
```
Voice: "zeddal link Tesla to Tesla Inc makes zeddal link electric vehicles"
Output: "[[Tesla Inc|Tesla]] makes [[electric vehicles]]"
```

### How It Works

1. **Speak naturally** - Say "zeddal link" followed by the word/phrase you want to link
2. **Automatic detection** - The system captures up to 5 words after "link"
3. **Smart boundaries** - Stops at common words (and, but, the, etc.) or punctuation
4. **Preview notification** - Toast notification shows how many links were detected

### Tips

- **Be clear**: Pause slightly before and after the word/phrase you want to link
- **Keep it short**: Best results with 1-3 word phrases
- **Use consistently**: The "zeddal link" prefix works most reliably
- **Don't worry about pronunciation**: Common misrecognitions like "zettle link", "zettel link", "zetal link" are automatically corrected
- **Check preview**: After transcription, review the wikilinks before saving

### Voice Recognition Normalization

Whisper may transcribe "zeddal" in various ways. The plugin automatically normalizes these variations:
- "zettle link" → "zeddal link"
- "zettel link" → "zeddal link"
- "zetal link" → "zeddal link"
- "zedal link" → "zeddal link"
- "sedal link" → "zeddal link"

This means you can speak naturally without worrying about perfect pronunciation!

### Processing Order

1. Whisper transcribes your voice
2. Wake word variations are normalized (e.g., "zettle" → "zeddal")
3. Voice commands are detected and processed into wikilinks
4. Text is displayed with wikilinks applied
5. (Optional) GPT-4 refinement preserves your wikilinks
6. Save to vault with all links intact

### Future Enhancements (Planned)

- [ ] Custom wake word configuration
- [ ] Multiple link styles (hashtags, backticks, etc.)
- [ ] Link to existing notes with fuzzy matching
- [ ] Bidirectional links
- [ ] Tag commands ("zeddal tag important")
