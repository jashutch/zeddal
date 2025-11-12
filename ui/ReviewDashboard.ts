// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * ReviewDashboard: Multi-tab diff viewer after transcription
 * Architecture: Tab-based UI for reviewing refined notes before commit
 * Status: Phase 2 - TODO
 */

import { Modal, App } from 'obsidian';
import { RefinedNote, MergeProposal } from '../utils/Types';

export class ReviewDashboard extends Modal {
  private note: RefinedNote;
  private proposals: MergeProposal[];

  constructor(app: App, note: RefinedNote, proposals: MergeProposal[]) {
    super(app);
    this.note = note;
    this.proposals = proposals;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('zeddal-review-dashboard');

    // TODO: Phase 2 implementation
    // TODO: Create tab navigation (New Note | Merge Options | History)
    // TODO: Render DiffPane for each proposal
    // TODO: Add Accept/Reject buttons
    // TODO: Show confidence metrics
    // TODO: Allow manual edits before commit

    contentEl.createEl('h2', { text: 'Review Dashboard (Phase 2)' });
    contentEl.createEl('p', { text: 'Multi-tab diff viewer coming soon...' });
  }

  onClose(): void {
    // Cleanup
  }
}
