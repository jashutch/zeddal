/**
 * CitationHelper: Extract inline citations already provided by GPT output.
 * We no longer fabricate hyperlinks—citations must exist in the refined text.
 */

import { Citation } from './Types';

const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:[^)]+)\)/g;

export class CitationHelper {
  static extract(text: string): Citation[] {
    if (!text) {
      return [];
    }

    const citations: Citation[] = [];
    let match: RegExpExecArray | null;

    while ((match = MARKDOWN_LINK_REGEX.exec(text)) !== null) {
      citations.push({
        keyword: match[1],
        label: match[1],
        url: match[2],
        insertedAt: match.index,
      });
    }

    return citations;
  }
}
