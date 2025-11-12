# Project Brief for [[Zeddal]]

## Overview
The goal is to develop **Zeddal**, a standalone, cross-platform knowledge application. The initial focus will be on a desktop version, with plans for a mobile version to follow. This application will integrate features akin to Obsidian, but with added functionalities including voice-first capture, live translation, summarization capabilities, and robust connectivity options.

## Key Features and Differentiators
- **Voice Capture & Summarization**: Ability to handle 25 to 45 minutes of continuous speech, transforming it into summarized, searchable, and linked atomic notes within a vault.
- **Export Capabilities**: Supports exporting to various platforms such as Notion, Obsidian, OneNote, and Google Docs.
- **Advanced Linking**: Includes beyond Wikilinks, Backlinks, and enhanced search functionalities.
- **Graph View**: For visual representation of connections between notes and data points.

## Technical Specifications

### Infrastructure
- **Cloud Services**: Utilization of SupaBase for authentication, PostgreSQL for storage, and Vercel for web and edge functions.
- **Compliance**: Must adhere to FERPA, COPPA regulations, and include SSO options, data minimization, audit logs, and accessibility standards to be school district-friendly.

### Development Tools and Libraries
- **Primary Languages and Frameworks**: Tori, React, TypeScript for the desktop app, and Next.js 15 with React for the web companion.
- **Mobile Development**: Expo React Native targeting iOS and Android platforms.
- **Styling**: Combination of Tailwind and Radix UI, with Figma tokens integrated via App Token Studio.
- **Graph Rendering**: Utilizes D3 for technical force, desktop, and web, and React Spring for interactions.

### Code Structure
- **Repository Organization**: Monorepo approach using Turbo repo with PMPM workspaces.
  - `/apps` includes individual subdirectories for desktop, web, operations, and packages.
  - `/packages` will handle core functionalities like domain models, chunking, linking, exporting, and search adapters.
  - `/speech` focuses on capture, voice activity detection (VAD), segmentation, and speech-to-text configurations.

### Compliance and Security
- **Data Policies**: Strict adherence to data protection and privacy laws suitable for educational environments.
- **Encryption and Security**: Options for at-rest encryption in the cloud and potential client-side encryption for vaults.

## User Experience
- **Interface**: Inspired by Obsidian, featuring a vault sidebar, files, tags, backlinks panel, and a voice capture bar.
- **Search and Export**: Advanced search box similar to an omnibar and multiple export options maintaining integrity of the original formats.
- **Accessibility**: Prioritizes keyboard navigation, screen reader compatibility, and adheres to WCAG 2.1 AA standards.

## Future Plans and Considerations
- **Cross-Platform Support**: Extend support to Chromebooks to enhance accessibility and user reach.
- **Performance Metrics**: Ensure the application can handle extensive audio files efficiently, with specific targets for transcription speed and memory usage.

This project aims to merge advanced technological solutions with user-friendly interfaces to create a versatile knowledge management tool suitable for various sectors including defense, justice, medical, and educational fields.

> Transcription meta
> Speaking: 3107.80s
> Recorded: 755.60s