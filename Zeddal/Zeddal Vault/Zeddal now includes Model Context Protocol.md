# Integration of Model Context Protocol (MCP) with [[Zeddal]]

## Overview of the New Feature
I recently enhanced the [[Zeddal]] platform by introducing a new feature called the Model Context Protocol (MCP). This feature revolutionizes the platform's architecture by expanding its capabilities beyond the basic usage of OpenAI's ChatGPT API. Now, [[Zeddal]] can interface with any AI model or agent that utilizes MCP.

## Key Components of MCP Integration

### Configuration and Setup
- **User Interaction**: Users can enable MCP through their settings.
- **Server Configuration**: Users add MCP servers by configuring them as needed.
- **Connection Protocol**: The MCP client service seamlessly connects to these servers on a plug-and-load basis.

### Transcription Refinement Process
- **Context Retrieval**:
  - **Vault-Based (RAG)**: Retrieval-Augmented Generation (RAG) context is pulled from the vault.
  - **External (MCP)**: MCP context is retrieved from external servers.
- **Combination and Processing**: Both RAG and MCP contexts are combined and then processed by GPT-4 to refine transcription.
- **Completion Status**: The interface displays a checkmark upon successful completion of the refinement, indicating three RAG pulls and two MCP chunks were utilized.

## Key Features and Benefits

### Reliability
- **Non-Blocking Operations**: The MCP feature is designed to operate without interrupting existing workflows, even if errors occur.

### Augmentation
- **Supplementary to RAG**: MCP acts as a supplement to RAG, enhancing its capabilities without replacing it.

### User Control
- **Optional Usage**: By default, the feature is disabled, requiring user opt-in to activate.
- **Flexible Support**: Supports multiple servers simultaneously and allows live management of connections without the need to restart.
  
### Adaptability for Secure Environments
- **Air-Gapped Compatibility**: In environments without internet access, MCP can be completely blocked or optionally enabled, depending on user preference.

By integrating MCP with RAG, [[Zeddal]] not only enhances its transcription refinement capabilities but also offers a more robust, flexible, and user-centric approach to managing AI interactions and data processing.

> Transcription meta
> Speaking: 493.90s
> Recorded: 85.90s